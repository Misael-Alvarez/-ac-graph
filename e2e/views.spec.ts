import { test, expect, type Page } from '@playwright/test';
import { resetWorkspace } from './helpers';

/** Opens the microservices template, which has several groups and edges. */
async function openTemplate(page: Page) {
  await resetWorkspace(page);
  await page
    .locator('.library-templates .template-card')
    .filter({ hasText: 'Microservicios' })
    .click();
  await page.waitForSelector('.canvas-surface');
  await expect(page.locator('[data-shape-id^="grp_"]').first()).toBeVisible();
}

/** Creates a view and leaves it selected. */
async function addView(page: Page, name: string) {
  await page.locator('.view-bar .chip', { hasText: 'Nueva vista' }).click();
  await page.locator('.view-bar-input').fill(name);
  await page.keyboard.press('Enter');
  await expect(page.locator('.view-bar .chip.is-active')).toHaveText(new RegExp(name));
}

/** Drags a shape by an offset and returns where it started. */
async function dragBy(page: Page, selector: string, dx: number, dy: number) {
  const box = (await page.locator(selector).first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + 14 + dy, { steps: 10 });
  await page.mouse.up();
  return box;
}

test.beforeEach(async ({ page }) => {
  await openTemplate(page);
});

test('a diagram starts with nothing to switch between', async ({ page }) => {
  // One reading is not a choice, so the bar offers to make a second rather than
  // showing a tab strip of one.
  await expect(page.locator('.view-bar')).toHaveText(/Nueva vista/);
  await expect(page.locator('.view-bar .chip')).toHaveCount(1);
});

test('a second view arrives beside the whole architecture', async ({ page }) => {
  await addView(page, 'Seguridad');
  await expect(page.locator('.view-bar [role="tab"]')).toHaveCount(2);
  await expect(page.locator('.view-bar [role="tab"]').first()).toHaveText('Arquitectura completa');
});

// The point of the whole model/view split: one service, two arrangements.
test('moving a node in a view leaves the main view alone', async ({ page }) => {
  await addView(page, 'Seguridad');
  const before = await dragBy(page, '[data-shape-id^="grp_"]', 240, 260);

  const moved = (await page.locator('[data-shape-id^="grp_"]').first().boundingBox())!;
  expect(Math.round(moved.x)).not.toBe(Math.round(before.x));

  await page.locator('.view-bar [role="tab"]').first().click();
  const back = (await page.locator('[data-shape-id^="grp_"]').first().boundingBox())!;
  expect(Math.round(back.x)).toBe(Math.round(before.x));
  expect(Math.round(back.y)).toBe(Math.round(before.y));
});

test('and moving it in the main view moves it everywhere', async ({ page }) => {
  await addView(page, 'Seguridad');
  await page.locator('.view-bar [role="tab"]').first().click();
  const before = await dragBy(page, '[data-shape-id^="grp_"]', 200, 0);
  const moved = (await page.locator('[data-shape-id^="grp_"]').first().boundingBox())!;
  expect(moved.x).toBeGreaterThan(before.x + 150);

  // Where it landed exactly is the grid's business; that the other view agrees
  // is the model's, and that is what this is about.
  await page.locator('.view-bar [role="tab"]').nth(1).click();
  const inView = (await page.locator('[data-shape-id^="grp_"]').first().boundingBox())!;
  expect(Math.round(inView.x)).toBe(Math.round(moved.x));
});

test('a view survives a recompile from the code panel', async ({ page }) => {
  await addView(page, 'Seguridad');
  const before = await dragBy(page, '[data-shape-id^="grp_"]', 200, 200);
  const displaced = (await page.locator('[data-shape-id^="grp_"]').first().boundingBox())!;

  await page.keyboard.press('ControlOrMeta+/');
  await page.waitForSelector('.cm-content');
  await page.locator('.cm-content').click();
  // Editing rebuilds every shape with a fresh id — exactly what would strand a
  // view that referenced ids rather than the document's own node keys. A
  // trailing blank line is the smallest edit that still forces the compile.
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  await page.keyboard.press('ControlOrMeta+/');

  await expect(page.locator('.view-bar [role="tab"]')).toHaveCount(2);
  await expect(page.locator('.view-bar .chip.is-active')).toHaveText(/Seguridad/);

  // And it still holds the arrangement it was given, re-anchored to the shapes
  // the recompile produced.
  const after = (await page.locator('[data-shape-id^="grp_"]').first().boundingBox())!;
  expect(Math.round(after.x)).not.toBe(Math.round(before.x));
  expect(Math.abs(after.x - displaced.x)).toBeLessThan(4);
});

test('deleting a view keeps the services it was showing', async ({ page }) => {
  const shapes = await page.locator('[data-shape-id]').count();
  await addView(page, 'Temporal');

  page.on('dialog', (d) => d.accept());
  await page.locator('.view-bar .chip.is-active .chip-close').click();

  await expect(page.locator('.view-bar [role="tab"]')).toHaveCount(0);
  await expect(page.locator('[data-shape-id]')).toHaveCount(shapes);
});

test('drilling into a group narrows the canvas and the trail leads back', async ({ page }) => {
  const group = page.locator('[data-shape-id^="grp_"]').first();
  const box = (await group.boundingBox())!;

  // A group of one service has no level below it, so give this one more.
  for (let i = 0; i < 2; i++) {
    await page.mouse.click(box.x + 20, box.y + 12, { button: 'right' });
    await page.getByText('Añadir servicio a este grupo').click();
    await page.keyboard.press('Escape');
  }
  const all = await page.locator('[data-shape-id]').count();

  await page.mouse.dblclick(box.x + 20, box.y + 12);
  await expect(page.locator('.breadcrumb')).toBeVisible();
  await expect(page.locator('[data-shape-id]')).toHaveCount(5);

  await page.keyboard.press('Escape');
  await expect(page.locator('.breadcrumb')).toHaveCount(0);
  await expect(page.locator('[data-shape-id]')).toHaveCount(all);
});

test('double-clicking a single-service group still renames it', async ({ page }) => {
  // Drilling would show the one card that is already on screen, so the older
  // meaning of the gesture is the one that survives there.
  const box = (await page.locator('[data-shape-id^="grp_"]').first().boundingBox())!;
  await page.mouse.dblclick(box.x + 20, box.y + 12);

  await expect(page.locator('.breadcrumb')).toHaveCount(0);
  await expect(page.locator('.inspector .input').first()).toBeFocused();
});
