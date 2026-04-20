// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://qoskpyfgimjcmmxunfji.supabase.co";
const ANON_KEY     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvc2tweWZnaW1qY21teHVuZmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMjY0MzAsImV4cCI6MjA5MDcwMjQzMH0.oTa6xhNAQ8eW_Bur-uKvBPBpWkPD2SpaahgcSFysVPY";
const HEADERS      = { "apikey": ANON_KEY, "Authorization": `Bearer ${ANON_KEY}` };
const PARCEL_API   = "https://florida-parcels-production-fd39.up.railway.app";

// ── Basemap styles (free) ─────────────────────────────────────────────────
const BASEMAPS = [
  { name: "Light",      url: "https://tiles.openfreemap.org/styles/positron" },
  { name: "Dark",       url: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json" },
  { name: "Streets",    url: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json" },
  { name: "OSM Liberty", url: "https://tiles.openfreemap.org/styles/liberty" },
  { name: "Satellite",  url: "__satellite__",
    style: { version: 8, sources: {
      "esri-satellite": { type: "raster", tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      ], tileSize: 256, maxzoom: 19, attribution: "Esri, Maxar, Earthstar" }
    }, layers: [{ id: "satellite", type: "raster", source: "esri-satellite" }] }
  },
];
var _bmIdx = 0;

// ── Supabase helpers ────────────────────────────────────────────────────────
function buildSupabaseParams(filters, order, limit, select) {
  let params = `select=${select || "*"}`;
  for (const [k, v] of Object.entries(filters || {})) {
    if (v == null) continue;
    const vStr = String(v);
    const opMatch = vStr.match(/^(eq|gt|gte|lt|lte)\.(.+)$/);
    if (opMatch) {
      params += `&${k}=${opMatch[1]}.${encodeURIComponent(opMatch[2])}`;
    } else if (vStr) {
      params += `&${k}=eq.${encodeURIComponent(vStr)}`;
    }
  }
  if (order) params += `&order=${order}`;
  params += `&limit=${limit || 20}`;
  return params;
}

async function sbFetch(table, params = "") {
  const headers = { ...HEADERS, "Prefer": "count=none" };
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { headers });
  if (!resp.ok) throw new Error(`${table}: HTTP ${resp.status}`);
  return resp.json();
}
window._sbFetch = sbFetch;

async function sbFetchAll(table, selectParams) {
  const PAGE_SIZE = 1000;
  const all = [];
  let offset = 0;
  while (true) {
    const page = await sbFetch(table, `${selectParams}&limit=${PAGE_SIZE}&offset=${offset}`);
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

// ── Schema prompt for AI query ──────────────────────────────────────────────
function getSchemaPrompt() {
  const st = window._currentState || { abbr: "FL", name: "Florida" };
  return `You are a query assistant for a Red Cross disaster response map. The user is currently viewing ${st.name} (${st.abbr}).

Tables (ONLY these columns exist — do NOT use any column not listed here):
- home_fires: fire_id, date, address, city, zip_code, state_abbr, lat, lon, damage_level ("minor"/"major"/"destroyed"), elderly_present ("yes"/"no"), rc_responded ("yes"/"no"), geoid, chapter, region
- shelters: shelter_id, name, zip_code, state_abbr, lat, lon, capacity (integer), current_occupancy (integer), status ("open"/"full"/"closed"), in_flood_zone ("yes"/"no"), geoid, chapter (NOTE: shelters has NO city column)
- dat_volunteers: volunteer_id, name, zip_code, state_abbr, lat, lon, certified ("yes"/"no"), availability ("available"/"deployed"/"inactive"), geoid, chapter
- svi: fips (11-digit tract FIPS), st_abbr, county (includes "County" suffix), location, area_sqmi, rpl_themes (0–1, higher=worse), rpl_theme1 (socioeconomic), rpl_theme2 (household composition), rpl_theme3 (racial/ethnic minority), rpl_theme4 (housing/transport), e_totpop, e_hu, e_hh, e_pov150, e_unemp, e_hburd, e_nohsdp, e_uninsur, e_age65, e_age17, e_disabl, e_sngpnt, e_limeng, e_minrty, e_munit, e_mobile, e_crowd, e_noveh, e_groupq, e_daypop, e_noint, e_afam, e_hisp, e_asian, e_aian, e_nhpi, e_twomore, e_otherrace. Also has ep_* percentage versions.
- nri: tractfips, stateabbrv, county, risk_score, risk_ratng, hrcn_risks, cfld_risks, ifld_risks, trnd_risks, wfir_risks, hwav_risks, resl_score, eal_score, eal_valt
- alice: fips_5, state_fips, county_name, median_income, pct_poverty, pct_alice, pct_struggling, lat, lon
- fema_declarations: fips_5, state_fips, total_declarations, first_declaration_year, most_recent_year, most_recent_title, declarations_per_year, top_hazard, hurricane_count, flood_count, severe_storm_count, lat, lon (NOTE: no county_name column — join on fips_5 to county_rankings.county_name or alice.county_name)

IMPORTANT: Always filter by the current state unless the user explicitly asks about all states or a different state.
- For home_fires/shelters/dat_volunteers: use {"state_abbr": "${st.abbr}"}
- For svi: use {"st_abbr": "${st.abbr}"}
- For nri: use {"stateabbrv": "${st.abbr}"}

CRITICAL — table granularity:
PREFERRED — COUNTY-level tables: alice, fema_declarations, and svi/nri aggregated to county
TRACT-level tables (use only when user explicitly asks about tracts): svi, nri
POINT-level tables: home_fires, shelters, dat_volunteers

DEFAULT BEHAVIOR: If the user doesn't specify "tract," DEFAULT TO COUNTY-LEVEL.
- For SVI/vulnerability questions: use svi with "aggregate": "county"
- For NRI/hazard risk questions: use nri with "aggregate": "county"
- For poverty/income: use alice
- For disaster history: use fema_declarations
Only use tract-level (no aggregate) when the user explicitly says "tract" or "tracts."
When the user asks about a SPECIFIC county's tracts, use svi filtered by county.

Rules:
1. Return ONLY a single JSON object, no markdown, no explanation outside the JSON.
1a. For compound queries, pick the SINGLE most relevant table.
2. For exact match filters: {"field": "value"}
3. For numeric comparisons: {"field": "gte.80"} or {"field": "gt.50"}
4. Allowed operators: eq, gt, gte, lt, lte
5. For ordering: "order": "fieldname.desc"
6. nri county values have no "County" suffix
7. svi county values include "County" suffix
8. For risk queries use nri table ordered by risk_score.desc
9. For poverty/economic queries use alice table ordered by pct_struggling.desc
10. For disaster history use fema_declarations ordered by total_declarations.desc
11. For shelter capacity queries, use post_filter with the threshold
12. When the user asks about counties by population, use svi with "aggregate": "county"
Response format — answerable:
{"table":"tablename","filters":{},"order":"field.desc","limit":20,"aggregate":"county (optional)","post_filter":"optional","explanation":"one sentence"}
Response format — cannot answer:
{"cannot_answer":true,"reason":"brief","suggestions":["q1","q2","q3"]}`;
}

// ── State data ─────────────────────────────────────────────────────────────
const US_STATES = [
  {fips:"01",abbr:"AL",name:"Alabama",center:[-86.9,32.8],zoom:7},
  {fips:"02",abbr:"AK",name:"Alaska",center:[-153.4,64.2],zoom:4},
  {fips:"04",abbr:"AZ",name:"Arizona",center:[-111.9,34.2],zoom:7},
  {fips:"05",abbr:"AR",name:"Arkansas",center:[-92.4,34.8],zoom:7},
  {fips:"06",abbr:"CA",name:"California",center:[-119.4,37.2],zoom:6},
  {fips:"08",abbr:"CO",name:"Colorado",center:[-105.5,39.0],zoom:7},
  {fips:"09",abbr:"CT",name:"Connecticut",center:[-72.7,41.6],zoom:9},
  {fips:"10",abbr:"DE",name:"Delaware",center:[-75.5,39.0],zoom:9},
  {fips:"11",abbr:"DC",name:"District of Columbia",center:[-77.0,38.9],zoom:12},
  {fips:"12",abbr:"FL",name:"Florida",center:[-82.5,28.1],zoom:6},
  {fips:"13",abbr:"GA",name:"Georgia",center:[-83.5,32.7],zoom:7},
  {fips:"15",abbr:"HI",name:"Hawaii",center:[-157.5,20.8],zoom:7},
  {fips:"16",abbr:"ID",name:"Idaho",center:[-114.7,44.4],zoom:6},
  {fips:"17",abbr:"IL",name:"Illinois",center:[-89.4,40.0],zoom:7},
  {fips:"18",abbr:"IN",name:"Indiana",center:[-86.3,39.8],zoom:7},
  {fips:"19",abbr:"IA",name:"Iowa",center:[-93.5,42.0],zoom:7},
  {fips:"20",abbr:"KS",name:"Kansas",center:[-98.3,38.5],zoom:7},
  {fips:"21",abbr:"KY",name:"Kentucky",center:[-85.3,37.8],zoom:7},
  {fips:"22",abbr:"LA",name:"Louisiana",center:[-91.9,31.0],zoom:7},
  {fips:"23",abbr:"ME",name:"Maine",center:[-69.2,45.4],zoom:7},
  {fips:"24",abbr:"MD",name:"Maryland",center:[-76.6,39.0],zoom:8},
  {fips:"25",abbr:"MA",name:"Massachusetts",center:[-71.8,42.2],zoom:8},
  {fips:"26",abbr:"MI",name:"Michigan",center:[-84.7,44.3],zoom:6},
  {fips:"27",abbr:"MN",name:"Minnesota",center:[-94.3,46.3],zoom:6},
  {fips:"28",abbr:"MS",name:"Mississippi",center:[-89.7,32.7],zoom:7},
  {fips:"29",abbr:"MO",name:"Missouri",center:[-92.6,38.5],zoom:7},
  {fips:"30",abbr:"MT",name:"Montana",center:[-109.6,47.0],zoom:6},
  {fips:"31",abbr:"NE",name:"Nebraska",center:[-99.8,41.5],zoom:7},
  {fips:"32",abbr:"NV",name:"Nevada",center:[-116.6,39.3],zoom:6},
  {fips:"33",abbr:"NH",name:"New Hampshire",center:[-71.6,43.7],zoom:8},
  {fips:"34",abbr:"NJ",name:"New Jersey",center:[-74.7,40.1],zoom:8},
  {fips:"35",abbr:"NM",name:"New Mexico",center:[-106.2,34.5],zoom:7},
  {fips:"36",abbr:"NY",name:"New York",center:[-75.5,42.9],zoom:7},
  {fips:"37",abbr:"NC",name:"North Carolina",center:[-79.8,35.5],zoom:7},
  {fips:"38",abbr:"ND",name:"North Dakota",center:[-100.5,47.5],zoom:7},
  {fips:"39",abbr:"OH",name:"Ohio",center:[-82.8,40.4],zoom:7},
  {fips:"40",abbr:"OK",name:"Oklahoma",center:[-97.5,35.5],zoom:7},
  {fips:"41",abbr:"OR",name:"Oregon",center:[-120.5,44.0],zoom:7},
  {fips:"42",abbr:"PA",name:"Pennsylvania",center:[-77.6,41.0],zoom:7},
  {fips:"44",abbr:"RI",name:"Rhode Island",center:[-71.5,41.7],zoom:10},
  {fips:"45",abbr:"SC",name:"South Carolina",center:[-80.9,33.8],zoom:7},
  {fips:"46",abbr:"SD",name:"South Dakota",center:[-100.2,44.4],zoom:7},
  {fips:"47",abbr:"TN",name:"Tennessee",center:[-86.3,35.8],zoom:7},
  {fips:"48",abbr:"TX",name:"Texas",center:[-99.3,31.5],zoom:6},
  {fips:"49",abbr:"UT",name:"Utah",center:[-111.7,39.3],zoom:7},
  {fips:"50",abbr:"VT",name:"Vermont",center:[-72.6,44.1],zoom:8},
  {fips:"51",abbr:"VA",name:"Virginia",center:[-79.4,37.5],zoom:7},
  {fips:"53",abbr:"WA",name:"Washington",center:[-120.7,47.4],zoom:7},
  {fips:"54",abbr:"WV",name:"West Virginia",center:[-80.6,38.6],zoom:7},
  {fips:"55",abbr:"WI",name:"Wisconsin",center:[-89.8,44.6],zoom:7},
  {fips:"56",abbr:"WY",name:"Wyoming",center:[-107.5,43.0],zoom:7},
  {fips:"72",abbr:"PR",name:"Puerto Rico",center:[-66.6,18.2],zoom:9},
  {fips:"78",abbr:"VI",name:"U.S. Virgin Islands",center:[-64.8,17.7],zoom:10},
];

var _currentState = US_STATES.find(s => s.fips === "12");
window._currentState = _currentState;
var _currentStateFips = "12";
var _currentStateAbbr = "FL";
var _tractFeatures = null;
var _isDrawing = false;
var _parcelFetchTimer = null;
var _parcelFilter = "all"; // legacy — replaced by _parcelTypeFilter + _activeValChips
// Parcel filter state
var _parcelVisible = false;
var _tractLayerVisible = false;
var _analysisTracts = [];  // tract features matching current analysis
var _radiusClickHandler = null;

// Populate state dropdown
(function() {
  const sel = document.getElementById("state-select");
  US_STATES.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.fips;
    opt.textContent = s.name;
    if (s.fips === "12") opt.selected = true;
    sel.appendChild(opt);
  });
})();

// ── MapLibre Map ────────────────────────────────────────────────────────────
const savedBm = localStorage.getItem("selectedBasemap");
const savedIdx = savedBm ? BASEMAPS.findIndex(b => b.url === savedBm) : -1;
if (savedIdx >= 0) _bmIdx = savedIdx;
const initBm = savedIdx >= 0 ? BASEMAPS[savedIdx] : BASEMAPS[0];
const initStyle = initBm.style || initBm.url;

const map = new maplibregl.Map({
  container: "map",
  style: initStyle,
  center: [-82.5, 28.1],
  zoom: 6,
  maxPitch: 0,
  dragRotate: false,
});
window.map = map;

// Disable rotation
map.touchZoomRotate.disableRotation();

// Add zoom controls
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

// ── MapLibre GL Draw ────────────────────────────────────────────────────────
const draw = new MapboxDraw({
  displayControlsDefault: false,
  controls: {},
  styles: [
    // Line being drawn
    { id: "gl-draw-line", type: "line", filter: ["all", ["==", "$type", "LineString"]], paint: { "line-color": "#ED1B2E", "line-width": 3 } },
    // Polygon being drawn
    { id: "gl-draw-polygon-fill", type: "fill", filter: ["all", ["==", "$type", "Polygon"]], paint: { "fill-color": "#1e3c78", "fill-opacity": 0.15 } },
    { id: "gl-draw-polygon-stroke", type: "line", filter: ["all", ["==", "$type", "Polygon"]], paint: { "line-color": "#ED1B2E", "line-width": 2 } },
    // Vertices
    { id: "gl-draw-point", type: "circle", filter: ["all", ["==", "$type", "Point"]], paint: { "circle-radius": 5, "circle-color": "#ED1B2E" } },
  ],
});
map.addControl(draw);

// ── Empty GeoJSON sources (added after style loads) ─────────────────────────
const EMPTY_FC = { type: "FeatureCollection", features: [] };

map.on("load", async () => {
  // ── Parcel layer (MVT from tiles.jbf.com) ───────────────────────────────
  map.addSource("parcels-source", {
    type: "vector",
    tiles: ["https://tiles.jbf.com/florida-parcels/{z}/{x}/{y}.mvt?v=2026-04-19"],
    minzoom: 11,
    maxzoom: 16,
  });
  map.addLayer({
    id: "parcels-fill",
    type: "fill",
    source: "parcels-source",
    "source-layer": "parcels",
    minzoom: 12,
    layout: { visibility: "none" },
    paint: {
      "fill-color": [
        "match", ["get", "v"],
        0, "rgba(77,187,219,0.85)",
        1, "rgba(143,212,164,0.85)",
        2, "rgba(200,230,160,0.85)",
        3, "rgba(245,213,110,0.85)",
        4, "rgba(240,146,74,0.85)",
        5, "rgba(224,59,46,0.85)",
        "rgba(200,200,200,0.85)"
      ],
      "fill-opacity": 0.85,
    },
  });
  map.addLayer({
    id: "parcels-outline",
    type: "line",
    source: "parcels-source",
    "source-layer": "parcels",
    minzoom: 12,
    layout: { visibility: "none" },
    paint: { "line-color": "rgba(30,30,30,0.6)", "line-width": 0.5, "line-opacity": 0.6 },
  });

  // ── Parcel mask (dims parcels outside the analysis buffer) ──────────────
  map.addSource("parcel-mask", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "parcel-mask-fill",
    type: "fill",
    source: "parcel-mask",
    layout: { visibility: "none" },
    paint: { "fill-color": "#f5f3f0", "fill-opacity": 0.82 },
  });

  // ── SVI tract choropleth source ─────────────────────────────────────────
  map.addSource("svi-tracts", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "svi-fill",
    type: "fill",
    source: "svi-tracts",
    layout: { visibility: "none" },
    paint: {
      "fill-color": ["case",
        [">=", ["to-number", ["get", "rpl"], -1], 0.75], "rgba(192,57,43,0.65)",
        [">=", ["to-number", ["get", "rpl"], -1], 0.50], "rgba(231,76,60,0.65)",
        [">=", ["to-number", ["get", "rpl"], -1], 0.25], "rgba(243,156,18,0.65)",
        [">=", ["to-number", ["get", "rpl"], -1], 0],    "rgba(249,231,159,0.65)",
        "rgba(204,204,204,0.55)"
      ],
      "fill-outline-color": "rgba(80,80,80,0.25)",
    },
  });

  // ── NRI tract choropleth source ─────────────────────────────────────────
  map.addSource("nri-tracts", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "nri-fill",
    type: "fill",
    source: "nri-tracts",
    layout: { visibility: "none" },
    paint: {
      "fill-color": ["case",
        [">=", ["to-number", ["get", "score"], -1], 80], "rgba(123,45,139,0.65)",
        [">=", ["to-number", ["get", "score"], -1], 60], "rgba(192,57,43,0.65)",
        [">=", ["to-number", ["get", "score"], -1], 40], "rgba(230,126,34,0.65)",
        [">=", ["to-number", ["get", "score"], -1], 20], "rgba(241,196,15,0.65)",
        "rgba(236,240,241,0.65)"
      ],
      "fill-outline-color": "rgba(80,80,80,0.25)",
    },
  });

  // ── Point layers (GeoJSON) ──────────────────────────────────────────────
  map.addSource("fires", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "fires-no-rc",
    type: "circle",
    source: "fires",
    filter: ["==", ["get", "rc_responded"], "no"],
    paint: { "circle-radius": 5, "circle-color": "#ED1B2E", "circle-stroke-color": "#b40014", "circle-stroke-width": 1 },
  });
  map.addLayer({
    id: "fires-rc",
    type: "circle",
    source: "fires",
    filter: ["==", ["get", "rc_responded"], "yes"],
    paint: { "circle-radius": 5, "circle-color": "#2EA03C", "circle-stroke-color": "#14641e", "circle-stroke-width": 1 },
  });

  map.addSource("shelters", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "shelters-layer",
    type: "circle",
    source: "shelters",
    paint: {
      "circle-radius": 6,
      "circle-color": "#1565C0",
      "circle-stroke-color": "#fff",
      "circle-stroke-width": 1.5,
    },
  });

  map.addSource("volunteers", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "volunteers-layer",
    type: "circle",
    source: "volunteers",
    paint: {
      "circle-radius": 6,
      "circle-color": "#FF8C00",
      "circle-stroke-color": "#fff",
      "circle-stroke-width": 1.5,
    },
  });

  // ── Corridor/analysis overlay ───────────────────────────────────────────
  map.addSource("corridor", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "corridor-fill",
    type: "fill",
    source: "corridor",
    paint: { "fill-color": "rgba(30,60,120,0.15)" },
  });
  map.addLayer({
    id: "corridor-outline",
    type: "line",
    source: "corridor",
    paint: { "line-color": "#ED1B2E", "line-width": 2 },
  });

  // ── Highlight marker source ─────────────────────────────────────────────
  map.addSource("highlight", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "highlight-point",
    type: "circle",
    source: "highlight",
    paint: { "circle-radius": 8, "circle-color": "#ED1B2E", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
  });

  // ── Analysis tracts highlight layer ────────────────────────────────────
  map.addSource("analysis-tracts", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "analysis-tracts-fill",
    type: "fill",
    source: "analysis-tracts",
    layout: { visibility: "none" },
    paint: {
      "fill-color": "#e67e22",
      "fill-opacity": 0.25,
    },
  });
  map.addLayer({
    id: "analysis-tracts-outline",
    type: "line",
    source: "analysis-tracts",
    layout: { visibility: "none" },
    paint: {
      "line-color": "#e67e22",
      "line-width": 2,
      "line-dasharray": [3, 2],
    },
  });

  // ── Load initial data ───────────────────────────────────────────────────
  await loadPointData(_currentStateAbbr);
  fetchAndBuildSVI();
  fetchAndBuildNRI();
  document.getElementById("map-loading").classList.add("hidden");

  // ── Click handler ───────────────────────────────────────────────────────
  map.on("click", async (e) => {
    if (_isDrawing) return;

    // Point features take priority
    const pointLayers = ["fires-no-rc", "fires-rc", "shelters-layer", "volunteers-layer"];
    const features = map.queryRenderedFeatures(e.point, { layers: pointLayers });
    if (features.length > 0) {
      const f = features[0];
      const attrs = f.properties;
      const layer = f.layer.id;
      let type = "feature";
      if (layer.startsWith("fires")) type = "fire";
      else if (layer === "shelters-layer") type = "shelter";
      else if (layer === "volunteers-layer") type = "volunteer";
      const title = type === "fire" ? (attrs.address || attrs.fire_id || "Fire")
                  : type === "shelter" ? (attrs.name || attrs.shelter_id || "Shelter")
                  : (attrs.name || attrs.volunteer_id || "Volunteer");
      showFeaturePanel(title, buildFeaturePopupHTML(type, attrs));
      return;
    }

    // Parcel layer hit
    if (_parcelVisible) {
      const parcelFeats = map.queryRenderedFeatures(e.point, { layers: ["parcels-fill"] });
      if (parcelFeats.length > 0) {
        const lat = e.lngLat.lat;
        const lng = e.lngLat.lng;
        const tileProps = parcelFeats[0].properties || {};
        const d = 0.002; // ~200m bbox to ensure we get nearby parcels
        showFeaturePanel("Parcel", `<div style="font-size:13px;color:#888;padding:10px 0">Loading parcel details…</div>`);
        try {
          const resp = await fetch(`${PARCEL_API}/api/parcels?xmin=${lng-d}&ymin=${lat-d}&xmax=${lng+d}&ymax=${lat+d}&limit=20`);
          const data = await resp.json();
          const feats = data?.features || [];
          let best = null, bestDist = Infinity;
          for (const f of feats) {
            const c = f.geometry?.coordinates;
            if (!c) continue;
            const dx = c[0] - lng, dy = c[1] - lat;
            const dist = dx * dx + dy * dy;
            if (dist < bestDist) { bestDist = dist; best = f; }
          }
          const a = best?.properties || {};
          const hasData = a.addr || a.owner || a.val || a.county;
          if (hasData) {
            const title = a.addr ? `${a.addr}, ${a.city || ''} ${a.zip || ''}`.trim() : 'Parcel';
            showFeaturePanel(title, buildParcelPopupHTML(a, tileProps));
          } else {
            showFeaturePanel("Parcel", buildParcelPopupHTML(null, tileProps));
          }
        } catch (_) {
          showFeaturePanel("Parcel", buildParcelPopupHTML(null, tileProps));
        }
        return;
      }
    }

    // Tract hit (SVI or NRI)
    const tractLayers = [];
    if (map.getLayoutProperty("svi-fill", "visibility") === "visible") tractLayers.push("svi-fill");
    if (map.getLayoutProperty("nri-fill", "visibility") === "visible") tractLayers.push("nri-fill");
    if (tractLayers.length > 0) {
      const tractFeats = map.queryRenderedFeatures(e.point, { layers: tractLayers });
      if (tractFeats.length > 0) {
        const geoid = tractFeats[0].properties.GEOID;
        const sviData = window._sviFullMap?.get(geoid);
        const bbox = tractBbox(tractFeats[0].geometry);
        showFeaturePanel(
          sviData?.location || ("Census Tract " + geoid),
          buildTractPopupHTML(geoid, bbox)
        );
      }
    }
  });

  // Cursor changes on hoverable layers
  const hoverLayers = ["fires-no-rc", "fires-rc", "shelters-layer", "volunteers-layer"];
  hoverLayers.forEach(layer => {
    map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
  });
});

// ── Draw event handlers ─────────────────────────────────────────────────────
map.on("draw.create", async (e) => {
  const feature = e.features[0];
  if (!feature) return;

  if (feature.geometry.type === "LineString") {
    const btn = document.getElementById("corridor-draw-btn");
    btn.textContent = "Analyzing…";
    await runCorridorAnalysis(feature.geometry);
    btn.textContent = "Line";
    btn.classList.remove("drawing");
  } else if (feature.geometry.type === "Polygon") {
    const btn = document.getElementById("polygon-draw-btn");
    btn.textContent = "Analyzing…";
    await runPolygonAnalysis(feature.geometry);
    btn.textContent = "Polygon";
    btn.classList.remove("drawing");
  }
  _isDrawing = false;
  document.querySelector('.panel-tab[data-tab="corridor"]')?.classList.remove("drawing");
  draw.deleteAll();
});

// ── Load point data ─────────────────────────────────────────────────────────
async function loadPointData(stateAbbr) {
  try {
    const stFilter = `&state_abbr=eq.${stateAbbr}`;
    const [fires, shelters, volunteers] = await Promise.all([
      sbFetch("home_fires",     `select=fire_id,date,lat,lon,rc_responded,address,city,zip_code,damage_level,elderly_present,chapter,region,geoid${stFilter}&limit=1000`),
      sbFetch("shelters",       `select=shelter_id,name,lat,lon,status,capacity,current_occupancy,zip_code,chapter,in_flood_zone,geoid${stFilter}&limit=200`),
      sbFetch("dat_volunteers", `select=volunteer_id,name,lat,lon,certified,availability,zip_code,chapter,geoid${stFilter}&limit=500`),
    ]);

    // Convert to GeoJSON and set sources
    const toGeoJSON = (items) => ({
      type: "FeatureCollection",
      features: items.filter(r => r.lat && r.lon).map(r => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lon, r.lat] },
        properties: r,
      })),
    });

    if (map.getSource("fires")) map.getSource("fires").setData(toGeoJSON(fires));
    if (map.getSource("shelters")) map.getSource("shelters").setData(toGeoJSON(shelters));
    if (map.getSource("volunteers")) map.getSource("volunteers").setData(toGeoJSON(volunteers));

    document.getElementById("stat-fires").textContent     = fires.length;
    document.getElementById("stat-no-response").textContent = fires.filter(f => f.rc_responded === "no").length;
    document.getElementById("stat-shelters").textContent  = shelters.length;
    document.getElementById("stat-volunteers").textContent = volunteers.length;

    window._data = { fires, shelters, volunteers };
  } catch (err) {
    console.error("Point data load error:", err);
  }
}

// ── TIGERweb tract geometry fetch ───────────────────────────────────────────
var _tractPromise = null;
async function fetchTIGERwebTracts(statusEl) {
  if (_tractFeatures) return _tractFeatures;
  if (_tractPromise) return _tractPromise;
  _tractPromise = _fetchTIGERwebTractsInner(statusEl);
  return _tractPromise;
}
async function _fetchTIGERwebTractsInner(statusEl) {
  if (statusEl) statusEl.textContent = "Loading tracts from TIGERweb…";

  const BASE = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query";
  const WHERE = encodeURIComponent(`STATE='${_currentStateFips}'`);
  const LIMIT = 1000;

  const pageUrl = (offset) =>
    `${BASE}?where=${WHERE}&outFields=GEOID&f=geojson&returnGeometry=true&resultOffset=${offset}&resultRecordCount=${LIMIT}`;

  if (statusEl) statusEl.textContent = "Loading tracts…";
  const firstResp = await fetch(pageUrl(0));
  if (!firstResp.ok) throw new Error(`TIGERweb HTTP ${firstResp.status}`);
  const firstData = await firstResp.json();
  const firstPage = firstData.features || [];

  const countResp = await fetch(`${BASE}?where=${WHERE}&returnCountOnly=true&f=json`);
  const countData = await countResp.json();
  const totalCount = countData.count ?? firstPage.length;

  const offsets = [];
  for (let off = LIMIT; off < totalCount; off += LIMIT) offsets.push(off);

  const restPages = await Promise.all(
    offsets.map(async (offset) => {
      const resp = await fetch(pageUrl(offset));
      if (!resp.ok) throw new Error(`TIGERweb HTTP ${resp.status} at offset ${offset}`);
      const data = await resp.json();
      return data.features || [];
    })
  );

  const all = [firstPage, ...restPages].flat();
  _tractFeatures = all;
  return all;
}

// ── SVI choropleth ──────────────────────────────────────────────────────────
async function fetchAndBuildSVI() {
  const statusEl = document.getElementById("svi-status");
  statusEl.textContent = "Loading...";

  try {
    const sviPromise = sbFetchAll("svi", `select=fips,rpl_themes,rpl_theme1,rpl_theme2,rpl_theme3,rpl_theme4,e_totpop,e_pov150,e_age65,e_disabl,county,location&st_abbr=eq.${_currentStateAbbr}`);
    let tractFeatures = [];
    try { tractFeatures = await fetchTIGERwebTracts(statusEl); } catch (e) { console.warn("TIGERweb failed:", e.message); }
    const sviData = await sviPromise;

    const sviMap = new Map(sviData.map(row => [String(row.fips), row.rpl_themes]));
    const sviFullMap = new Map(sviData.map(row => [String(row.fips), row]));
    window._sviFullMap = sviFullMap;

    // Build GeoJSON with rpl property for MapLibre style expressions
    const features = tractFeatures.map(feat => {
      const geoid = feat.properties?.GEOID;
      const rpl = sviMap.has(geoid) ? sviMap.get(geoid) : -1;
      return {
        type: "Feature",
        geometry: feat.geometry,
        properties: { GEOID: geoid, rpl: rpl !== null ? rpl : -1 },
      };
    }).filter(f => f.geometry);

    if (map.getSource("svi-tracts")) {
      map.getSource("svi-tracts").setData({ type: "FeatureCollection", features });
    }

    statusEl.textContent = `${features.length} tracts`;

    const stName = (window._currentState || {}).name || "Florida";
    document.querySelector("#top-bar-sub").textContent =
      `${stName} — 7 datasets · ${features.length.toLocaleString()} census tracts`;
  } catch (err) {
    console.error("SVI load error:", err);
    statusEl.textContent = `Error: ${err.message}`;
  }
}

// ── NRI choropleth ──────────────────────────────────────────────────────────
async function fetchAndBuildNRI() {
  const statusEl = document.getElementById("nri-status");
  statusEl.textContent = "Loading...";

  try {
    const nriPromise = sbFetchAll("nri",
      `select=tractfips,risk_score,risk_ratng,hrcn_risks,cfld_risks,ifld_risks,trnd_risks,wfir_risks,hwav_risks,resl_score,eal_valt&stateabbrv=eq.${_currentStateAbbr}`);
    let tractFeatures = [];
    try { tractFeatures = await fetchTIGERwebTracts(statusEl); } catch (e) { console.warn("TIGERweb failed:", e.message); }
    const nriData = await nriPromise;

    const nriMap = new Map(nriData.map(row => [String(row.tractfips), row]));
    window._nriMap = nriMap;

    const features = tractFeatures.map(feat => {
      const geoid = feat.properties?.GEOID;
      const row = nriMap.get(geoid) || {};
      return {
        type: "Feature",
        geometry: feat.geometry,
        properties: {
          GEOID: geoid,
          score: row.risk_score ?? -1,
          risk_ratng: row.risk_ratng ?? "—",
          hrcn_risks: row.hrcn_risks ?? -1,
          cfld_risks: row.cfld_risks ?? -1,
          ifld_risks: row.ifld_risks ?? -1,
          trnd_risks: row.trnd_risks ?? -1,
          wfir_risks: row.wfir_risks ?? -1,
          hwav_risks: row.hwav_risks ?? -1,
        },
      };
    }).filter(f => f.geometry);

    if (map.getSource("nri-tracts")) {
      map.getSource("nri-tracts").setData({ type: "FeatureCollection", features });
    }

    statusEl.textContent = `${features.length} tracts`;
  } catch (err) {
    console.error("NRI load error:", err);
    statusEl.textContent = `Error: ${err.message}`;
  }
}

// ── Layer toggles ───────────────────────────────────────────────────────────
document.getElementById("svi-toggle").addEventListener("click", () => {
  const btn = document.getElementById("svi-toggle");
  const vis = map.getLayoutProperty("svi-fill", "visibility");
  const newVis = vis === "visible" ? "none" : "visible";
  map.setLayoutProperty("svi-fill", "visibility", newVis);
  btn.textContent = newVis === "visible" ? "ON" : "OFF";
  btn.classList.toggle("active", newVis === "visible");
  document.getElementById("analyze-svi-toggle")?.classList.toggle("active", newVis === "visible");
  applyFilters();
});

document.getElementById("nri-toggle").addEventListener("click", () => {
  const btn = document.getElementById("nri-toggle");
  const vis = map.getLayoutProperty("nri-fill", "visibility");
  const newVis = vis === "visible" ? "none" : "visible";
  map.setLayoutProperty("nri-fill", "visibility", newVis);
  btn.textContent = newVis === "visible" ? "ON" : "OFF";
  btn.classList.toggle("active", newVis === "visible");
  document.getElementById("analyze-nri-toggle")?.classList.toggle("active", newVis === "visible");
  applyFilters();
});

document.getElementById("nri-hazard").addEventListener("change", () => {
  const field = document.getElementById("nri-hazard").value;
  // Update the paint property to color by selected hazard field
  const scoreField = field === "risk_score" ? "score" : field;
  map.setPaintProperty("nri-fill", "fill-color", ["case",
    [">=", ["to-number", ["get", scoreField], -1], 80], "rgba(123,45,139,0.65)",
    [">=", ["to-number", ["get", scoreField], -1], 60], "rgba(192,57,43,0.65)",
    [">=", ["to-number", ["get", scoreField], -1], 40], "rgba(230,126,34,0.65)",
    [">=", ["to-number", ["get", scoreField], -1], 20], "rgba(241,196,15,0.65)",
    "rgba(236,240,241,0.65)"
  ]);
});

// ── Parcel toggle ───────────────────────────────────────────────────────────
document.getElementById("parcel-toggle").addEventListener("click", () => {
  const btn = document.getElementById("parcel-toggle");
  _parcelVisible = !_parcelVisible;
  const vis = _parcelVisible ? "visible" : "none";
  map.setLayoutProperty("parcels-fill", "visibility", vis);
  map.setLayoutProperty("parcels-outline", "visibility", vis);
  // Show/hide parcel mask based on whether parcels are on and an analysis area exists
  const hasMask = map.getSource("parcel-mask") && _analysisTracts.length > 0;
  map.setLayoutProperty("parcel-mask-fill", "visibility", _parcelVisible && hasMask ? "visible" : "none");
  btn.textContent = _parcelVisible ? "ON" : "OFF";
  btn.classList.toggle("active", _parcelVisible);
  document.getElementById("fab-parcels")?.classList.toggle("active", _parcelVisible);
  document.getElementById("analyze-parcel-toggle")?.classList.toggle("active", _parcelVisible);
  document.getElementById("analyze-parcel-types").style.display = _parcelVisible ? "flex" : "none";
  document.getElementById("parcel-legend").style.display = _parcelVisible ? "" : "none";
});

// Populate county dropdown
(async function loadCountyDropdown() {
  try {
    const resp = await fetch(`${PARCEL_API}/api/counties`);
    const data = await resp.json();
    const select = document.getElementById("parcel-county");
    for (const c of data.counties) {
      const opt = document.createElement("option");
      opt.value = c.county;
      opt.textContent = `${c.county} (${c.count.toLocaleString()})`;
      select.appendChild(opt);
    }
  } catch (e) { console.error("County dropdown error:", e); }
})();

// ── Parcel filter chips ─────────────────────────────────────────────────────
const PARCEL_MATCH = [
  "match", ["get", "v"],
  0, "rgba(77,187,219,0.85)", 1, "rgba(143,212,164,0.85)", 2, "rgba(200,230,160,0.85)",
  3, "rgba(245,213,110,0.85)", 4, "rgba(240,146,74,0.85)", 5, "rgba(224,59,46,0.85)",
  "rgba(200,200,200,0.85)"
];

const PARCEL_VAL_FILTERS = {
  "under250k":   ["<", ["get", "val"], 250000],
  "250k-500k":   ["all", [">=", ["get", "val"], 250000], ["<", ["get", "val"], 500000]],
  "500k-750k":   ["all", [">=", ["get", "val"], 500000], ["<", ["get", "val"], 750000]],
  "750k-1m":     ["all", [">=", ["get", "val"], 750000], ["<", ["get", "val"], 1000000]],
  "1m+":         [">=", ["get", "val"], 1000000],
};
var _parcelTypeFilter = "all";          // "all", "residential", or "commercial"
var _activeValChips   = new Set();      // multi-select value chips

function styleChip(el, active) {
  if (active) { el.classList.add("active"); el.style.background = "#41b6c4"; el.style.color = "#fff"; }
  else        { el.classList.remove("active"); el.style.background = "transparent"; el.style.color = "var(--text-primary,#333)"; }
}

// Type chips — single-select (All / Residential / Commercial)
document.querySelectorAll(".parcel-chip-type").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".parcel-chip-type").forEach(c => styleChip(c, false));
    styleChip(chip, true);
    _parcelTypeFilter = chip.dataset.ptype;
    applyParcelFilters();
  });
});

// Value chips — multi-select toggle
document.querySelectorAll(".parcel-chip-val").forEach(chip => {
  chip.addEventListener("click", () => {
    const key = chip.dataset.pval;
    if (_activeValChips.has(key)) { _activeValChips.delete(key); styleChip(chip, false); }
    else                          { _activeValChips.add(key);    styleChip(chip, true);  }
    applyParcelFilters();
  });
});

// ── Parcel dual-handle sliders (noUiSlider) ────────────────────────────────
var _yearRange = [1900, 2024];
var _valRange  = [0, 2000000];

const yearSliderEl = document.getElementById("parcel-year-slider");
noUiSlider.create(yearSliderEl, {
  start: [1900, 2024], connect: true, step: 1,
  range: { min: 1900, max: 2024 },
  format: { to: v => Math.round(v), from: v => Number(v) },
});
yearSliderEl.noUiSlider.on("update", (values) => {
  _yearRange = [Number(values[0]), Number(values[1])];
  const label = (_yearRange[0] === 1900 && _yearRange[1] === 2024) ? "Any" : `${_yearRange[0]} – ${_yearRange[1]}`;
  document.getElementById("parcel-year-label").textContent = label;
  applyParcelFilters();
});

const valSliderEl = document.getElementById("parcel-val-slider");
const VAL_STEPS = [0, 25000, 50000, 100000, 150000, 200000, 250000, 300000, 400000, 500000, 750000, 1000000, 1500000, 2000000];
noUiSlider.create(valSliderEl, {
  start: [0, 2000000], connect: true,
  range: { min: 0, max: 2000000 },
  snap: true,
  range: (function() {
    const r = { min: [0] };
    VAL_STEPS.forEach((v, i) => {
      if (i === 0 || i === VAL_STEPS.length - 1) return;
      const pct = Math.round((i / (VAL_STEPS.length - 1)) * 100);
      r[pct + "%"] = [v];
    });
    r.max = [2000000];
    return r;
  })(),
  format: { to: v => Math.round(v), from: v => Number(v) },
});
function fmtVal(v) {
  if (v >= 1000000) return `$${(v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1)}M`;
  if (v >= 1000) return `$${Math.round(v / 1000)}K`;
  return `$${v}`;
}
valSliderEl.noUiSlider.on("update", (values) => {
  _valRange = [Number(values[0]), Number(values[1])];
  const label = (_valRange[0] === 0 && _valRange[1] === 2000000) ? "$0 – $2M+" : `${fmtVal(_valRange[0])} – ${fmtVal(_valRange[1])}${_valRange[1] === 2000000 ? "+" : ""}`;
  document.getElementById("parcel-val-label").textContent = label;
  applyParcelFilters();
});

function applyParcelFilters() {
  if (!_parcelVisible) return;
  const conditions = [];

  // Type filter (All / Residential / subtypes / Commercial)
  // Florida DOR use codes in tiles: 10xx=SFH, 20xx=Mobile, 30xx=Multi(<10), 40xx=Condo, 80xx=Multi(10+)
  if (_parcelTypeFilter === "residential") {
    const ucNum = ["to-number", ["get", "uc"], 0];
    conditions.push(["any",
      ["==", ["get", "res"], 1],
      ["all", [">=", ucNum, 1000], ["<", ucNum, 1200]],
      ["all", [">=", ucNum, 2000], ["<", ucNum, 2100]],
      ["all", [">=", ucNum, 3000], ["<", ucNum, 3100]],
      ["all", [">=", ucNum, 4000], ["<", ucNum, 4100]],
      ["all", [">=", ucNum, 8000], ["<", ucNum, 8100]],
    ]);
  } else if (_parcelTypeFilter === "sfh") {
    const ucNum = ["to-number", ["get", "uc"], 0];
    conditions.push(["all", [">=", ucNum, 1000], ["<", ucNum, 1100]]);
  } else if (_parcelTypeFilter === "mobile") {
    const ucNum = ["to-number", ["get", "uc"], 0];
    conditions.push(["all", [">=", ucNum, 2000], ["<", ucNum, 2100]]);
  } else if (_parcelTypeFilter === "condo") {
    const ucNum = ["to-number", ["get", "uc"], 0];
    conditions.push(["all", [">=", ucNum, 4000], ["<", ucNum, 4100]]);
  } else if (_parcelTypeFilter === "multifam") {
    const ucNum = ["to-number", ["get", "uc"], 0];
    conditions.push(["any",
      ["all", [">=", ucNum, 3000], ["<", ucNum, 3100]],
      ["all", [">=", ucNum, 8000], ["<", ucNum, 8100]],
    ]);
  } else if (_parcelTypeFilter === "commercial") {
    conditions.push(["==", ["get", "res"], 0]);
  }

  // Value chip filters — OR together when multiple selected
  if (_activeValChips.size > 0) {
    const valExprs = [];
    _activeValChips.forEach(key => { if (PARCEL_VAL_FILTERS[key]) valExprs.push(PARCEL_VAL_FILTERS[key]); });
    if (valExprs.length === 1) conditions.push(valExprs[0]);
    else if (valExprs.length > 1) conditions.push(["any", ...valExprs]);
  }

  // Year Built slider
  if (_yearRange[0] > 1900 || _yearRange[1] < 2024) {
    if (_yearRange[0] > 1900) conditions.push([">=", ["get", "yb"], _yearRange[0]]);
    if (_yearRange[1] < 2024) conditions.push(["<=", ["get", "yb"], _yearRange[1]]);
    // Exclude parcels with yb=0 (unknown) when year filter is active
    conditions.push([">", ["get", "yb"], 0]);
  }

  // Assessed Value slider
  if (_valRange[0] > 0 || _valRange[1] < 2000000) {
    if (_valRange[0] > 0) conditions.push([">=", ["get", "val"], _valRange[0]]);
    if (_valRange[1] < 2000000) conditions.push(["<=", ["get", "val"], _valRange[1]]);
  }

  // Use layer filter instead of paint expressions — avoids nested match-in-case bug
  if (conditions.length > 0) {
    const filterExpr = conditions.length === 1 ? conditions[0] : ["all", ...conditions];
    map.setFilter("parcels-fill", filterExpr);
    map.setFilter("parcels-outline", filterExpr);
  } else {
    map.setFilter("parcels-fill", null);
    map.setFilter("parcels-outline", null);
  }

  // Colors always use the simple match expression — no nesting
  map.setPaintProperty("parcels-fill", "fill-color", PARCEL_MATCH);
  map.setPaintProperty("parcels-fill", "fill-opacity", 0.85);
  document.getElementById("parcel-filter-count").textContent = conditions.length > 0 ? "Filter active" : "";
}

// ── Filter sliders (SVI/NRI) ────────────────────────────────────────────────
// Each slider lives inside its layer's accordion; the analyze button shows
// in its own wrapper whenever either filter is non-zero.
function applyFilters() {
  const sviMin = parseInt(document.getElementById("svi-filter").value) / 100;
  const nriMin = parseInt(document.getElementById("nri-filter").value);
  const sviVis = map.getLayoutProperty("svi-fill", "visibility") === "visible";
  const nriVis = map.getLayoutProperty("nri-fill", "visibility") === "visible";

  if (sviVis) {
    map.setFilter("svi-fill", sviMin > 0 ? [">=", ["get", "rpl"], sviMin] : null);
  }
  if (nriVis) {
    const nriField = document.getElementById("nri-hazard").value;
    const scoreField = nriField === "risk_score" ? "score" : nriField;
    map.setFilter("nri-fill", nriMin > 0 ? [">=", ["get", scoreField], nriMin] : null);
  }

  const actionWrap = document.getElementById("filter-action-wrap");
  const resultsDiv = document.getElementById("filter-analysis-results");
  if (sviMin > 0 || nriMin > 0) {
    actionWrap.style.display = "block";
  } else {
    actionWrap.style.display = "none";
    resultsDiv.style.display = "none";
  }
}

document.getElementById("svi-filter").addEventListener("input", (e) => {
  document.getElementById("svi-filter-val").textContent = (parseInt(e.target.value) / 100).toFixed(2);
  applyFilters();
});
document.getElementById("nri-filter").addEventListener("input", (e) => {
  document.getElementById("nri-filter-val").textContent = parseInt(e.target.value);
  applyFilters();
});

// ── FAB layer toggles ───────────────────────────────────────────────────────
window.toggleMapLayer = (type) => {
  if (type === "parcel") {
    document.getElementById("parcel-toggle").click();
    return;
  }
  if (type === "tract") {
    _tractLayerVisible = !_tractLayerVisible;
    const vis = _tractLayerVisible ? "visible" : "none";
    map.setLayoutProperty("analysis-tracts-fill", "visibility", vis);
    map.setLayoutProperty("analysis-tracts-outline", "visibility", vis);
    document.getElementById("fab-tracts")?.classList.toggle("active", _tractLayerVisible);
    document.getElementById("analyze-tract-toggle")?.classList.toggle("active", _tractLayerVisible);
    return;
  }
  const layerMap = {
    fire: ["fires-no-rc", "fires-rc"],
    shelter: ["shelters-layer"],
    volunteer: ["volunteers-layer"],
  };
  const fabMap = { fire: "fab-fires", shelter: "fab-shelters", volunteer: "fab-volunteers" };
  const layers = layerMap[type] || [];
  const btn = document.getElementById(fabMap[type]);
  const vis = map.getLayoutProperty(layers[0], "visibility");
  const newVis = vis === "visible" ? "none" : "visible";
  layers.forEach(l => map.setLayoutProperty(l, "visibility", newVis));
  btn?.classList.toggle("active", newVis === "visible");
};

// ── Parcel RPC analysis ─────────────────────────────────────────────────────
async function analyzeParcelsByTracts(tractList, bbox) {
  try {
    const params = [];
    if (bbox) params.push(`xmin=${bbox.xmin}&ymin=${bbox.ymin}&xmax=${bbox.xmax}&ymax=${bbox.ymax}`);
    const county = document.getElementById("parcel-county")?.value || "";
    if (county) params.push(`county=${encodeURIComponent(county)}`);
    const url = `${PARCEL_API}/api/stats` + (params.length ? `?${params.join("&")}` : "");
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return resp.json();
  } catch (e) {
    console.error("Parcel analysis error:", e);
    return null;
  }
}

// ── Corridor / Radius / Polygon analysis ────────────────────────────────────
function avg(arr, field) {
  const vals = arr.map(r => r[field]).filter(v => v !== null && v !== undefined);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

function pointInPolygon(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function setParcelMask(bufferFeature) {
  if (!bufferFeature) {
    map.getSource("parcel-mask").setData(EMPTY_FC);
    map.setLayoutProperty("parcel-mask-fill", "visibility", "none");
    return;
  }
  // World polygon with buffer as hole — dims everything outside the buffer
  const world = [[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]];
  const bufferRing = bufferFeature.geometry.coordinates[0];
  const mask = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [world, bufferRing] },
      properties: {},
    }],
  };
  map.getSource("parcel-mask").setData(mask);
  if (_parcelVisible) {
    map.setLayoutProperty("parcel-mask-fill", "visibility", "visible");
  }
}

function setAnalysisTracts(tractFeatures) {
  _analysisTracts = tractFeatures;
  const fc = {
    type: "FeatureCollection",
    features: tractFeatures.map(f => ({
      type: "Feature",
      geometry: f.geometry,
      properties: { GEOID: f.properties?.GEOID || "" },
    })),
  };
  map.getSource("analysis-tracts").setData(fc);
  // Auto-show when analysis runs, auto-activate FAB
  if (tractFeatures.length) {
    _tractLayerVisible = true;
    map.setLayoutProperty("analysis-tracts-fill", "visibility", "visible");
    map.setLayoutProperty("analysis-tracts-outline", "visibility", "visible");
    document.getElementById("fab-tracts")?.classList.add("active");
    document.getElementById("analyze-tract-toggle")?.classList.add("active");
  }
}

function tractBbox(geom) {
  if (!geom?.coordinates) return null;
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  const walk = a => {
    if (typeof a[0] === "number") {
      if (a[0] < xmin) xmin = a[0]; if (a[0] > xmax) xmax = a[0];
      if (a[1] < ymin) ymin = a[1]; if (a[1] > ymax) ymax = a[1];
    } else a.forEach(walk);
  };
  walk(geom.coordinates);
  return isFinite(xmin) ? { xmin, ymin, xmax, ymax } : null;
}

async function runCorridorAnalysis(lineGeom) {
  const miles = parseInt(document.getElementById("corridor-miles").value, 10);
  const threshDeg = (miles * 1609.34) / 111320;
  if (!_tractFeatures) { try { await fetchTIGERwebTracts(); } catch (e) {} }

  const coords = lineGeom.coordinates;
  const avgLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const lonScale = Math.cos(avgLat * Math.PI / 180);

  function nearLine(lat, lon) {
    const sLon = lon * lonScale;
    for (let i = 0; i < coords.length - 1; i++) {
      if (distToSegment(sLon, lat, coords[i][0] * lonScale, coords[i][1], coords[i+1][0] * lonScale, coords[i+1][1]) <= threshDeg) return true;
    }
    return false;
  }

  // Buffer the line using turf
  const buffered = turf.buffer(turf.lineString(coords), miles, { units: "miles" });

  map.getSource("corridor").setData({
    type: "FeatureCollection",
    features: [buffered],
  });
  setParcelMask(buffered);

  // Fit to corridor bounds
  const bbox = turf.bbox(buffered);
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 50, duration: 800 });

  const { fires = [], shelters = [], volunteers = [] } = window._data || {};
  const firesIn  = fires.filter(f => nearLine(f.lat, f.lon));
  const sheltsIn = shelters.filter(s => nearLine(s.lat, s.lon));
  const volsIn   = volunteers.filter(v => nearLine(v.lat, v.lon));

  const tractsInCorridor = (_tractFeatures || []).filter(f => {
    try {
      if (!f.geometry?.coordinates) return false;
      return turf.booleanIntersects(buffered, f);
    } catch (e) { return false; }
  });
  const tractGeoids = tractsInCorridor.map(f => f.properties?.GEOID).filter(Boolean);
  setAnalysisTracts(tractsInCorridor);

  const corrBbox = {
    xmin: Math.min(...coords.map(c => c[0])) - threshDeg / lonScale,
    ymin: Math.min(...coords.map(c => c[1])) - threshDeg,
    xmax: Math.max(...coords.map(c => c[0])) + threshDeg / lonScale,
    ymax: Math.max(...coords.map(c => c[1])) + threshDeg,
  };

  await fetchAndRenderAnalysis(firesIn, sheltsIn, volsIn, tractGeoids, "Corridor", corrBbox);
}

async function runRadiusAnalysis(center, miles) {
  const threshDeg = (miles * 1609.34) / 111320;
  if (!_tractFeatures) { try { await fetchTIGERwebTracts(); } catch (e) {} }

  const lonScale = Math.cos(center.lat * Math.PI / 180);
  function inRadius(lat, lon) {
    const dLat = lat - center.lat;
    const dLon = (lon - center.lng) * lonScale;
    return Math.sqrt(dLat * dLat + dLon * dLon) <= threshDeg;
  }

  // Draw circle using turf
  const circleGeoJSON = turf.circle([center.lng, center.lat], miles, { units: "miles", steps: 72 });

  map.getSource("corridor").setData({ type: "FeatureCollection", features: [circleGeoJSON] });
  setParcelMask(circleGeoJSON);
  const bbox = turf.bbox(circleGeoJSON);
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 50, duration: 800 });

  const { fires = [], shelters = [], volunteers = [] } = window._data || {};
  const firesIn  = fires.filter(f => inRadius(f.lat, f.lon));
  const sheltsIn = shelters.filter(s => inRadius(s.lat, s.lon));
  const volsIn   = volunteers.filter(v => inRadius(v.lat, v.lon));

  const tractsIn = (_tractFeatures || []).filter(f => {
    try {
      if (!f.geometry?.coordinates) return false;
      return turf.booleanIntersects(circleGeoJSON, f);
    } catch (e) { return false; }
  });
  const tractGeoids = tractsIn.map(f => f.properties?.GEOID).filter(Boolean);
  setAnalysisTracts(tractsIn);

  const radBbox = {
    xmin: center.lng - threshDeg / lonScale, ymin: center.lat - threshDeg,
    xmax: center.lng + threshDeg / lonScale, ymax: center.lat + threshDeg,
  };

  await fetchAndRenderAnalysis(firesIn, sheltsIn, volsIn, tractGeoids, "Radius", radBbox);
}

async function runPolygonAnalysis(polyGeom) {
  if (!_tractFeatures) { try { await fetchTIGERwebTracts(); } catch (e) {} }

  const ring = polyGeom.coordinates[0];
  function inPoly(lat, lon) { return pointInPolygon(lat, lon, ring); }

  const polyBufferFeature = { type: "Feature", geometry: polyGeom, properties: {} };
  map.getSource("corridor").setData({
    type: "FeatureCollection",
    features: [polyBufferFeature],
  });
  setParcelMask(polyBufferFeature);

  const bbox = turf.bbox(polyBufferFeature);
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 50, duration: 800 });

  const { fires = [], shelters = [], volunteers = [] } = window._data || {};
  const firesIn  = fires.filter(f => inPoly(f.lat, f.lon));
  const sheltsIn = shelters.filter(s => inPoly(s.lat, s.lon));
  const volsIn   = volunteers.filter(v => inPoly(v.lat, v.lon));

  const polyFeature = { type: "Feature", geometry: polyGeom, properties: {} };
  const tractsIn = (_tractFeatures || []).filter(f => {
    try {
      if (!f.geometry?.coordinates) return false;
      return turf.booleanIntersects(polyFeature, f);
    } catch (e) { return false; }
  });
  const tractGeoids = tractsIn.map(f => f.properties?.GEOID).filter(Boolean);
  setAnalysisTracts(tractsIn);

  const polyBbox = {
    xmin: Math.min(...ring.map(c => c[0])), ymin: Math.min(...ring.map(c => c[1])),
    xmax: Math.max(...ring.map(c => c[0])), ymax: Math.max(...ring.map(c => c[1])),
  };

  await fetchAndRenderAnalysis(firesIn, sheltsIn, volsIn, tractGeoids, "Polygon", polyBbox);
}

async function fetchAndRenderAnalysis(firesIn, sheltsIn, volsIn, tractGeoids, analysisType, bbox) {
  let sviRows = [], nriRows = [], aliceRows = [], femaRows = [];
  let parcelStats = null;

  // Show a loading skeleton while fetches are in flight — the panel is
  // otherwise blank for 2-4 seconds and feels broken.
  const resultsEl = document.getElementById("corridor-results");
  if (resultsEl) {
    resultsEl.innerHTML = `
      <div class="tp-hero" style="padding:18px 8px">
        <div class="tp-hero-label">${analysisType} Analysis</div>
        <div class="analyzing-dots" style="font-size:15px;font-weight:700;color:#a51c30;margin-top:6px">Analyzing <span>·</span><span>·</span><span>·</span></div>
        <div class="tp-hero-tract" style="margin-top:4px">Pulling SVI · NRI · ALICE · FEMA · parcels for ${tractGeoids.length} tract${tractGeoids.length === 1 ? "" : "s"}</div>
      </div>`;
    // Also open the accordion so the loader is visible
    const accSection = document.getElementById("acc-corridor-results");
    if (accSection) {
      accSection.classList.add("active");
      const accLabel = accSection.querySelector(".acc-label");
      if (accLabel) accLabel.textContent = `${analysisType} Analysis`;
      toggleAccordion("acc-corridor-results", true);
    }
  }

  const fetchPromises = [];
  if (tractGeoids.length) {
    const geoidSet = new Set(tractGeoids);
    const countyFips = [...new Set(tractGeoids.map(g => g.slice(0, 5)))];
    const countyFilter = `in.(${countyFips.join(",")})`;
    // SVI + NRI: pull from already-loaded in-memory maps (avoids URL-length 400s)
    sviRows = window._sviFullMap
      ? tractGeoids.map(g => window._sviFullMap.get(g)).filter(Boolean)
      : [];
    nriRows = window._nriMap
      ? tractGeoids.map(g => window._nriMap.get(g)).filter(Boolean)
      : [];
    fetchPromises.push(
      Promise.all([
        sbFetch("alice", `select=fips_5,county_name,median_income,pct_poverty,pct_alice,pct_struggling&fips_5=${countyFilter}`),
        // fema_declarations has no county_name column — we enrich from county_rankings/alice below
        sbFetch("fema_declarations", `select=fips_5,total_declarations,most_recent_title,hurricane_count,flood_count,top_hazard,declarations_per_year&fips_5=${countyFilter}`),
        sbFetch("county_rankings", `select=county_fips,county_name,population&county_fips=${countyFilter}`),
      ]).then(([a, f, cr]) => {
        // Build fips → { name, pop } map from county_rankings (fallback to alice for name)
        const nameByFips = {};
        const popByFips = {};
        (cr || []).forEach(r => {
          nameByFips[r.county_fips] = r.county_name;
          popByFips[r.county_fips] = r.population || 0;
        });
        (a || []).forEach(r => { if (!nameByFips[r.fips_5] && r.county_name) nameByFips[r.fips_5] = r.county_name; });
        // Enrich ALICE rows with population, FEMA rows with county_name
        aliceRows = (a || []).map(row => ({ ...row, population: popByFips[row.fips_5] || 0 }));
        femaRows = (f || []).map(row => ({ ...row, county_name: nameByFips[row.fips_5] || null }));
      })
    );
    fetchPromises.push(analyzeParcelsByTracts(tractGeoids, bbox).then(r => { parcelStats = r; }));
  }

  await Promise.all(fetchPromises);
  renderCorridorResults(firesIn, sheltsIn, volsIn, sviRows, nriRows, aliceRows, femaRows, analysisType, parcelStats);
  showResults(volsIn, "Volunteers in " + analysisType);
  document.getElementById("corridor-clear-btn").style.display = "";
  if (typeof window.openPanel === "function") window.openPanel("corridor");
}

function renderCorridorResults(firesIn, sheltsIn, volsIn, sviRows, nriRows, aliceRows, femaRows, analysisType, parcelStats) {
  const noRC = firesIn.filter(f => f.rc_responded === "no").length;
  const validSVI = sviRows.filter(r => r.rpl_themes >= 0);
  const avgRpl   = avg(validSVI, "rpl_themes");
  const totalPop = validSVI.reduce((s, r) => s + (r.e_totpop || 0), 0);
  const totalElderly = validSVI.reduce((s, r) => s + (r.e_age65 || 0), 0);
  const totalDisabled = validSVI.reduce((s, r) => s + (r.e_disabl || 0), 0);
  const validNRI = nriRows.filter(r => r.risk_score !== null);
  const flood = (r) => Math.max(r.cfld_risks ?? 0, r.ifld_risks ?? 0);
  const avgNriScore = validNRI.length ? avg(validNRI, "risk_score") : null;
  const totalEAL = validNRI.reduce((s, r) => s + (r.eal_valt || 0), 0);
  const avgStruggling = aliceRows.length ? aliceRows.reduce((s, r) => s + (r.pct_struggling || 0), 0) / aliceRows.length : null;
  const avgMedian = aliceRows.length ? Math.round(aliceRows.reduce((s, r) => s + (r.median_income || 0), 0) / aliceRows.length) : null;
  const totalDecl = femaRows.reduce((s, r) => s + (r.total_declarations || 0), 0);
  const totalHurr = femaRows.reduce((s, r) => s + (r.hurricane_count || 0), 0);
  const totalFlood = femaRows.reduce((s, r) => s + (r.flood_count || 0), 0);

  // Update KPI bar
  document.getElementById("stat-fires").textContent       = firesIn.length;
  document.getElementById("stat-no-response").textContent = noRC;
  document.getElementById("stat-shelters").textContent    = sheltsIn.length;
  document.getElementById("stat-volunteers").textContent  = volsIn.length;
  document.querySelector("#top-bar-sub").textContent      = `${analysisType} view — ${totalPop.toLocaleString()} residents`;

  const chapterMap = {};
  firesIn.forEach(f => { if (f.chapter) chapterMap[f.chapter] = (chapterMap[f.chapter] || 0) + 1; });
  const chapters = Object.entries(chapterMap).sort((a, b) => b[1] - a[1]);

  const accSection = document.getElementById("acc-corridor-results");
  accSection.classList.add("active");
  const accLabel = accSection.querySelector(".acc-label");
  if (accLabel) accLabel.textContent = `${analysisType} Analysis`;
  toggleAccordion("acc-corridor-results", true);
  // Scroll the results into view so users see them without hunting
  requestAnimationFrame(() => {
    accSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Shared helpers (mirror the tract popup for visual consistency)
  const num  = v => (v == null ? "—" : Number(v).toLocaleString());
  const int  = v => (v == null ? "—" : Math.round(Number(v)).toLocaleString());
  const compactMoney = v => {
    const n = Number(v) || 0;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
    return `$${Math.round(n).toLocaleString()}`;
  };
  const kv = (k, v) => `<div class="tp-kv"><span class="tp-kv-key">${k}</span><span class="tp-kv-val">${v}</span></div>`;
  const bar = (label, val, isScore, popForPct) => {
    if (val == null || isNaN(val)) return "";
    let display;
    if (isScore) {
      display = Math.round(val);
    } else {
      const pct = Math.round(val * 100);
      if (popForPct && popForPct > 0) {
        const absolute = Math.round(val * popForPct);
        display = `${pct}% · ${compactMoney(absolute).replace("$","")}`;
      } else {
        display = `${pct}%`;
      }
    }
    const fillPct = isScore ? val : val * 100;
    const color = isScore
      ? (val >= 80 ? "#e05070" : val >= 60 ? "#e07830" : val >= 40 ? "#d4b020" : val >= 20 ? "#78aa28" : "#6abf9e")
      : (val >= 0.75 ? "#e05070" : val >= 0.50 ? "#e07830" : val >= 0.25 ? "#d4b020" : "#78aa28");
    return `<div class="tp-bar-row"><div class="tp-bar-head"><span>${label}</span><span>${display}</span></div>
      <div class="tp-bar-track"><div class="tp-bar-fill" style="width:${Math.min(fillPct, 100)}%;background:${color}"></div></div></div>`;
  };

  // Combined risk hero (matches tract popup)
  let hero = "";
  if (avgRpl != null && avgNriScore != null) {
    const combined = Math.round((avgRpl * 100 + avgNriScore) / 2);
    const cCat = combined >= 75 ? { label: "Very High Combined Risk", color: "var(--risk-very-high)" }
               : combined >= 50 ? { label: "High Combined Risk", color: "var(--risk-high)" }
               : combined >= 25 ? { label: "Moderate Combined Risk", color: "var(--risk-moderate)" }
               : { label: "Low Combined Risk", color: "var(--risk-low)" };
    hero = `<div class="tp-hero">
      <div class="tp-hero-label">Combined Risk Score</div>
      <div class="tp-hero-score" style="color:${cCat.color}">${combined}</div>
      <div class="tp-hero-cat" style="color:${cCat.color}">${cCat.label}</div>
      <div class="tp-hero-tract">${analysisType} view · ${validSVI.length} tract${validSVI.length === 1 ? "" : "s"} · ${aliceRows.length} count${aliceRows.length === 1 ? "y" : "ies"}</div>
    </div>
    <div class="tp-caption">All data reflects tracts, parcels, and records within or touching the analysis area</div>`;
  }

  // FEMA — compact per-county cards under a single section header
  let femaBlock = "";
  if (femaRows.length) {
    const byDecl = [...femaRows].sort((a, b) => (b.total_declarations || 0) - (a.total_declarations || 0));
    const cards = byDecl.map(r => {
      const name = r.county_name || (r.fips_5 ? `County ${r.fips_5}` : "County");
      const last = (r.most_recent_title || "").trim();
      const decl = r.total_declarations || 0;
      const dpy = r.declarations_per_year || 0;
      const hazard = r.top_hazard || "Hurricane";
      const hurr = r.hurricane_count || 0;
      const flood = r.flood_count || 0;
      return `<div class="cc-card">
        <div class="cc-head"><span class="cc-name">${name}</span><span class="cc-lead" style="color:#a51c30">${decl}</span></div>
        <div class="cc-stats">
          <span>≈${dpy.toFixed(1)}/yr</span><span class="sep">·</span>
          <span>Top: <strong>${hazard}</strong></span><span class="sep">·</span>
          <span><strong>${hurr}</strong> hurricane</span><span class="sep">·</span>
          <span><strong>${flood}</strong> flood</span>
        </div>
        ${last ? `<div class="cc-recent">Most recent: <strong>${last}</strong></div>` : ""}
      </div>`;
    }).join("");
    femaBlock = `<details class="tp-acc"><summary class="tp-section">FEMA Disaster History</summary>${cards}</details>`;
  }

  const el = document.getElementById("corridor-results");
  el.innerHTML = `
    ${hero}

    <details open class="tp-acc">
      <summary class="tp-section" style="margin-top:0">Population & Response</summary>
      ${totalPop > 0    ? kv("Estimated population", `<strong>${num(totalPop)}</strong>`) : ""}
      ${totalElderly > 0 ? kv("Age 65+", `<strong>${num(totalElderly)}</strong>`) : ""}
      ${totalDisabled > 0 ? kv("Disabled", `<strong>${num(totalDisabled)}</strong>`) : ""}
      ${kv("Fires", `<strong>${firesIn.length}</strong> (${noRC} no RC response)`)}
      ${kv("Shelters", `<strong>${sheltsIn.length}</strong>`)}
      ${kv("DAT Volunteers", `<strong>${volsIn.length}</strong>`)}
    </details>

    ${parcelStats && parcelStats.total_parcels > 0 ? `
    <details open class="tp-acc">
      <summary class="tp-section">Property Data (Florida Parcels)</summary>
      <div class="corr-narrative"><strong>${num(parcelStats.total_parcels)}</strong> parcels totaling <strong>${compactMoney(parcelStats.total_assessed)}</strong> in assessed value (avg <strong>${compactMoney(parcelStats.avg_assessed)}</strong>).</div>
      <div class="tp-subhead">Composition</div>
      ${kv("Residential", num(parcelStats.residential))}
      ${kv("Commercial / other", num(parcelStats.commercial))}
      <div class="tp-subhead">Valuation</div>
      ${kv("Average", `<strong>${compactMoney(parcelStats.avg_assessed)}</strong>`)}
      ${kv("Median", compactMoney(parcelStats.median_assessed))}
      ${kv("Total", `<strong>${compactMoney(parcelStats.total_assessed)}</strong>`)}
      <div class="tp-subhead">Age</div>
      ${kv("Avg year built", parcelStats.avg_year_built)}
      ${kv("Pre-1970", num(parcelStats.pre_1970))}
      ${kv("Post-2000", num(parcelStats.post_2000))}
      <div class="tp-subhead">Scale</div>
      ${kv("Avg sq ft", num(parcelStats.avg_sqft))}
      ${kv("Total acres", int(parcelStats.total_acres))}
      <div class="tp-subhead">Luxury</div>
      ${kv("Over $500K", num(parcelStats.over_500k))}
      ${kv("Over $1M", num(parcelStats.over_1m))}
    </details>
    ` : ""}

    ${validSVI.length ? `
    <details open class="tp-acc">
      <summary class="tp-section">Social Vulnerability (SVI)</summary>
      <div class="tp-caption" style="text-align:left;margin:-2px 0 6px">Percentile rank vs. all US tracts · ${validSVI.length} tract${validSVI.length === 1 ? "" : "s"} · ${num(totalPop)} residents in scope</div>
      ${bar("Overall vulnerability", avgRpl, false)}
      ${bar("Socioeconomic", avg(validSVI, "rpl_theme1"), false)}
      ${bar("Household", avg(validSVI, "rpl_theme2"), false)}
      ${bar("Racial & Ethnic Minority", avg(validSVI, "rpl_theme3"), false)}
      ${bar("Housing & Transportation", avg(validSVI, "rpl_theme4"), false)}
    </details>
    ` : ""}

    ${validNRI.length ? `
    <details class="tp-acc">
      <summary class="tp-section">NRI Hazard Risk</summary>
      ${bar("Overall risk score", avgNriScore, true)}
      ${bar("Hurricane", avg(validNRI, "hrcn_risks"), true)}
      ${bar("Flood (max coastal/inland)", avg(validNRI.map(r => ({ flood: flood(r) })), "flood"), true)}
      ${bar("Tornado", avg(validNRI, "trnd_risks"), true)}
      ${bar("Wildfire", avg(validNRI, "wfir_risks"), true)}
      ${kv("Expected annual loss", `<strong>${compactMoney(totalEAL)}</strong>`)}
    </details>
    ` : ""}

    ${aliceRows.length ? (() => {
      const cards = aliceRows.map(r => {
        const pop = r.population || 0;
        const pct = r.pct_struggling || 0;
        const struggling = Math.round(pop * (pct / 100));
        const name = r.county_name || (r.fips_5 ? `County ${r.fips_5}` : "County");
        const color = pct >= 35 ? "#e05070" : pct >= 25 ? "#e07830" : pct >= 15 ? "#a16207" : "#78aa28";
        return `<div class="cc-card">
          <div class="cc-head"><span class="cc-name">${name}</span><span class="cc-lead" style="color:${color}">${Math.round(pct)}%</span></div>
          <div class="cc-bar-track"><div class="cc-bar-fill" style="width:${Math.min(pct, 100)}%;background:${color}"></div></div>
          <div class="cc-stats">
            <span><strong>${compactMoney(struggling).replace("$","")}</strong> struggling</span><span class="sep">·</span>
            <span>of <strong>${compactMoney(pop).replace("$","")}</strong> residents</span><span class="sep">·</span>
            <span>median <strong>$${num(r.median_income)}</strong></span>
          </div>
        </div>`;
      }).join("");
      return `<details class="tp-acc"><summary class="tp-section">Economic Hardship (ALICE)</summary>${cards}</details>`;
    })() : ""}

    ${femaBlock}

    ${chapters.length ? `
    <details class="tp-acc">
      <summary class="tp-section">RC Chapters in Corridor</summary>
      ${chapters.map(([ch, n]) => kv(ch, `${n} fire${n !== 1 ? "s" : ""}`)).join("")}
    </details>
    ` : ""}
  `;
}

// ── Draw tool buttons ───────────────────────────────────────────────────────
document.getElementById("corridor-miles").addEventListener("input", (e) => {
  document.getElementById("corridor-miles-val").textContent = e.target.value;
});

document.getElementById("corridor-draw-btn").addEventListener("click", () => {
  _isDrawing = true;
  draw.changeMode("draw_line_string");
  const btn = document.getElementById("corridor-draw-btn");
  btn.textContent = "Drawing…";
  btn.classList.add("drawing");
  document.querySelector('.panel-tab[data-tab="corridor"]')?.classList.add("drawing");
});

document.getElementById("radius-drop-btn").addEventListener("click", () => {
  _isDrawing = true;
  const btn = document.getElementById("radius-drop-btn");
  btn.textContent = "Click map…";
  btn.classList.add("drawing");
  document.querySelector('.panel-tab[data-tab="corridor"]')?.classList.add("drawing");

  if (_radiusClickHandler) { map.off("click", _radiusClickHandler); _radiusClickHandler = null; }

  _radiusClickHandler = async (e) => {
    map.off("click", _radiusClickHandler);
    _radiusClickHandler = null;
    _isDrawing = false;
    document.querySelector('.panel-tab[data-tab="corridor"]')?.classList.remove("drawing");
    btn.textContent = "Analyzing…";
    const miles = parseInt(document.getElementById("corridor-miles").value, 10);
    await runRadiusAnalysis(e.lngLat, miles);
    btn.textContent = "Radius";
    btn.classList.remove("drawing");
  };
  map.on("click", _radiusClickHandler);
});

document.getElementById("polygon-draw-btn").addEventListener("click", () => {
  _isDrawing = true;
  draw.changeMode("draw_polygon");
  const btn = document.getElementById("polygon-draw-btn");
  btn.textContent = "Drawing…";
  btn.classList.add("drawing");
  document.querySelector('.panel-tab[data-tab="corridor"]')?.classList.add("drawing");
});

document.getElementById("corridor-clear-btn").addEventListener("click", () => {
  map.getSource("corridor").setData(EMPTY_FC);
  map.getSource("highlight").setData(EMPTY_FC);
  draw.deleteAll();
  if (_radiusClickHandler) { map.off("click", _radiusClickHandler); _radiusClickHandler = null; }
  _isDrawing = false;
  document.querySelector('.panel-tab[data-tab="corridor"]')?.classList.remove("drawing");
  document.getElementById("radius-drop-btn").textContent = "Radius";
  document.getElementById("radius-drop-btn").classList.remove("drawing");
  document.getElementById("polygon-draw-btn").textContent = "Polygon";
  document.getElementById("polygon-draw-btn").classList.remove("drawing");
  document.getElementById("corridor-draw-btn").textContent = "Line";
  document.getElementById("corridor-draw-btn").classList.remove("drawing");
  document.getElementById("corridor-results").innerHTML = "";
  document.getElementById("results-list").innerHTML = '<div id="no-results">Run a query or draw a corridor</div>';
  document.getElementById("corridor-clear-btn").style.display = "none";
  const accCR = document.getElementById("acc-corridor-results");
  accCR.classList.remove("active");
  const accLabel = accCR.querySelector(".acc-label");
  if (accLabel) accLabel.textContent = "Corridor Analysis";
  toggleAccordion("acc-corridor-results", false);
  toggleAccordion("acc-results", false);
  // Reset KPI
  if (window._data) {
    const { fires, shelters, volunteers } = window._data;
    document.getElementById("stat-fires").textContent       = fires.length;
    document.getElementById("stat-no-response").textContent = fires.filter(f => f.rc_responded === "no").length;
    document.getElementById("stat-shelters").textContent    = shelters.length;
    document.getElementById("stat-volunteers").textContent  = volunteers.length;
  }
  const _st = window._currentState || { name: "Florida" };
  // Restore the full sub label if we have the tract count cached; otherwise fall back
  const tractCount = (_tractFeatures || []).length;
  document.querySelector("#top-bar-sub").textContent = tractCount
    ? `${_st.name} — 7 datasets · ${tractCount.toLocaleString()} census tracts`
    : `${_st.name} — 7 datasets`;
});

// ── Accordion ───────────────────────────────────────────────────────────────
function toggleAccordion(id, forceOpen) {
  const section = document.getElementById(id);
  if (!section) return;
  const header = section.querySelector(".acc-header");
  const body   = section.querySelector(".acc-body");
  const willOpen = (forceOpen !== undefined) ? forceOpen : body.classList.contains("closed");
  body.classList.toggle("closed", !willOpen);
  // Chevron rotates via CSS on .acc-header.is-open — no character swap needed
  header.classList.toggle("is-open", willOpen);
}
window.toggleAccordion = toggleAccordion;

// ── Result cards ────────────────────────────────────────────────────────────
function _renderResultCards(items) {
  return items.map((item, i) => {
    const isFire    = "fire_id"      in item;
    const isShelter = "shelter_id"   in item;
    const isVol     = "volunteer_id" in item;
    let title = "", meta = "", chapter = "", badges = [];

    if (isFire) {
      title = item.address || item.fire_id;
      meta = [item.city, item.zip_code].filter(Boolean).join(" · ");
      chapter = item.chapter || "";
      if (item.damage_level === "destroyed") badges.push(["badge-red", "destroyed"]);
      else if (item.damage_level === "major") badges.push(["badge-orange", "major"]);
      else badges.push(["badge-gray", "minor"]);
      if (item.rc_responded === "no") badges.push(["badge-red", "no RC"]);
      else badges.push(["badge-green", "RC responded"]);
      if (item.elderly_present === "yes") badges.push(["badge-orange", "elderly"]);
    } else if (isShelter) {
      title = item.name || item.shelter_id;
      const pct = item.capacity > 0 ? Math.round(item.current_occupancy / item.capacity * 100) : "?";
      meta = `${item.zip_code || ""} · ${pct}% full`;
      chapter = item.chapter || "";
      const sc = item.status === "open" ? "badge-green" : item.status === "full" ? "badge-red" : "badge-gray";
      badges.push([sc, item.status || "—"]);
    } else if (isVol) {
      title = item.name || item.volunteer_id;
      meta = item.zip_code || "";
      chapter = item.chapter || "";
      const ac = item.availability === "available" ? "badge-green" : item.availability === "deployed" ? "badge-orange" : "badge-gray";
      badges.push([ac, item.availability || "—"]);
      if (item.certified === "yes") badges.push(["badge-blue", "certified"]);
    } else {
      title = Object.values(item).slice(0, 2).filter(Boolean).join(" · ") || "Record";
      meta = Object.entries(item).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(" · ");
    }

    const distStr = item._dist ? ` · ${(item._dist / 1000).toFixed(1)} km` : "";
    const badgeHtml = badges.map(([cls, txt]) => `<span class="badge ${cls}">${txt}</span>`).join("");
    const hasCoords = item.lat && item.lon;
    const clickAttr = hasCoords ? `onclick="window._zoomToResult(${i})"` : "";
    const cursorStyle = hasCoords ? "cursor:pointer" : "";

    return `<div class="result-card" data-idx="${i}" ${clickAttr} style="${cursorStyle}">
      <div class="result-title">${title}${hasCoords ? ' <span style="font-size:10px;color:var(--text-muted)">↗</span>' : ''}</div>
      <div class="result-meta">${meta}${distStr}</div>
      ${chapter ? `<div class="result-chapter">${chapter}</div>` : ""}
      ${badgeHtml ? `<div class="result-badges">${badgeHtml}</div>` : ""}
    </div>`;
  }).join("");
}

function showResults(items, label) {
  const list = document.getElementById("results-list");
  const accHdr = document.querySelector("#acc-results .acc-label");
  if (accHdr) accHdr.textContent = `${label} (${items.length})`;
  if (!items.length) {
    list.innerHTML = '<div id="no-results">No results found</div>';
    toggleAccordion("acc-results", false);
    return;
  }
  toggleAccordion("acc-results", false);
  list.innerHTML = _renderResultCards(items);
  window._resultItems = items;
}

window._zoomToResult = (idx) => {
  const item = window._resultItems?.[idx];
  if (!item || !item.lat || !item.lon) return;
  map.getSource("highlight").setData({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [item.lon, item.lat] }, properties: {} }],
  });
  map.flyTo({ center: [item.lon, item.lat], zoom: 12, duration: 800 });
};

// ── Query handler ───────────────────────────────────────────────────────────
const queryInput  = document.getElementById("query-input");
const queryBtn    = document.getElementById("query-btn");
const queryStatus = document.getElementById("query-status");

queryBtn.addEventListener("click", runQuery);
queryInput.addEventListener("keydown", e => { if (e.key === "Enter") runQuery(); });

const FL_CITIES = {
  orlando: [28.5383, -81.3792], miami: [25.7617, -80.1918], tampa: [27.9506, -82.4572],
  jacksonville: [30.3322, -81.6557], tallahassee: [30.4383, -84.2807],
  gainesville: [29.6516, -82.3248], pensacola: [30.4213, -87.2169],
  "fort lauderdale": [26.1224, -80.1373], naples: [26.1420, -81.7948],
  sarasota: [27.3364, -82.5307], "fort myers": [26.6406, -81.8723],
  "west palm beach": [26.7153, -80.0534], clearwater: [27.9659, -82.8001],
};

async function runQuery() {
  const q = queryInput.value.trim();
  if (!q) return;
  map.getSource("corridor").setData(EMPTY_FC);
  map.getSource("highlight").setData(EMPTY_FC);

  const hdr = document.getElementById("query-results-header");
  const list = document.getElementById("query-results-list");
  if (hdr) { hdr.style.display = "none"; hdr.textContent = ""; }
  if (list) list.innerHTML = "";

  queryBtn.disabled = true;
  queryStatus.textContent = "Asking Claude…";

  try {
    // Spatial shortcut
    const qLow = q.toLowerCase();
    const spatialMatch = qLow.match(/(\d+)\s*(km|miles?)/);
    const cityMatch = Object.entries(FL_CITIES).find(([c]) => qLow.includes(c));

    if (spatialMatch && cityMatch && window._data) {
      const dist = parseFloat(spatialMatch[1]);
      const unit = spatialMatch[2];
      const meters = unit.startsWith("km") ? dist * 1000 : dist * 1609.34;
      const [lat, lon] = cityMatch[1];
      const haversine = (lat1, lon1, lat2, lon2) => {
        const R = 6371000, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
        const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      };
      const { fires, shelters, volunteers } = window._data;
      const isShelterQ = qLow.includes("shelter");
      const isVolQ = qLow.includes("volunteer") || qLow.includes("certified");
      const pool = isShelterQ ? shelters : isVolQ ? volunteers : fires;
      let results = pool.map(r => ({ ...r, _dist: haversine(lat, lon, r.lat, r.lon) })).filter(r => r._dist <= meters);
      results.sort((a, b) => a._dist - b._dist);

      const label = `Within ${dist}${unit} of ${cityMatch[0]} — ${results.length} result${results.length !== 1 ? "s" : ""}`;
      queryStatus.textContent = label;
      queryBtn.disabled = false;
      renderQueryResults(results.slice(0, 50), label);
      if (results.length > 0) {
        const bounds = results.reduce((b, r) => b.extend([r.lon, r.lat]), new maplibregl.LngLatBounds());
        map.fitBounds(bounds, { padding: 50, duration: 800 });
      }
      return;
    }

    // ── Smart-query: Claude routes to SQL + LightRAG + full-text as needed ──
    // Proxies to explorer.jbf.com's endpoint (the county intelligence reasoning engine).
    // Pre-seeds context with the state currently loaded on the map.
    const st = window._currentState || { abbr: "FL", name: "Florida" };
    const contextPrefix = `[Context: user is viewing ops.jbf.com with ${st.name} (${st.abbr}) currently loaded. When relevant, scope SQL queries to this state. Answer as a Red Cross operations analyst — prioritize chapter/region/division framing and actionable insight over raw numbers.]\n\n`;

    queryStatus.textContent = "Consulting smart-query…";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    const smartRes = await fetch("https://explorer.jbf.com/api/smart-query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: contextPrefix + q }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const rawBody = await smartRes.text();
    if (!smartRes.ok) {
      throw new Error(`smart-query ${smartRes.status}: ${rawBody.slice(0, 160)}`);
    }
    const data = JSON.parse(rawBody);
    const answer = data.answer || "(no answer returned)";

    // Figure out which tools were used for the source label
    const tools = (data.trace || []).map(t => t.tool);
    const sources = [];
    if (tools.includes("supabase_sql")) sources.push("database");
    if (tools.includes("lightrag_query")) sources.push("knowledge graph");
    if (tools.includes("text_search")) sources.push("full-text");
    const sourceLabel = sources.length ? sources.join(" + ") : "Claude";

    queryStatus.textContent = `Answered via ${sourceLabel}`;
    queryBtn.disabled = false;

    // Render the markdown answer in the results panel
    if (hdr && list) {
      hdr.style.display = "block";
      hdr.textContent = "▼ Answer";
      const rendered = (window.marked && window.marked.parse)
        ? window.marked.parse(answer)
        : `<pre style="white-space:pre-wrap;font-family:inherit">${answer.replace(/[<>&]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]))}</pre>`;
      list.innerHTML = `<div class="result-card" style="padding:14px 14px;line-height:1.55;font-size:13px">${rendered}</div>`;
    }

    // Highlight any county FIPS codes mentioned in the answer
    const fipsMatches = [...answer.matchAll(/\bFIPS[:\s]*(\d{5})\b|\b(\d{5})\b(?=[^0-9]|$)/g)]
      .map(m => m[1] || m[2])
      .filter((v, i, a) => v && a.indexOf(v) === i)
      .slice(0, 20);
    // (Lat/lon plotting omitted — smart-query returns narrative, not rows.
    //  If the answer references specific counties, we could geocode FIPS → centroid
    //  via a future map-context tool; for now we just display the text.)

  } catch (err) {
    if (err.name === "AbortError") {
      queryStatus.textContent = "Query timed out after 90s";
    } else {
      queryStatus.textContent = `Error: ${err.message}`;
    }
    queryBtn.disabled = false;
  }
}
window.runQuery = runQuery;

function renderQueryResults(items, label) {
  const hdr = document.getElementById("query-results-header");
  const list = document.getElementById("query-results-list");
  if (!hdr || !list) return;
  hdr.style.display = "block";
  hdr.textContent = `▼ ${label} (${items.length})`;
  if (!items.length) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No results found</div>';
    return;
  }
  list.innerHTML = _renderResultCards(items);
  window._resultItems = items;
}

// ── Feature popup HTML builders ─────────────────────────────────────────────
function buildFeaturePopupHTML(type, attrs) {
  const a = attrs;
  const svi = a.geoid ? window._sviFullMap?.get(String(a.geoid)) : null;
  const nri = a.geoid ? window._nriMap?.get(String(a.geoid)) : null;
  const pct = v => (v != null && v >= 0) ? Math.round(v * 100) + "%" : "—";
  const sc = v => (v != null) ? Math.round(v) : "—";

  function row(label, value) {
    return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-color)">
      <span style="color:var(--text-muted);font-size:12px">${label}</span>
      <span style="font-weight:600;font-size:12px">${value}</span></div>`;
  }
  function sectionTitle(text) {
    return `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#a51c30;margin:14px 0 6px;padding-top:8px;border-top:1px solid var(--border-color)">${text}</div>`;
  }

  let html = "";
  if (type === "fire") {
    const respColor = a.rc_responded === "no" ? "#ED1B2E" : "#2d8a4e";
    const respLabel = a.rc_responded === "no" ? "NO RC RESPONSE" : "RC RESPONDED";
    html += `<div style="margin-bottom:8px"><span style="background:${respColor};color:#fff;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:bold">${respLabel}</span>
      <span style="background:#f0f0f0;color:#555;padding:2px 8px;border-radius:3px;font-size:10px;margin-left:4px;font-weight:600">${(a.damage_level||'unknown').toUpperCase()}</span></div>`;
    html += row("Date", a.date || "—") + row("City", a.city || "—") + row("ZIP", a.zip_code || "—");
    html += row("Elderly Present", a.elderly_present === "yes" ? "Yes" : "No") + row("Chapter", a.chapter || "—");
  } else if (type === "shelter") {
    const statusColor = a.status === "open" ? "#2d8a4e" : a.status === "full" ? "#e67e22" : "#999";
    const pctFull = a.capacity > 0 ? Math.round(a.current_occupancy / a.capacity * 100) : 0;
    html += `<div style="margin-bottom:10px"><span style="background:${statusColor};color:#fff;padding:3px 10px;border-radius:3px;font-size:11px;font-weight:bold">${(a.status||'unknown').toUpperCase()}</span></div>
      <div style="margin:8px 0"><div style="font-size:11px;color:var(--text-muted)">Occupancy: ${a.current_occupancy||0} / ${a.capacity||0} (${pctFull}%)</div>
      <div style="background:var(--bg-section);border-radius:4px;height:10px;overflow:hidden"><div style="background:${statusColor};width:${pctFull}%;height:100%;border-radius:4px"></div></div></div>`;
    html += row("ZIP", a.zip_code || "—") + row("Chapter", a.chapter || "—");
  } else if (type === "volunteer") {
    const availColor = a.availability === "available" ? "#2d8a4e" : a.availability === "deployed" ? "#e67e22" : "#999";
    html += `<div style="margin-bottom:10px"><span style="background:${availColor};color:#fff;padding:3px 10px;border-radius:3px;font-size:11px;font-weight:bold">${(a.availability||'unknown').toUpperCase()}</span>
      <span style="background:${a.certified==='yes'?'#1565C0':'#999'};color:#fff;padding:3px 10px;border-radius:3px;font-size:11px;margin-left:4px;font-weight:600">${a.certified==='yes'?'CERTIFIED':'NOT CERTIFIED'}</span></div>`;
    html += row("ZIP", a.zip_code || "—") + row("Chapter", a.chapter || "—");
  }

  if (svi || nri) {
    html += sectionTitle("Census Tract " + (a.geoid || ""));
    if (svi) {
      html += row("Population", (svi.e_totpop||0).toLocaleString());
      html += row("SVI Overall", pct(svi.rpl_themes));
    }
    if (nri) {
      html += row("NRI Risk Score", sc(nri.risk_score));
      html += row("Hurricane", sc(nri.hrcn_risks));
      html += row("Flood", sc(Math.max(nri.cfld_risks||0, nri.ifld_risks||0)));
    }
  }

  return html;
}

function buildParcelPopupHTML(a, tileProps) {
  tileProps = tileProps || {};
  a = a || {};
  const fmt = v => v != null && v !== "" ? Number(v).toLocaleString() : null;
  const compactMoney = v => {
    const n = Number(v) || 0;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
    return `$${Math.round(n).toLocaleString()}`;
  };
  const kv = (k, v) => `<div class="tp-kv"><span class="tp-kv-key">${k}</span><span class="tp-kv-val">${v}</span></div>`;

  const val = Number(a.val) || Number(tileProps.val) || 0;
  const mv = Number(a.mv) || 0;
  const yb = a.yb || tileProps.yb || null;
  const sf = Number(a.sf) || 0;
  const acres = a.acres ? Number(a.acres) : null;
  const uc = a.uc || tileProps.uc || null;
  const isRes = a.res != null ? !!a.res : (tileProps.res ? true : null);

  const cat = val >= 1e6 ? "#e05070"
            : val >= 5e5 ? "#e07830"
            : val >= 3e5 ? "#a16207"
            : val >= 1.5e5 ? "#78aa28"
            : val >= 5e4 ? "#6abf9e"
            : "#888";

  let html = "";

  if (val > 0) {
    const subParts = [];
    if (yb) subParts.push(`Built ${yb}`);
    if (sf > 0) subParts.push(`${fmt(sf)} sq ft`);
    if (acres) subParts.push(`${acres} ac`);
    html += `<div class="tp-hero">
      <div class="tp-hero-label">Assessed Value</div>
      <div class="tp-hero-score" style="color:${cat}">${compactMoney(val)}</div>
      ${mv > 0 && mv !== val ? `<div class="tp-hero-cat" style="color:${cat}">Market ${compactMoney(mv)}</div>` : ""}
      ${subParts.length ? `<div class="tp-hero-tract">${subParts.join(" · ")}</div>` : ""}
    </div>`;
  }

  html += `<div class="tp-section" style="margin-top:0">Property Details</div>`;
  if (a.addr) html += kv("Address", a.addr);
  if (a.owner) html += kv("Owner", a.owner);
  const locParts = [a.city, a.zip].filter(Boolean);
  if (locParts.length) html += kv("City / ZIP", locParts.join(" "));
  if (a.county) html += kv("County", a.county);
  if (yb) html += kv("Year built", yb);
  if (sf > 0) html += kv("Square feet", fmt(sf));
  if ((a.bd || a.ba) && (a.bd || 0) + (a.ba || 0) > 0) html += kv("Bed / Bath", `${a.bd || 0} / ${a.ba || 0}`);
  if (acres) html += kv("Acres", acres);
  if (uc) html += kv("Use code", isRes === true ? `${uc} · Residential` : isRes === false ? `${uc} · Commercial / other` : uc);

  if (mv > 0 && val > 0) {
    html += `<div class="tp-section">Valuation</div>`;
    html += kv("Assessed", compactMoney(val));
    if (mv !== val) html += kv("Market", compactMoney(mv));
    if (mv > 0) {
      const ratio = Math.round((val / mv) * 100);
      html += kv("Assessed / Market", `${ratio}%`);
    }
  }

  // Async Red Cross chapter / region / division lookup by county
  if (a.county) {
    const asyncId = "parcel-rc-" + Date.now();
    html += `<div id="${asyncId}"></div>`;
    setTimeout(() => {
      const countyQuery = encodeURIComponent(a.county);
      sbFetch("county_rankings", `select=chapter,region,division&county_name=ilike.${countyQuery}*&state_abbr=eq.FL&limit=1`).then(r => {
        const el = document.getElementById(asyncId);
        if (!el || !r?.[0]) return;
        const cr = r[0];
        let extra = `<div class="tp-section">Red Cross Coverage</div>`;
        if (cr.chapter) extra += kv("Chapter", cr.chapter);
        if (cr.region) extra += kv("Region", cr.region);
        if (cr.division) extra += kv("Division", cr.division);
        el.innerHTML = extra;
      }).catch(() => {});
    }, 0);
  }

  // No-API fallback note
  if (!a.owner && !a.addr) {
    html += `<div class="tp-caption" style="text-align:left">Limited data — detailed owner/address records not available for this parcel.</div>`;
  }

  return html;
}

function buildTractPopupHTML(geoid, bbox) {
  const svi = window._sviFullMap?.get(geoid);
  const nri = window._nriMap?.get(geoid);
  const pct = v => (v != null && v >= 0) ? Math.round(v * 100) + "%" : "—";
  const num = v => (v != null) ? (+v).toLocaleString() : "—";
  const compactMoney = v => {
    const n = Number(v) || 0;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
    return `$${Math.round(n).toLocaleString()}`;
  };

  function bar(label, val, isScore, popForPct) {
    if (val == null || isNaN(val)) return "";
    let display;
    if (isScore) {
      display = Math.round(val);
    } else {
      const pct = Math.round(val * 100);
      if (popForPct && popForPct > 0) {
        const absolute = Math.round(val * popForPct);
        display = `${pct}% · ${compactMoney(absolute).replace("$","")}`;
      } else {
        display = `${pct}%`;
      }
    }
    const fillPct = isScore ? val : val * 100;
    const color = isScore
      ? (val >= 80 ? "#e05070" : val >= 60 ? "#e07830" : val >= 40 ? "#d4b020" : val >= 20 ? "#78aa28" : "#6abf9e")
      : (val >= 0.75 ? "#e05070" : val >= 0.50 ? "#e07830" : val >= 0.25 ? "#d4b020" : "#78aa28");
    return `<div class="tp-bar-row"><div class="tp-bar-head"><span>${label}</span><span>${display}</span></div>
      <div class="tp-bar-track"><div class="tp-bar-fill" style="width:${Math.min(fillPct, 100)}%;background:${color}"></div></div></div>`;
  }
  function kv(key, val) {
    return `<div class="tp-kv"><span class="tp-kv-key">${key}</span><span class="tp-kv-val">${val}</span></div>`;
  }

  let html = "";
  const sviVal = svi?.rpl_themes;
  const nriVal = nri?.risk_score;

  if (sviVal != null && sviVal >= 0 && nriVal != null) {
    const combined = Math.round((sviVal * 100 + nriVal) / 2);
    const cCat = combined >= 75 ? { label: "Very High Combined Risk", color: "var(--risk-very-high)" }
               : combined >= 50 ? { label: "High Combined Risk", color: "var(--risk-high)" }
               : combined >= 25 ? { label: "Moderate Combined Risk", color: "var(--risk-moderate)" }
               : { label: "Low Combined Risk", color: "var(--risk-low)" };
    html += `<div class="tp-hero"><div class="tp-hero-label">Combined Risk Score</div>
      <div class="tp-hero-score" style="color:${cCat.color}">${combined}</div>
      <div class="tp-hero-cat" style="color:${cCat.color}">${cCat.label}</div>
      <div class="tp-hero-tract">${svi?.location || ("Tract " + geoid)}</div></div>`;
  }

  if (svi) {
    html += `<details open class="tp-acc"><summary class="tp-section">Population</summary>`;
    html += kv("Total Population", num(svi.e_totpop));
    if (svi.e_age65) html += kv("Age 65+", num(svi.e_age65));
    if (svi.e_disabl) html += kv("Disabled", num(svi.e_disabl));
    html += `</details>`;
    html += `<details open class="tp-acc"><summary class="tp-section">SVI Sub-Themes</summary>`;
    html += `<div class="tp-caption" style="text-align:left;margin:-2px 0 6px">Percentile rank vs. all US tracts</div>`;
    html += bar("Socioeconomic Status", svi.rpl_theme1, false);
    html += bar("Household Characteristics", svi.rpl_theme2, false);
    html += bar("Racial & Ethnic Minority", svi.rpl_theme3, false);
    html += bar("Housing & Transportation", svi.rpl_theme4, false);
    html += `</details>`;
  }

  if (nri) {
    const hazards = [
      ["Hurricane", nri.hrcn_risks], ["Coastal Flood", nri.cfld_risks],
      ["Inland Flood", nri.ifld_risks], ["Tornado", nri.trnd_risks],
      ["Wildfire", nri.wfir_risks], ["Heat Wave", nri.hwav_risks],
    ].filter(([,v]) => v != null && v > 0).sort((a,b) => b[1] - a[1]);
    if (hazards.length) {
      html += `<details class="tp-acc"><summary class="tp-section">Top Hazard Risks</summary>`;
      hazards.forEach(([label, val]) => html += bar(label, val, true));
      html += `</details>`;
    }
  }

  // Async ALICE + FEMA + Parcels fetch
  const countyFips = geoid.slice(0, 5);
  const asyncId = "tract-async-" + Date.now();
  html += `<div id="${asyncId}"><div class="tp-caption" style="text-align:left;margin:10px 0 0">
    <span class="analyzing-dots">Loading county context <span>·</span><span>·</span><span>·</span></span>
  </div></div>`;
  const parcelPromise = bbox
    ? fetch(`${PARCEL_API}/api/stats?xmin=${bbox.xmin}&ymin=${bbox.ymin}&xmax=${bbox.xmax}&ymax=${bbox.ymax}`).then(r => r.ok ? r.json() : null).catch(() => null)
    : Promise.resolve(null);
  setTimeout(() => {
    Promise.all([
      sbFetch("alice", "select=*&fips_5=eq." + countyFips),
      sbFetch("fema_declarations", "select=*&fips_5=eq." + countyFips),
      sbFetch("county_rankings", "select=county_fips,county_name,population&county_fips=eq." + countyFips),
      parcelPromise,
    ]).then(([a, f, cr, p]) => {
      const el = document.getElementById(asyncId);
      if (!el) return;
      const countyPop = cr?.[0]?.population || 0;
      // fema_declarations has no county_name — resolve from county_rankings or alice
      const resolvedCountyName = cr?.[0]?.county_name || a?.[0]?.county_name || null;
      let extra = "";

      // Property Data — grouped sub-sections (rendered FIRST, default open)
      if (p && p.total_parcels > 0) {
        extra += `<details open class="tp-acc"><summary class="tp-section">Property Data (Florida Parcels)</summary>`;
        const totalVal = p.total_assessed != null ? compactMoney(p.total_assessed) : null;
        const avgVal = p.avg_assessed != null ? compactMoney(p.avg_assessed) : null;
        if (totalVal && avgVal) {
          extra += `<div class="corr-narrative"><strong>${num(p.total_parcels)}</strong> parcels totaling <strong>${totalVal}</strong> in assessed value (avg <strong>${avgVal}</strong>).</div>`;
        }
        if (p.residential != null || p.commercial != null) {
          extra += `<div class="tp-subhead">Composition</div>`;
          if (p.residential != null) extra += kv("Residential", num(p.residential));
          if (p.commercial != null) extra += kv("Commercial / other", num(p.commercial));
        }
        if (avgVal || p.median_assessed != null || totalVal) {
          extra += `<div class="tp-subhead">Valuation</div>`;
          if (avgVal) extra += kv("Average", `<strong>${avgVal}</strong>`);
          if (p.median_assessed != null) extra += kv("Median", compactMoney(p.median_assessed));
          if (totalVal) extra += kv("Total", `<strong>${totalVal}</strong>`);
        }
        if (p.avg_year_built || p.pre_1970 != null || p.post_2000 != null) {
          extra += `<div class="tp-subhead">Age</div>`;
          if (p.avg_year_built) extra += kv("Avg year built", Math.round(p.avg_year_built));
          if (p.pre_1970 != null) extra += kv("Pre-1970", num(p.pre_1970));
          if (p.post_2000 != null) extra += kv("Post-2000", num(p.post_2000));
        }
        if (p.avg_sqft != null || p.total_acres != null) {
          extra += `<div class="tp-subhead">Scale</div>`;
          if (p.avg_sqft != null) extra += kv("Avg sq ft", num(p.avg_sqft));
          if (p.total_acres != null) extra += kv("Total acres", Math.round(p.total_acres).toLocaleString());
        }
        if (p.over_500k != null || p.over_1m != null) {
          extra += `<div class="tp-subhead">Luxury</div>`;
          if (p.over_500k != null) extra += kv("Over $500K", num(p.over_500k));
          if (p.over_1m != null) extra += kv("Over $1M", num(p.over_1m));
        }
        extra += `</details>`;
      }

      // Economic Hardship — compact card (default collapsed)
      if (a?.[0]) {
        const ar = a[0];
        const pct = ar.pct_struggling || 0;
        const struggling = countyPop > 0 ? Math.round(countyPop * (pct / 100)) : null;
        const name = ar.county_name || `County ${countyFips}`;
        const color = pct >= 35 ? "#e05070" : pct >= 25 ? "#e07830" : pct >= 15 ? "#a16207" : "#78aa28";
        const statsParts = [];
        if (struggling != null) statsParts.push(`<span><strong>${compactMoney(struggling).replace("$","")}</strong> struggling</span>`);
        if (countyPop > 0) statsParts.push(`<span>of <strong>${compactMoney(countyPop).replace("$","")}</strong> residents</span>`);
        if (ar.median_income) statsParts.push(`<span>median <strong>$${num(ar.median_income)}</strong></span>`);
        extra += `<details class="tp-acc"><summary class="tp-section">Economic Hardship (ALICE)</summary>
          <div class="cc-card">
            <div class="cc-head"><span class="cc-name">${name}</span><span class="cc-lead" style="color:${color}">${Math.round(pct)}%</span></div>
            <div class="cc-bar-track"><div class="cc-bar-fill" style="width:${Math.min(pct, 100)}%;background:${color}"></div></div>
            <div class="cc-stats">${statsParts.join('<span class="sep">·</span>')}</div>
          </div></details>`;
      }

      // FEMA — compact card (default collapsed)
      if (f?.[0]) {
        const fr = f[0];
        const name = resolvedCountyName || `County ${countyFips}`;
        const last = (fr.most_recent_title || "").trim();
        const decl = fr.total_declarations || 0;
        const dpy = fr.declarations_per_year != null ? Number(fr.declarations_per_year).toFixed(1) : null;
        const hazard = fr.top_hazard || "Hurricane";
        const hurr = fr.hurricane_count || 0;
        const flood = fr.flood_count || 0;
        const statsParts = [];
        if (dpy) statsParts.push(`<span>≈${dpy}/yr</span>`);
        statsParts.push(`<span>Top: <strong>${hazard}</strong></span>`);
        statsParts.push(`<span><strong>${hurr}</strong> hurricane</span>`);
        statsParts.push(`<span><strong>${flood}</strong> flood</span>`);
        extra += `<details class="tp-acc"><summary class="tp-section">FEMA Disaster History</summary>
          <div class="cc-card">
            <div class="cc-head"><span class="cc-name">${name}</span><span class="cc-lead" style="color:#a51c30">${decl}</span></div>
            <div class="cc-stats">${statsParts.join('<span class="sep">·</span>')}</div>
            ${last ? `<div class="cc-recent">Most recent: <strong>${last}</strong></div>` : ""}
          </div></details>`;
      }

      if (!extra) {
        extra = `<div class="tp-caption" style="text-align:left;margin:10px 0 0">No county-level ALICE, FEMA, or parcel data for this tract.</div>`;
      }
      el.innerHTML = extra;
    }).catch(() => {
      el.innerHTML = `<div class="tp-caption" style="text-align:left;color:#c0392b;margin:10px 0 0">County data unavailable — check network or Supabase.</div>`;
    });
  }, 0);

  return html || '<div style="color:#888;text-align:center;padding:16px 0">No data for this tract.</div>';
}

function showFeaturePanel(title, html) {
  document.getElementById("feature-info-title").textContent = title;
  document.getElementById("feature-info-content").innerHTML = html;
  openPanel("feature");
}

// ── Panel switching ─────────────────────────────────────────────────────────
function switchTab(name) {
  const panel = document.getElementById("right-panel");
  const panels = ["ctx-layers", "ctx-corridor", "ctx-query", "ctx-feature"];
  if (panel.classList.contains("open") && panel.dataset.active === name) {
    closePanel(); return;
  }
  panels.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === "ctx-" + name) ? "flex" : "none";
  });
  panel.classList.add("open");
  panel.dataset.active = name;
  panel.dataset.lastTab = name;
  document.querySelectorAll(".panel-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.getElementById("panel-toggle").textContent = "✕";
}
window.switchTab = switchTab;

function openPanel(name) {
  const panel = document.getElementById("right-panel");
  const panels = ["ctx-layers", "ctx-corridor", "ctx-query", "ctx-feature"];
  panels.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === "ctx-" + name) ? "flex" : "none";
  });
  panel.classList.add("open");
  panel.dataset.active = name;
  if (name !== "feature") panel.dataset.lastTab = name;
  document.querySelectorAll(".panel-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.getElementById("panel-toggle").textContent = "✕";
}
window.openPanel = openPanel;

function closePanel() {
  const panel = document.getElementById("right-panel");
  panel.classList.remove("open");
  panel.dataset.active = "";
  document.querySelectorAll(".panel-tab").forEach(t => t.classList.remove("active"));
  document.getElementById("panel-toggle").textContent = "☰";
}
window.closePanel = closePanel;

function togglePanel() {
  const panel = document.getElementById("right-panel");
  if (panel.classList.contains("open")) { closePanel(); }
  else { openPanel(panel.dataset.lastTab || "layers"); }
}
window.togglePanel = togglePanel;

// ── Reset map ───────────────────────────────────────────────────────────────
function resetMap() {
  closePanel();
  map.getSource("corridor").setData(EMPTY_FC);
  map.getSource("highlight").setData(EMPTY_FC);
  map.getSource("analysis-tracts").setData(EMPTY_FC);
  setParcelMask(null);
  _analysisTracts = [];
  _tractLayerVisible = false;
  map.setLayoutProperty("analysis-tracts-fill", "visibility", "none");
  map.setLayoutProperty("analysis-tracts-outline", "visibility", "none");
  document.getElementById("fab-tracts")?.classList.remove("active");
  draw.deleteAll();
  if (_radiusClickHandler) { map.off("click", _radiusClickHandler); _radiusClickHandler = null; }
  _isDrawing = false;

  // Restore all point layers visibility
  ["fires-no-rc", "fires-rc", "shelters-layer", "volunteers-layer"].forEach(l => map.setLayoutProperty(l, "visibility", "visible"));
  document.getElementById("fab-fires")?.classList.add("active");
  document.getElementById("fab-shelters")?.classList.add("active");
  document.getElementById("fab-volunteers")?.classList.add("active");

  // Reset draw buttons
  document.querySelector('.panel-tab[data-tab="corridor"]')?.classList.remove("drawing");
  document.getElementById("corridor-draw-btn").textContent = "Line";
  document.getElementById("radius-drop-btn").textContent = "Radius";
  document.getElementById("polygon-draw-btn").textContent = "Polygon";
  document.getElementById("corridor-results").innerHTML = "";
  document.getElementById("corridor-clear-btn").style.display = "none";

  // Reset query
  document.getElementById("query-input").value = "";
  document.getElementById("query-status").textContent = "";
  document.getElementById("query-results-list").innerHTML = "";
  const qrh = document.getElementById("query-results-header");
  if (qrh) { qrh.style.display = "none"; }
  document.getElementById("results-list").innerHTML = '<div id="no-results">Run a query or draw a corridor</div>';

  // Reset filters
  map.setFilter("svi-fill", null);
  map.setFilter("nri-fill", null);
  document.getElementById("svi-filter").value = 0;
  document.getElementById("nri-filter").value = 0;
  document.getElementById("svi-filter-val").textContent = "0.00";
  document.getElementById("nri-filter-val").textContent = "0";
  document.getElementById("filter-action-wrap").style.display = "none";
  document.getElementById("filter-analysis-results").style.display = "none";

  // Reset KPI
  if (window._data) {
    const { fires, shelters, volunteers } = window._data;
    document.getElementById("stat-fires").textContent       = fires.length;
    document.getElementById("stat-no-response").textContent = fires.filter(f => f.rc_responded === "no").length;
    document.getElementById("stat-shelters").textContent    = shelters.length;
    document.getElementById("stat-volunteers").textContent  = volunteers.length;
  }
  const st = window._currentState;
  if (st) { map.flyTo({ center: st.center, zoom: st.zoom, duration: 800 }); }
  document.querySelector("#top-bar-sub").textContent = `${(st||{}).name || "Florida"} — 7 datasets`;
}
window.resetMap = resetMap;

// ── State change ────────────────────────────────────────────────────────────
function switchState(fips) {
  const st = US_STATES.find(s => s.fips === fips);
  if (!st) return;
  _currentState = st;
  window._currentState = st;
  _currentStateFips = st.fips;
  _currentStateAbbr = st.abbr;
  _tractFeatures = null;
  document.getElementById("state-select").value = fips;
  document.querySelector("#top-bar-sub").textContent = `Loading ${st.name}...`;
  map.flyTo({ center: st.center, zoom: st.zoom, duration: 1200 });

  // Clear lookup maps
  window._sviFullMap = new Map();
  window._nriMap = new Map();
  map.getSource("corridor").setData(EMPTY_FC);
  map.getSource("highlight").setData(EMPTY_FC);

  Promise.all([fetchAndBuildSVI(), fetchAndBuildNRI(), loadPointData(st.abbr)]);
}
window.switchState = switchState;

// ── Dark mode ───────────────────────────────────────────────────────────────
function toggleDarkMode() {
  const isDark = document.body.classList.toggle("dark");
  if (!localStorage.getItem("selectedBasemap")) {
    map.setStyle(isDark ? BASEMAPS[1].url : BASEMAPS[0].url);
    // Re-add sources and layers after style change
    map.once("style.load", () => { reinitMapLayers(); });
  }
  document.getElementById("dark-toggle").innerHTML = isDark ? "☀ Light" : "☾ Dark";
  localStorage.setItem("darkMode", isDark ? "1" : "0");
}
window.toggleDarkMode = toggleDarkMode;

if (localStorage.getItem("darkMode") === "1") {
  document.body.classList.add("dark");
  document.getElementById("dark-toggle").innerHTML = "☀ Light";
  if (!savedBm) {
    map.setStyle(BASEMAPS[1].url);
    map.once("style.load", () => { reinitMapLayers(); });
  }
}

function reinitMapLayers() {
  // Re-add all custom sources and layers after basemap change
  if (!map.getSource("parcels-source")) {
    map.addSource("parcels-source", { type: "vector", tiles: ["https://tiles.jbf.com/florida-parcels/{z}/{x}/{y}.mvt?v=2026-04-19"], minzoom: 11, maxzoom: 16 });
    map.addLayer({ id: "parcels-fill", type: "fill", source: "parcels-source", "source-layer": "parcels", minzoom: 12, layout: { visibility: _parcelVisible ? "visible" : "none" }, paint: { "fill-color": ["match", ["get", "v"], 0, "rgba(77,187,219,0.85)", 1, "rgba(143,212,164,0.85)", 2, "rgba(200,230,160,0.85)", 3, "rgba(245,213,110,0.85)", 4, "rgba(240,146,74,0.85)", 5, "rgba(224,59,46,0.85)", "rgba(200,200,200,0.85)"], "fill-opacity": 0.85 } });
    map.addLayer({ id: "parcels-outline", type: "line", source: "parcels-source", "source-layer": "parcels", minzoom: 12, layout: { visibility: _parcelVisible ? "visible" : "none" }, paint: { "line-color": "rgba(30,30,30,0.6)", "line-width": 0.5 } });
  }
  if (!map.getSource("svi-tracts")) {
    map.addSource("svi-tracts", { type: "geojson", data: EMPTY_FC });
    map.addLayer({ id: "svi-fill", type: "fill", source: "svi-tracts", layout: { visibility: "none" }, paint: { "fill-color": ["case", [">=", ["to-number", ["get", "rpl"], -1], 0.75], "rgba(192,57,43,0.65)", [">=", ["to-number", ["get", "rpl"], -1], 0.50], "rgba(231,76,60,0.65)", [">=", ["to-number", ["get", "rpl"], -1], 0.25], "rgba(243,156,18,0.65)", [">=", ["to-number", ["get", "rpl"], -1], 0], "rgba(249,231,159,0.65)", "rgba(204,204,204,0.55)"], "fill-outline-color": "rgba(80,80,80,0.25)" } });
  }
  if (!map.getSource("nri-tracts")) {
    map.addSource("nri-tracts", { type: "geojson", data: EMPTY_FC });
    map.addLayer({ id: "nri-fill", type: "fill", source: "nri-tracts", layout: { visibility: "none" }, paint: { "fill-color": ["case", [">=", ["to-number", ["get", "score"], -1], 80], "rgba(123,45,139,0.65)", [">=", ["to-number", ["get", "score"], -1], 60], "rgba(192,57,43,0.65)", [">=", ["to-number", ["get", "score"], -1], 40], "rgba(230,126,34,0.65)", [">=", ["to-number", ["get", "score"], -1], 20], "rgba(241,196,15,0.65)", "rgba(236,240,241,0.65)"], "fill-outline-color": "rgba(80,80,80,0.25)" } });
  }
  if (!map.getSource("fires")) {
    map.addSource("fires", { type: "geojson", data: EMPTY_FC });
    map.addLayer({ id: "fires-no-rc", type: "circle", source: "fires", filter: ["==", ["get", "rc_responded"], "no"], paint: { "circle-radius": 5, "circle-color": "#ED1B2E", "circle-stroke-color": "#b40014", "circle-stroke-width": 1 } });
    map.addLayer({ id: "fires-rc", type: "circle", source: "fires", filter: ["==", ["get", "rc_responded"], "yes"], paint: { "circle-radius": 5, "circle-color": "#2EA03C", "circle-stroke-color": "#14641e", "circle-stroke-width": 1 } });
  }
  if (!map.getSource("shelters")) {
    map.addSource("shelters", { type: "geojson", data: EMPTY_FC });
    map.addLayer({ id: "shelters-layer", type: "circle", source: "shelters", paint: { "circle-radius": 6, "circle-color": "#1565C0", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
  }
  if (!map.getSource("volunteers")) {
    map.addSource("volunteers", { type: "geojson", data: EMPTY_FC });
    map.addLayer({ id: "volunteers-layer", type: "circle", source: "volunteers", paint: { "circle-radius": 6, "circle-color": "#FF8C00", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
  }
  if (!map.getSource("corridor")) {
    map.addSource("corridor", { type: "geojson", data: EMPTY_FC });
    map.addLayer({ id: "corridor-fill", type: "fill", source: "corridor", paint: { "fill-color": "rgba(30,60,120,0.15)" } });
    map.addLayer({ id: "corridor-outline", type: "line", source: "corridor", paint: { "line-color": "#ED1B2E", "line-width": 2 } });
  }
  if (!map.getSource("highlight")) {
    map.addSource("highlight", { type: "geojson", data: EMPTY_FC });
    map.addLayer({ id: "highlight-point", type: "circle", source: "highlight", paint: { "circle-radius": 8, "circle-color": "#ED1B2E", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
  }
  if (!map.getSource("parcel-mask")) {
    map.addSource("parcel-mask", { type: "geojson", data: EMPTY_FC });
    map.addLayer({ id: "parcel-mask-fill", type: "fill", source: "parcel-mask", layout: { visibility: "none" }, paint: { "fill-color": "#f5f3f0", "fill-opacity": 0.82 } });
  }
  if (!map.getSource("analysis-tracts")) {
    map.addSource("analysis-tracts", { type: "geojson", data: EMPTY_FC });
    map.addLayer({ id: "analysis-tracts-fill", type: "fill", source: "analysis-tracts", layout: { visibility: "none" }, paint: { "fill-color": "#e67e22", "fill-opacity": 0.25 } });
    map.addLayer({ id: "analysis-tracts-outline", type: "line", source: "analysis-tracts", layout: { visibility: "none" }, paint: { "line-color": "#e67e22", "line-width": 2, "line-dasharray": [3, 2] } });
  }

  // Re-load data into sources
  fetchAndBuildSVI();
  fetchAndBuildNRI();
  loadPointData(_currentStateAbbr);
}

// ── Basemap picker ──────────────────────────────────────────────────────────
function toggleBasemapPicker() {
  const picker = document.getElementById("bm-picker");
  if (picker.style.display === "none") {
    picker.innerHTML = "";
    BASEMAPS.forEach((bm, i) => {
      const btn = document.createElement("button");
      btn.textContent = bm.name;
      const isActive = i === _bmIdx;
      btn.style.cssText = "display:block;width:100%;background:" + (isActive ? "rgba(165,28,48,0.25)" : "none") + ";border:none;border-bottom:1px solid rgba(255,255,255,0.08);color:" + (isActive ? "#fff" : "rgba(255,255,255,0.65)") + ";font-family:Arial,sans-serif;font-size:12px;font-weight:" + (isActive ? "700" : "400") + ";padding:10px 16px;cursor:pointer;text-align:left";
      btn.onclick = () => {
        _bmIdx = i;
        map.setStyle(bm.style || bm.url);
        localStorage.setItem("selectedBasemap", bm.url);
        map.once("style.load", () => { reinitMapLayers(); });
        toggleBasemapPicker();
      };
      picker.appendChild(btn);
    });
    picker.style.display = "block";
  } else {
    picker.style.display = "none";
  }
}
window.toggleBasemapPicker = toggleBasemapPicker;

document.addEventListener("click", (e) => {
  const picker = document.getElementById("bm-picker");
  const btn = document.getElementById("bm-btn");
  if (picker && picker.style.display !== "none" && !picker.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
    picker.style.display = "none";
  }
});

// ── Filter analyze button ───────────────────────────────────────────────────
document.getElementById("filter-analyze-btn").addEventListener("click", async () => {
  const btn = document.getElementById("filter-analyze-btn");
  const resultsDiv = document.getElementById("filter-analysis-results");
  btn.disabled = true;
  btn.textContent = "Analyzing...";
  resultsDiv.style.display = "block";
  resultsDiv.innerHTML = `<em style="color:var(--text-muted)">Loading...</em>`;

  try {
    const bounds = map.getBounds();
    const viewGEOIDs = new Set();

    // Get visible tracts from SVI/NRI data
    const sviVis = map.getLayoutProperty("svi-fill", "visibility") === "visible";
    const nriVis = map.getLayoutProperty("nri-fill", "visibility") === "visible";
    const sviMin = parseInt(document.getElementById("svi-filter").value) / 100;
    const nriMin = parseInt(document.getElementById("nri-filter").value);

    if (sviVis && window._sviFullMap) {
      window._sviFullMap.forEach((row, geoid) => {
        if (sviMin > 0 && (row.rpl_themes === null || row.rpl_themes < sviMin)) return;
        viewGEOIDs.add(geoid);
      });
    }
    if (nriVis && window._nriMap) {
      window._nriMap.forEach((row, geoid) => {
        if (nriMin > 0 && (row.risk_score === null || row.risk_score < nriMin)) return;
        viewGEOIDs.add(geoid);
      });
    }

    if (!viewGEOIDs.size) {
      resultsDiv.innerHTML = `<em style="color:var(--text-muted)">No filtered tracts</em>`;
      btn.disabled = false; btn.textContent = "Analyze Filtered Tracts (in view)";
      return;
    }

    const tractGeoids = [...viewGEOIDs];
    // SVI + NRI: pull from already-loaded in-memory maps (avoids URL-length 400s)
    const sviRows = window._sviFullMap
      ? tractGeoids.map(g => window._sviFullMap.get(g)).filter(Boolean)
      : [];
    const nriRows = window._nriMap
      ? tractGeoids.map(g => window._nriMap.get(g)).filter(Boolean)
      : [];
    const countyFips = [...new Set(tractGeoids.map(g => g.slice(0, 5)))];
    const countyFilter = `in.(${countyFips.join(",")})`;

    const [aliceRows, femaRows] = await Promise.all([
      sbFetch("alice", `select=fips_5,county_name,median_income,pct_poverty,pct_alice,pct_struggling&fips_5=${countyFilter}`),
      sbFetch("fema_declarations", `select=fips_5,total_declarations,most_recent_title,hurricane_count,flood_count,top_hazard,declarations_per_year&fips_5=${countyFilter}`),
    ]);

    const fmt = n => Number(n).toLocaleString();
    const validSVI = sviRows.filter(r => r.rpl_themes >= 0);
    const totalPop = validSVI.reduce((s, r) => s + (r.e_totpop || 0), 0);
    const avgRpl = avg(validSVI, "rpl_themes");

    resultsDiv.innerHTML = `
      <div class="corr-header">Filtered Analysis</div><hr class="corr-divider">
      <div class="corr-row"><span>Tracts:</span><span><strong>${tractGeoids.length}</strong></span></div>
      ${totalPop > 0 ? `<div class="corr-row"><span>Population:</span><span><strong>${fmt(totalPop)}</strong></span></div>` : ""}
      ${avgRpl != null ? `<div class="corr-row"><span>Avg SVI:</span><span><strong>${Math.round(avgRpl * 100)}%</strong></span></div>` : ""}
    `;
  } catch (err) {
    resultsDiv.innerHTML = `<em style="color:#c00">Error: ${err.message}</em>`;
  }
  btn.disabled = false; btn.textContent = "Analyze Filtered Tracts (in view)";
});

// ── Help overlay ────────────────────────────────────────────────────────────
function showHelp() {
  alert("Spatial RAG — Disaster Response\n\nMapLibre GL JS Edition\nBuilt by Jeff Franzen · American Red Cross\n\nUse Layers tab to toggle SVI/NRI choropleth overlays.\nUse Query tab for natural language queries.\nUse Analyze tab to draw spatial selections.");
}
window.showHelp = showHelp;

// ── Right panel resize (drag left edge to widen for long smart-query answers) ──
(function initPanelResize() {
  const panel = document.getElementById("right-panel");
  const handle = document.getElementById("panel-resize-handle");
  if (!panel || !handle) return;

  const MIN_WIDTH = 300;
  const MAX_WIDTH = Math.min(window.innerWidth - 200, 1200);
  const STORAGE_KEY = "ops-panel-width";

  // Restore saved width
  const saved = parseInt(localStorage.getItem(STORAGE_KEY) || "", 10);
  if (saved && saved >= MIN_WIDTH) {
    panel.style.setProperty("--panel-width", `${Math.min(saved, MAX_WIDTH)}px`);
  }

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener("mousedown", (e) => {
    if (!panel.classList.contains("open")) return;
    dragging = true;
    startX = e.clientX;
    startWidth = panel.offsetWidth;
    panel.classList.add("resizing");
    handle.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    // Dragging LEFT (negative deltaX) should widen the panel
    const deltaX = startX - e.clientX;
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + deltaX));
    panel.style.setProperty("--panel-width", `${newWidth}px`);
    // Force reflow to apply CSS variable during drag
    panel.offsetWidth;
    // Trigger map resize so MapLibre doesn't get squished
    if (window.map && typeof window.map.resize === "function") window.map.resize();
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove("resizing");
    handle.classList.remove("active");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    // Persist the final width
    const finalWidth = panel.offsetWidth;
    if (finalWidth >= MIN_WIDTH) {
      localStorage.setItem(STORAGE_KEY, String(finalWidth));
    }
    if (window.map && typeof window.map.resize === "function") window.map.resize();
  });

  // Double-click the handle to reset to default
  handle.addEventListener("dblclick", () => {
    panel.style.removeProperty("--panel-width");
    localStorage.removeItem(STORAGE_KEY);
    if (window.map && typeof window.map.resize === "function") window.map.resize();
  });
})();
