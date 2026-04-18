// Per-Vercel-instance response cache. Survives warm invocations, lost on
// cold start. Bounded prune at 200 entries, 5-min TTL.
const RESPONSE_CACHE = new Map();
const RESPONSE_CACHE_TTL_MS = 5 * 60 * 1000;
const RESPONSE_CACHE_MAX = 200;

function cacheGet(key) {
  const hit = RESPONSE_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > RESPONSE_CACHE_TTL_MS) {
    RESPONSE_CACHE.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data) {
  if (RESPONSE_CACHE.size >= RESPONSE_CACHE_MAX) {
    const oldestKey = RESPONSE_CACHE.keys().next().value;
    if (oldestKey) RESPONSE_CACHE.delete(oldestKey);
  }
  RESPONSE_CACHE.set(key, { data, cachedAt: Date.now() });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  try {
    const { system, query, state_abbr, state_name } = req.body;

    const cacheKey = JSON.stringify([system, query, state_abbr, state_name]).slice(0, 2000);
    const cached = cacheGet(cacheKey);
    if (cached) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).json({ ...cached, cached: true });
    }

    // Mark the (typically large, stable) `system` block as an ephemeral cache
    // breakpoint. Repeat calls within 5 min hit Anthropic's prompt cache at
    // ~10% of input price. Cache fires on Sonnet only when the prefix is
    // >=1024 tokens — smaller systems pass through at normal price.
    const anthropicBody = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [{ role: "user", content: query }],
    };
    if (system) {
      anthropicBody.system = [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ];
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(anthropicBody),
    });

    const data = await response.json();

    if (data.type === "error") {
      return res.status(502).json({ error: data.error?.message || "Claude API error" });
    }

    cacheSet(cacheKey, data);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
