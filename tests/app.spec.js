const { test, expect } = require('@playwright/test');

test.describe('Spatial RAG MapLibre', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Spatial RAG/);
  });

  test('map container exists', async ({ page }) => {
    const map = page.locator('#map');
    await expect(map).toBeVisible();
  });

  test('top bar with stats is visible', async ({ page }) => {
    const topBar = page.locator('#top-bar');
    await expect(topBar).toBeVisible();
  });

  test('right panel exists', async ({ page }) => {
    const panel = page.locator('#right-panel');
    await expect(panel).toBeAttached();
  });

  test('FAB overlay buttons exist', async ({ page }) => {
    const fab = page.locator('#fab');
    await expect(fab).toBeAttached();
  });

  test('MapLibre GL JS loads and map initializes', async ({ page }) => {
    const hasMaplibre = await page.evaluate(() => typeof maplibregl !== 'undefined');
    expect(hasMaplibre).toBe(true);

    // Wait for the map canvas to appear (MapLibre creates a canvas element)
    const canvas = page.locator('#map canvas.maplibregl-canvas');
    await expect(canvas).toBeAttached({ timeout: 15000 });
  });

  test('loading overlay disappears after data loads', async ({ page }) => {
    // The #map-loading overlay should get hidden class after data loads
    const loading = page.locator('#map-loading');
    await expect(loading).toHaveClass(/hidden/, { timeout: 30000 });
  });

  test('no uncaught JS errors on load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    // Wait for map to initialize
    await page.locator('#map canvas.maplibregl-canvas').waitFor({ timeout: 15000 });
    // Give data loading time
    await page.waitForTimeout(5000);

    // Filter out known non-critical errors (CORS on external tiles, etc)
    const critical = errors.filter(e =>
      !e.includes('Failed to fetch') &&
      !e.includes('NetworkError') &&
      !e.includes('CORS')
    );
    expect(critical).toEqual([]);
  });

  test('point data loads and stats update', async ({ page }) => {
    // Wait for loading to finish
    await expect(page.locator('#map-loading')).toHaveClass(/hidden/, { timeout: 30000 });

    // At least one stat should be non-zero after loading
    const firesText = await page.locator('#stat-fires').textContent();
    const sheltersText = await page.locator('#stat-shelters').textContent();
    const volunteersText = await page.locator('#stat-volunteers').textContent();

    const total = parseInt(firesText) + parseInt(sheltersText) + parseInt(volunteersText);
    expect(total).toBeGreaterThan(0);
  });
});
