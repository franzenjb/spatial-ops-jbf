// Visual sanity check: do parcel polygons render after tile rebuild?
const { test, expect } = require('@playwright/test');

test('parcel polygons render at Shore Acres', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    window.map.setLayoutProperty('parcels-fill', 'visibility', 'visible');
    window.map.setLayoutProperty('parcels-outline', 'visibility', 'visible');
    window.map.jumpTo({ center: [-82.6368, 27.7875], zoom: 15 });
  });
  await page.waitForTimeout(6000);

  const parcelFeatures = await page.evaluate(() => {
    const feats = window.map.queryRenderedFeatures({ layers: ['parcels-fill'] });
    return {
      count: feats.length,
      firstGeomType: feats[0]?.geometry?.type ?? null,
      firstProps: feats[0]?.properties ?? null,
    };
  });

  console.log('Parcel features on screen:', parcelFeatures);
  expect(parcelFeatures.count).toBeGreaterThan(100);
  expect(parcelFeatures.firstGeomType).toMatch(/Polygon/);

  await page.screenshot({ path: '/tmp/shore-acres-parcels.png', fullPage: false });
});
