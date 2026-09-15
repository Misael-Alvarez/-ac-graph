import { expect, test, type Page } from '@playwright/test';
import { openNewDiagram, pagePoint } from './helpers';

/** Canvas-space position of the first group, read from its tagged rect. */
async function groupRect(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-shape-id^="grp_"]') as SVGRectElement | null;
    if (!el) return null;
    return { x: Number(el.getAttribute('x')), y: Number(el.getAttribute('y')) };
  });
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await openNewDiagram(page);
  (page as Page & { __errors?: string[] }).__errors = errors;
});

test('renders the canvas-first chrome', async ({ page }) => {
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('.tool-dock')).toBeVisible();
  await expect(page.locator('.zoom-controls')).toBeVisible();
  await expect(page.locator('.statusbar')).toBeVisible();
  // The inspector is contextual: nothing selected means it is not on screen.
  await expect(page.locator('.inspector')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toBeVisible();
});

test('places a group from the tool dock', async ({ page }) => {
  await page.locator('[data-tool="group"]').click();
  await page.locator('.canvas-surface').click({ position: { x: 500, y: 300 } });

  await expect(page.locator('.empty-state')).toHaveCount(0);
  await expect(page.locator('.statusbar-meta').first()).toContainText('3');
});

test('undo restores the exact position after a drag', async ({ page }) => {
  await page.locator('[data-tool="group"]').click();
  await page.locator('.canvas-surface').click({ position: { x: 400, y: 300 } });
  await page.locator('.canvas-surface').click({ position: { x: 420, y: 320 } });
  await expect(page.locator('.inspector')).toBeVisible();

  const before = await groupRect(page);
  expect(before).not.toBeNull();

  // mouse.* takes page coordinates, while locator.click takes element-relative
  // ones; the canvas sits below the top bar, so they are not interchangeable.
  const from = await pagePoint(page, 420, 320);
  const to = await pagePoint(page, 620, 460);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();

  const afterDrag = await groupRect(page);
  expect(afterDrag!.x).not.toBe(before!.x);

  // This is the regression: the old editor pushed the already-moved model onto
  // the history, so Ctrl+Z did nothing.
  await page.keyboard.press('ControlOrMeta+z');
  const afterUndo = await groupRect(page);
  expect(afterUndo).toEqual(before);

  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect(await groupRect(page)).toEqual(afterDrag);
});

test('undo still reaches the drawing after the title field had the keyboard', async ({ page }) => {
  // Rename first, so focus sits in a text field; then move a shape. In some
  // browsers a press inside the SVG does not take focus from that field, and
  // Cmd+Z went to the title instead of the drawing.
  await page.locator('[data-tool="group"]').click();
  await page.locator('.canvas-surface').click({ position: { x: 400, y: 300 } });
  await page.locator('.topbar-name').fill('Pagos');
  await page.locator('.topbar-name').evaluate((el) => (el as HTMLInputElement).focus());

  const before = await groupRect(page);
  const from = await pagePoint(page, 420, 320);
  const to = await pagePoint(page, 600, 440);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  expect((await groupRect(page))!.x).not.toBe(before!.x);

  await page.keyboard.press('ControlOrMeta+z');
  expect(await groupRect(page)).toEqual(before);
  await expect(page.locator('.topbar-name')).toHaveValue('Pagos');
});

test('a run of arrow-key nudges is one undo step', async ({ page }) => {
  await page.locator('[data-tool="group"]').click();
  await page.locator('.canvas-surface').click({ position: { x: 400, y: 300 } });
  await page.locator('.canvas-surface').click({ position: { x: 420, y: 320 } });
  const before = await groupRect(page);

  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
  expect((await groupRect(page))!.x).toBe(before!.x + 12);

  // One press, not twelve: a one-pixel step back reads as "undo does nothing".
  await page.keyboard.press('ControlOrMeta+z');
  expect(await groupRect(page)).toEqual(before);
});

test('typing a label is one undo step, even with the keyboard still in the field', async ({
  page,
}) => {
  await page.locator('[data-tool="group"]').click();
  await page.locator('.canvas-surface').click({ position: { x: 400, y: 300 } });
  await page.locator('.canvas-surface').click({ position: { x: 420, y: 320 } });
  const label = page.locator('.inspector .input').first();
  const original = await label.inputValue();

  await label.click();
  await label.pressSequentially('XYZ');
  await expect(label).toHaveValue(`${original}XYZ`);

  // Cmd+Z inside the field: whatever the browser's own field history does, the
  // typed word must be gone afterwards, from the model and from the field.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(label).toHaveValue(original);
  await expect(page.locator('.canvas-surface')).not.toContainText('XYZ');
});

test('says so when there is nothing to undo', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.toast')).toContainText('No hay nada que deshacer');
});

test('opens the command palette and adds a service', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('.palette')).toBeVisible();

  await page.locator('.palette-input').fill('lambda');
  await expect(page.locator('.palette-row').first()).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(page.locator('.palette')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toHaveCount(0);
});

test('zooms at the cursor with ctrl+wheel', async ({ page }) => {
  const readZoom = () =>
    page
      .locator('.zoom-value')
      .innerText()
      .then((t) => Number(t.replace('%', '')));

  expect(await readZoom()).toBe(100);
  const centre = await pagePoint(page, 600, 400);
  await page.mouse.move(centre.x, centre.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');

  expect(await readZoom()).toBeGreaterThan(100);
});

test('selection opens the contextual inspector and edits the title', async ({ page }) => {
  await page.locator('[data-tool="group"]').click();
  await page.locator('.canvas-surface').click({ position: { x: 500, y: 300 } });
  await page.locator('.canvas-surface').click({ position: { x: 520, y: 320 } });

  await expect(page.locator('.inspector')).toBeVisible();
  await page.locator('.inspector .input').first().fill('Payments API');
  await expect(page.locator('.canvas-surface')).toContainText('Payments API');
});

test('Delete removes the selection, but not while typing in a field', async ({ page }) => {
  await page.locator('[data-tool="group"]').click();
  await page.locator('.canvas-surface').click({ position: { x: 500, y: 300 } });
  await page.locator('.canvas-surface').click({ position: { x: 520, y: 320 } });
  await expect(page.locator('.inspector')).toBeVisible();

  // Focus inside a text field: Delete must edit the text, not destroy the shape.
  await page.locator('.inspector .input').first().click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.inspector')).toBeVisible();

  // Focus back on the canvas: now Delete removes the shape.
  await page.locator('.canvas-surface').click({ position: { x: 520, y: 320 } });
  await page.keyboard.press('Delete');
  await expect(page.locator('.inspector')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toBeVisible();
});

test('opens dark, and the light choice survives a reload', async ({ page }) => {
  // The chrome is dark by default: it is meant to sit back behind the drawing.
  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.getByRole('button', { name: /modo oscuro|toggle dark/i }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);

  await page.reload();
  await page.waitForSelector('.canvas-surface');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('the canvas follows the chrome, so the screen matches the export', async ({ page }) => {
  // A dark editor with a white sheet in the middle is a lamp, not a workspace —
  // and an export made from it came out dark while the screen was white.
  // The sheet is the surface's own background; the first <rect> is the grid.
  const sheet = () =>
    page.locator('.canvas-surface').evaluate((el) => {
      const rgb = getComputedStyle(el).backgroundColor.match(/\d+/g)!.map(Number);
      return `#${rgb
        .slice(0, 3)
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')}`;
    });
  const inDark = await sheet();
  expect(inDark?.toLowerCase()).toBe('#0e1526');
  await page.getByRole('button', { name: /modo oscuro|toggle dark/i }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  expect((await sheet())?.toLowerCase()).toBe('#ffffff');
});

test('reports no console or page errors', async ({ page }) => {
  await page.locator('[data-tool="group"]').click();
  await page.locator('.canvas-surface').click({ position: { x: 500, y: 300 } });
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.press('Escape');

  const errors = (page as Page & { __errors?: string[] }).__errors ?? [];
  expect(errors).toEqual([]);
});

test('double-click focuses the title field for quick renaming', async ({ page }) => {
  await page.locator('[data-tool="group"]').click();
  await page.locator('.canvas-surface').click({ position: { x: 500, y: 300 } });

  const shape = await pagePoint(page, 520, 320);
  await page.mouse.dblclick(shape.x, shape.y);

  await expect(page.locator('.inspector')).toBeVisible();
  await expect(page.locator('.inspector .input').first()).toBeFocused();
});

test('every advertised command is reachable from the palette', async ({ page }) => {
  // Guards against a menu entry that points at nothing, which is how the old
  // editor ended up advertising Ctrl+S without implementing it.
  for (const term of ['Abrir', 'Guardar', 'Exportar SVG', 'Plantillas', 'Atajos']) {
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('.palette-input').fill(term);
    await expect(page.locator('.palette-row').first()).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

test('a resting pointer cannot steal the palette selection', async ({ page }) => {
  // Opening the palette under a stationary cursor used to highlight whatever row
  // rendered beneath it, so a blind Enter could fire a destructive command.
  await page.mouse.move(720, 300);
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.palette-input').fill('IA');
  await expect(page.locator('.palette-row.is-active .palette-label')).toContainText('IA');

  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('⌘F finds a shape by name and glides the camera to it', async ({ page }) => {
  // The Microservices template, from its card: with a diagram already in the
  // library, the hero's showcase would open that diagram instead.
  await page.goto('/');
  await page
    .locator('.library-templates .template-card')
    .filter({ hasText: 'Microservicios' })
    .click();
  await page.waitForSelector('.canvas-surface');
  const before = await page.locator('.canvas-surface > g[transform]').getAttribute('transform');

  await page.keyboard.press('ControlOrMeta+f');
  const find = page.locator('.find-bar-input');
  await expect(find).toBeFocused();
  // "Queue" is both a group and the service inside it: two matches, first shown.
  await find.fill('queue');
  await expect(page.locator('.find-bar-count')).toContainText('1 de 2');
  // The match is selected and the camera has moved towards it.
  await expect(page.locator('.selection-outline')).toHaveCount(1);
  await expect
    .poll(() => page.locator('.canvas-surface > g[transform]').getAttribute('transform'))
    .not.toBe(before);

  await find.fill('prod');
  await expect(page.locator('.find-bar-count')).toContainText('de 7');
  await find.press('Enter');
  await expect(page.locator('.find-bar-count')).toContainText('2 de 7');

  await find.press('Escape');
  await expect(page.locator('.find-bar')).toHaveCount(0);
});
