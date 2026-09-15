import { expect, test, type Page } from '@playwright/test';
import { addGroupAt, openNewDiagram, pagePoint } from './helpers';

/*
 * What a held modifier does to the pointer — the lasso that adds or takes
 * away, the drag that leaves a copy — and the lock that keeps a shape where it
 * is whatever the hand or the arrow keys say. A blank sheet at 100%: canvas
 * coordinates are element coordinates, so the groups placed below sit where
 * the numbers say (snapped to the 18px grid).
 */

const groups = (page: Page) => page.locator('.canvas-surface rect[data-shape-id^="grp_"]');
const groupX = async (page: Page, n = 0) => Number(await groups(page).nth(n).getAttribute('x'));

async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifier?: 'Shift' | 'Alt',
) {
  const a = await pagePoint(page, from.x, from.y);
  const b = await pagePoint(page, to.x, to.y);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

test.beforeEach(async ({ page }) => {
  await openNewDiagram(page);
});

test('Shift+lasso adds to the selection and Alt+lasso takes from it', async ({ page }) => {
  // Two groups, one above the other: A at y 54–262, B at y 306–514. High on
  // the sheet, so the lasso around B ends inside the window: Firefox delivers
  // no pointer event — no `pointerup` — for a mouse outside the viewport.
  await addGroupAt(page, 198, 54);
  await addGroupAt(page, 198, 306);
  await page.keyboard.press('Escape');

  // A alone, by a click.
  await groups(page)
    .first()
    .click({ position: { x: 30, y: 12 } });
  await expect(page.locator('.selection-outline')).toHaveCount(1);

  // A lasso around B with Shift held keeps A and brings B and its service.
  await drag(page, { x: 150, y: 280 }, { x: 720, y: 560 }, 'Shift');
  await expect(page.locator('.inspector')).toContainText('3 formas seleccionadas');

  // The same lasso with Alt held takes B and its service back out.
  await drag(page, { x: 150, y: 280 }, { x: 720, y: 560 }, 'Alt');
  await expect(page.locator('.inspector')).not.toContainText('formas seleccionadas');
  await expect(page.locator('.selection-outline')).toHaveCount(1);
  expect(Number(await page.locator('.selection-outline').getAttribute('y'))).toBeLessThan(300);

  // Without a modifier the lasso replaces, as it always did.
  await drag(page, { x: 150, y: 280 }, { x: 720, y: 560 });
  await expect(page.locator('.inspector')).toContainText('2 formas seleccionadas');
});

test('Alt+drag leaves a copy where the pointer lets go, and the copy is what stays selected', async ({
  page,
}) => {
  await addGroupAt(page, 198, 198);
  await page.keyboard.press('Escape');
  const originalX = await groupX(page);

  await drag(page, { x: 230, y: 210 }, { x: 730, y: 510 }, 'Alt');

  // Two groups now: the original where it was, the copy 500px to the right.
  await expect(groups(page)).toHaveCount(2);
  expect(await groupX(page, 0)).toBe(originalX);
  const copyX = await groupX(page, 1);
  expect(copyX).toBeGreaterThan(originalX + 450);
  // Nothing of the gesture is left behind on the sheet.
  await expect(page.locator('.canvas-surface [data-shape-id^="ghost-"]')).toHaveCount(0);

  // The hand was holding the copy: the copy is selected, the original is not.
  const outline = page.locator('.selection-outline');
  await expect(outline).toHaveCount(1);
  expect(Number(await outline.getAttribute('x'))).toBe(copyX - 1);

  // One gesture, one undo.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(groups(page)).toHaveCount(1);
  expect(await groupX(page)).toBe(originalX);
});

test('a locked shape ignores the drag and the arrow keys until it is unlocked', async ({
  page,
}) => {
  await addGroupAt(page, 306, 198);
  await page.keyboard.press('Escape');
  const group = groups(page).first();
  const x0 = await groupX(page);

  // Lock from the context menu: the padlock appears on the card.
  const at = await pagePoint(page, 336, 210);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.getByRole('menuitem', { name: /^Bloquear posición/ }).click();
  await expect(page.locator('.lock-mark')).toHaveCount(1);
  // And the resize handle is gone: nothing about it is for the hand now.
  await expect(page.locator('.resize-handle')).toHaveCount(0);

  // A drag moves nothing.
  await drag(page, { x: 336, y: 210 }, { x: 536, y: 310 });
  expect(await groupX(page)).toBe(x0);

  // Neither do the arrow keys.
  await group.click({ position: { x: 30, y: 12 } });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  expect(await groupX(page)).toBe(x0);

  // The inspector says so too, and offers the way out.
  await expect(page.getByRole('button', { name: /Desbloquear posición/ })).toBeVisible();

  // Mod+L releases it; the arrow key moves it again.
  await page.keyboard.press('ControlOrMeta+l');
  await expect(page.locator('.lock-mark')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  expect(await groupX(page)).toBe(x0 + 1);

  // Locking survives a reload: it is part of the document, not of the session.
  await page.keyboard.press('ControlOrMeta+l');
  await expect(page.locator('.lock-mark')).toHaveCount(1);
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForSelector('.canvas-surface');
  await expect(page.locator('.lock-mark')).toHaveCount(1);
});

test('resizing snaps the moving edge to a neighbour, with a guide', async ({ page }) => {
  // A at y 144–352 above B at y 450–658; both 470 wide.
  await addGroupAt(page, 198, 144);
  await addGroupAt(page, 198, 450);
  await page.keyboard.press('Escape');

  await groups(page)
    .first()
    .click({ position: { x: 30, y: 12 } });
  const handle = page.locator('.resize-handle');
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;

  // Pull A's bottom edge down to 447: three pixels short of B's top at 450.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 95, { steps: 8 });
  // The guide is drawn while the hand is still on it.
  await expect(page.locator('.align-guide')).not.toHaveCount(0);
  await page.mouse.up();

  // The edge landed on B's top line exactly: 450 − 144.
  expect(Number(await groups(page).first().getAttribute('height'))).toBe(306);
  await expect(page.locator('.align-guide')).toHaveCount(0);
});
