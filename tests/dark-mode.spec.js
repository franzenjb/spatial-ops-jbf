// Dark-mode sanity: toggle dark mode, verify body class applies and panel
// chrome renders without broken backgrounds.
const { test, expect } = require('@playwright/test');

test('dark mode toggles cleanly and panel is readable', async ({ page }) => {
  test.setTimeout(45000);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Start in light mode by default
  const startsDark = await page.evaluate(() => document.body.classList.contains('dark'));
  if (startsDark) {
    await page.evaluate(() => window.toggleDarkMode());
    await page.waitForTimeout(300);
  }

  // Toggle into dark mode
  await page.evaluate(() => window.toggleDarkMode());
  await page.waitForTimeout(500);

  const isDark = await page.evaluate(() => document.body.classList.contains('dark'));
  expect(isDark).toBe(true);

  // Check that the right-panel computed background is not pure white (dark bg applied)
  const rightPanelBg = await page.evaluate(() => {
    const el = document.getElementById('right-panel');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  expect(rightPanelBg).not.toBe('rgb(255, 255, 255)');

  // Inject a mock corridor result and screenshot to verify cc-card / tp-caption render in dark mode
  await page.evaluate(() => {
    const mockHtml = `
      <div class="tp-hero">
        <div class="tp-hero-label">Combined Risk Score</div>
        <div class="tp-hero-score" style="color:#a16207">27</div>
        <div class="tp-hero-cat" style="color:#a16207">Moderate Combined Risk</div>
        <div class="tp-hero-tract">Radius view · 12 tracts · 1 county</div>
      </div>
      <div class="tp-caption">All data reflects tracts, parcels, and records within or touching the analysis area</div>
      <div class="tp-section">Social Vulnerability (SVI)</div>
      <div class="tp-caption" style="text-align:left;margin:-2px 0 6px">Percentile rank vs. all US tracts · 12 tracts · 94,218 residents in scope</div>
      <div class="tp-bar-row"><div class="tp-bar-head"><span>Overall vulnerability</span><span>60%</span></div>
        <div class="tp-bar-track"><div class="tp-bar-fill" style="width:60%;background:#e07830"></div></div></div>
      <div class="tp-section">Economic Hardship (ALICE)</div>
      <div class="cc-card">
        <div class="cc-head"><span class="cc-name">Hillsborough County</span><span class="cc-lead" style="color:#e05070">42%</span></div>
        <div class="cc-bar-track"><div class="cc-bar-fill" style="width:42%;background:#e05070"></div></div>
        <div class="cc-stats">
          <span><strong>620K</strong> struggling</span><span class="sep">·</span>
          <span>of <strong>1.5M</strong> residents</span><span class="sep">·</span>
          <span>median <strong>$58,000</strong></span>
        </div>
      </div>`;
    const el = document.getElementById('corridor-results');
    if (el) el.innerHTML = mockHtml;
    const acc = document.getElementById('acc-corridor-results');
    if (acc) {
      acc.classList.add('active');
      if (typeof window.toggleAccordion === 'function') window.toggleAccordion('acc-corridor-results', true);
    }
    if (typeof window.openPanel === 'function') window.openPanel('corridor');
  });
  await page.waitForTimeout(600);

  // Verify cc-card has a dark-ish background (not the light-mode cream)
  const cardBg = await page.evaluate(() => {
    const el = document.querySelector('.cc-card');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  // cream is rgb(250, 247, 245) — dark-mode is rgba(255,255,255,0.04) ~ mostly-dark
  expect(cardBg).not.toBe('rgb(250, 247, 245)');

  // Capture for manual review
  await page.screenshot({ path: '/tmp/ops-dark-mode.png', fullPage: false });

  // Toggle back to light — verify no error
  await page.evaluate(() => window.toggleDarkMode());
  await page.waitForTimeout(300);
  const endsLight = await page.evaluate(() => !document.body.classList.contains('dark'));
  expect(endsLight).toBe(true);
});
