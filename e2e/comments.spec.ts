import { expect, test, type Page } from '@playwright/test';
import { addGroupAt, openNewDiagram, pagePoint } from './helpers';

const panel = (page: Page) => page.locator('.side-panel[aria-label="Comentarios"]');
const pins = (page: Page) => page.locator('.canvas-surface .comment-pin:not(.is-draft)');

test.beforeEach(async ({ page }) => {
  await openNewDiagram(page);
  await page.mouse.move(5, 5);
});

test('a comment on a shape: from the menu to the panel to a pin that follows the shape', async ({
  page,
}) => {
  await addGroupAt(page, 400, 300);
  const group = page.locator('.canvas-surface rect[data-shape-id^="grp_"]').first();
  const box = (await group.boundingBox())!;
  await page.mouse.click(box.x + 30, box.y + 12, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Comentar…' }).click();

  // The panel opens on the shape, with the field ready and a ghost pin where it will land.
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('.comment-target-label')).toHaveText('En New Group');
  await expect(panel(page).locator('.comment-field')).toBeFocused();
  await expect(page.locator('.canvas-surface .comment-pin.is-draft')).toHaveCount(1);

  await panel(page).locator('.comment-field').fill('¿Va en la subred privada?');
  await page.keyboard.press('Enter');
  const thread = panel(page).locator('.comment-thread');
  await expect(thread).toHaveCount(1);
  await expect(thread).toContainText('¿Va en la subred privada?');
  await expect(thread.locator('.comment-meta b')).toHaveText('Tú');
  await expect(thread.locator('.comment-anchor')).toHaveText('En New Group');
  await expect(panel(page).locator('.panel-head')).toContainText('1');
  await expect(page.locator('.canvas-surface .comment-pin.is-draft')).toHaveCount(0);

  // One pin, on the shape's top-right corner; it moves with the shape.
  await expect(pins(page)).toHaveCount(1);
  await expect(pins(page).first().locator('.comment-pin-count')).toHaveText('1');
  const before = (await pins(page).first().boundingBox())!;
  await page.keyboard.press('Escape');
  await page.mouse.move(box.x + 30, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 230, box.y + 12, { steps: 8 });
  await page.mouse.up();
  const after = (await pins(page).first().boundingBox())!;
  expect(after.x - before.x).toBeGreaterThan(150);

  // A second thread on the same shape shares the pin and counts on it. (The
  // selection goes first: the inspector it opens floats over the moved group.)
  await page.locator('.canvas-surface').click({ position: { x: 200, y: 600 } });
  await page.mouse.click(box.x + 230, box.y + 12, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Comentar…' }).click();
  await panel(page).locator('.comment-field').fill('Y el nombre no dice qué es.');
  await page.getByRole('button', { name: 'Comentar', exact: true }).click();
  await expect(panel(page).locator('.comment-thread')).toHaveCount(2);
  await expect(pins(page)).toHaveCount(1);
  await expect(pins(page).first().locator('.comment-pin-count')).toHaveText('2');

  // Comments are not part of the drawing: undo touches the shape, never them.
  await page.locator('.canvas-surface').click({ position: { x: 200, y: 600 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(panel(page).locator('.comment-thread')).toHaveCount(2);
});

test('a comment on the sheet: reply, resolve, reopen, delete, and it survives a reload', async ({
  page,
}) => {
  const point = await pagePoint(page, 600, 500);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Comentar aquí…' }).click();
  await expect(panel(page).locator('.comment-target-label')).toHaveText('En la hoja');
  await panel(page).locator('.comment-field').fill('Falta la cola de auditoría.');
  await page.keyboard.press('Enter');
  const thread = panel(page).locator('.comment-thread');
  await expect(thread).toHaveCount(1);
  await expect(pins(page)).toHaveCount(1);
  // The pin sits where the menu was opened.
  const pin = (await pins(page).first().boundingBox())!;
  expect(Math.abs(pin.x + pin.width * 0.2 - point.x)).toBeLessThan(12);

  await thread.getByRole('textbox', { name: 'Responder' }).fill('Va en el sprint que viene.');
  await thread.getByRole('textbox', { name: 'Responder' }).press('Enter');
  await expect(thread.locator('.comment-row')).toHaveCount(2);

  // Resolving takes the pin off the sheet and folds the thread away; reopening brings it back.
  await thread.getByRole('button', { name: 'Resolver' }).click();
  await expect(pins(page)).toHaveCount(0);
  await expect(panel(page).locator('.comment-group')).toHaveCount(1);
  await expect(panel(page).locator('.comment-group .group-header')).toContainText('Resueltos');
  await expect(panel(page).locator('.comment-thread.is-resolved')).toHaveCount(1);
  await expect(panel(page).locator('.comment-settled')).toHaveText('Resuelto por Tú');
  await panel(page).getByRole('button', { name: 'Reabrir' }).click();
  await expect(pins(page)).toHaveCount(1);

  // Kept beside the diagram: a reload finds it again.
  await page.reload();
  await page.waitForSelector('.canvas-surface');
  await expect(pins(page)).toHaveCount(1);
  await pins(page).first().click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('.comment-thread.is-focused')).toContainText(
    'Falta la cola de auditoría.',
  );

  // Gone for good, pin and all.
  await panel(page).getByRole('button', { name: 'Eliminar hilo' }).click();
  await expect(panel(page).locator('.comment-thread')).toHaveCount(0);
  await expect(pins(page)).toHaveCount(0);
  await expect(panel(page)).toContainText('Nadie ha dicho nada todavía');
});

test('the panel shares the column, opens from the keyboard and the palette, and writes on the selection', async ({
  page,
}) => {
  await page.keyboard.press('ControlOrMeta+h');
  await expect(page.locator('.side-panel[aria-label="Historial"]')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+c');
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('.side-panel[aria-label="Historial"]')).toHaveCount(0);
  // Nowhere to write yet: the field waits, and says why.
  await expect(panel(page).locator('.comment-field')).toBeDisabled();
  await expect(panel(page).locator('.comment-target-label')).toContainText('Selecciona una forma');

  // The one selected shape is where the comment goes.
  await addGroupAt(page, 400, 300);
  await page
    .locator('.canvas-surface rect[data-shape-id^="grp_"]')
    .first()
    .click({ position: { x: 30, y: 12 } });
  await expect(panel(page).locator('.comment-target-label')).toHaveText('En New Group');
  await panel(page).locator('.comment-field').fill('Desde la selección.');
  await page.keyboard.press('Enter');
  await expect(panel(page).locator('.comment-thread')).toHaveCount(1);
  await expect(pins(page)).toHaveCount(1);

  await page.keyboard.press('ControlOrMeta+Shift+c');
  await expect(panel(page)).toHaveCount(0);
  await page.locator('.canvas-surface').click({ position: { x: 200, y: 600 } });
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.palette-input').fill('Comentarios');
  await page.getByRole('option', { name: 'Comentarios' }).click();
  await expect(panel(page)).toBeVisible();

  // Presenting hides the pins with the rest of the chrome; leaving brings them back.
  await page.keyboard.press('Escape');
  await page.keyboard.press('F5');
  await expect(page.locator('.editor-root.is-presenting')).toHaveCount(1);
  await expect(pins(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(pins(page)).toHaveCount(1);
});
