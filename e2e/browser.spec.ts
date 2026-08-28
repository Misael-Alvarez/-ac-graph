import { expect, test } from '@playwright/test';
import { openNewDiagram } from './helpers';

test.beforeEach(async ({ page }) => {
  await openNewDiagram(page);
  await page.mouse.move(5, 5);
});

test('a fresh diagram does not claim to have unsaved changes', async ({ page }) => {
  await expect(page.locator('.topbar .save-status')).toContainText('Guardado');
});

test('opens from the dock and from the keyboard', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+b');
  await expect(page.locator('.side-panel.is-left')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+b');
  await expect(page.locator('.side-panel.is-left')).toHaveCount(0);

  await page.locator('[data-tool="browser"]').click();
  await expect(page.locator('.side-panel.is-left')).toBeVisible();
});

test('offers every cloud as a tab, with counts', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+b');
  const tabs = page.locator('.browser-cloud');
  await expect(tabs).toHaveCount(7);
  await expect(tabs.first()).toContainText('AWS');
  // Every tab shows how many services it holds.
  for (const text of await tabs.allInnerTexts()) {
    expect(text).toMatch(/\d+/);
  }
});

test('groups a cloud into functional sections rather than one long list', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+b');
  const sections = page.locator('.browser-section-header');
  await expect(await sections.count()).toBeGreaterThan(5);
  await expect(sections.first()).toContainText('Cómputo');
});

test('switching cloud changes the services shown', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+b');
  await expect(page.locator('.browser-tile').first()).toBeVisible();
  await expect(page.locator('.browser-list')).toContainText('EC2');

  await page.getByRole('tab', { name: /^OCI/ }).click();
  await expect(page.locator('.browser-list')).not.toContainText('EC2');
  await expect(page.locator('.browser-list')).toContainText('OCI Compute');
});

test('collapses a section', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+b');
  const first = page.locator('.browser-section').first();
  const before = await first.locator('.browser-tile').count();
  expect(before).toBeGreaterThan(0);

  await first.locator('.browser-section-header').click();
  await expect(first.locator('.browser-tile')).toHaveCount(0);
});

test('search reaches across every cloud', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+b');
  await page.locator('.browser-search-input').fill('kubernetes');

  const labels = await page.locator('.browser-tile-label').allInnerTexts();
  expect(labels.length).toBeGreaterThan(2);
  // Results come from more than one provider, so the cloud is shown per row.
  const clouds = new Set(await page.locator('.browser-tile-cloud').allInnerTexts());
  expect(clouds.size).toBeGreaterThan(1);
});

test('clicking a service places it on the canvas', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+b');
  await page.locator('.browser-search-input').fill('lambda');
  await page.locator('.browser-tile').first().click();

  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(1);
  await expect(page.locator('.canvas-surface')).toContainText('Lambda');
});

test('reports when nothing matches', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+b');
  await page.locator('.browser-search-input').fill('nada de esto existe');
  await expect(page.getByText('Nada coincide')).toBeVisible();
});

test('services from the newly added clouds are usable', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+b');
  await page.locator('.browser-search-input').fill('watsonx.ai');
  await page.locator('.browser-tile').first().click();

  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(1);
  await expect(page.locator('.canvas-surface')).toContainText('watsonx.ai');
});
