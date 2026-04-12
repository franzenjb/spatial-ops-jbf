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

  test('MapLibre GL JS loads', async ({ page }) => {
    const hasMaplibre = await page.evaluate(() => typeof maplibregl !== 'undefined');
    expect(hasMaplibre).toBe(true);
  });
});
