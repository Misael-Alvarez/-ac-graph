import { test, expect, type Page } from '@playwright/test';
import { inflateRawSync } from 'node:zlib';
import type { DiagramModel } from '../src/lib/domain';
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

async function runCommand(page: Page, label: string) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.palette-input').fill(label);
  await page.getByRole('option', { name: label }).click();
}

async function download(page: Page, trigger: () => Promise<void>) {
  const pending = page.waitForEvent('download');
  await trigger();
  const stream = await (await pending).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function nativeModel(page: Page): Promise<DiagramModel> {
  return JSON.parse(
    (await download(page, () => page.keyboard.press('ControlOrMeta+s'))).toString(),
  );
}

async function sharedModel(page: Page): Promise<DiagramModel> {
  const field = page.getByRole('textbox', { name: 'Enlace', exact: true });
  await expect(field).toBeVisible();
  const payload = new URL(await field.inputValue()).searchParams.get('d')!;
  return JSON.parse(inflateRawSync(Buffer.from(payload, 'base64url')).toString());
}

async function narrowToGroups(page: Page, count = 1) {
  await addView(page, 'Vista de prueba');
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const group = page.locator('[data-shape-id^="grp_"]').nth(i);
    ids.push((await group.getAttribute('data-shape-id'))!);
    // The floating view bar covers the top edge of the template's first row, and
    // the dashed container starts 64 canvas units down a 208-unit card, so the
    // click lands on the group's own header band between the two — measured as a
    // fraction of the rendered box, which holds at any zoom.
    const box = (await group.boundingBox())!;
    await group.click({
      position: { x: box.width * 0.05, y: box.height * 0.24 },
      modifiers: i ? ['Shift'] : [],
    });
  }
  await page.getByRole('button', { name: 'Limitar a la selección' }).click();
  return ids;
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

test('moving in the main reading of a split model leaves the other view alone', async ({
  page,
}) => {
  await addView(page, 'Seguridad');
  await page.locator('.view-bar [role="tab"]').first().click();
  const before = await dragBy(page, '[data-shape-id^="grp_"]', 200, 0);
  const moved = (await page.locator('[data-shape-id^="grp_"]').first().boundingBox())!;
  expect(moved.x).toBeGreaterThan(before.x + 150);

  await page.locator('.view-bar [role="tab"]').nth(1).click();
  const inView = (await page.locator('[data-shape-id^="grp_"]').first().boundingBox())!;
  expect(Math.round(inView.x)).toBe(Math.round(before.x));
  expect(Math.round(inView.y)).toBe(Math.round(before.y));
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

  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.locator('.selection-outline')).toHaveCount(4);
  await page.keyboard.press('ControlOrMeta+Shift+s');
  const projected = await sharedModel(page);
  expect(projected.shapes).toHaveLength(5);
  expect(projected.views).toEqual([]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+Shift+a');
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

test('select-all, nudge and inspector use the narrowed view and undo preserves the model', async ({
  page,
}) => {
  const [id] = await narrowToGroups(page);
  const before = await nativeModel(page);
  const group = page.locator(`[data-shape-id="${id}"]`);
  const x = Number(await group.getAttribute('x'));
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.locator('.selection-outline')).toHaveCount(2);
  await page.keyboard.press('Shift+ArrowRight');
  await expect(group).toHaveAttribute('x', String(x + 18));
  const moved = await nativeModel(page);
  expect(moved.shapes).toEqual(before.shapes);
  expect(moved.connectors).toEqual(before.connectors);
  expect(moved.views[1].place?.[id].x).toBe(x + 18);

  await group.click({ position: { x: 20, y: 12 } });
  await page.getByRole('button', { name: 'Posición', exact: true }).click();
  // The position is a field now, and it reads the view's placement.
  await expect(page.getByLabel('X', { exact: true })).toHaveValue(String(Math.round(x + 18)));
  await page.keyboard.press('ControlOrMeta+z');
  await expect(group).toHaveAttribute('x', String(x));
  expect(await nativeModel(page)).toEqual(before);
});

test('fit from the keyboard and zoom controls frames only the narrowed reading', async ({
  page,
}) => {
  await page.keyboard.press('ControlOrMeta+1');
  const wholeZoom = Number((await page.locator('.zoom-value').innerText()).replace('%', ''));
  await narrowToGroups(page);
  await page.keyboard.press('ControlOrMeta+Shift+a');
  await page.keyboard.press('ControlOrMeta+1');
  const narrowedZoom = await page.locator('.zoom-value').innerText();
  expect(Number(narrowedZoom.replace('%', ''))).toBeGreaterThan(wholeZoom);
  await page.keyboard.press('ControlOrMeta+0');
  await page
    .locator('.zoom-controls')
    .getByRole('button', { name: /Ajustar/ })
    .click();
  await expect(page.locator('.zoom-value')).toHaveText(narrowedZoom);
});

test('alignment, distribution and auto-layout edit placements in one undo step', async ({
  page,
}) => {
  await narrowToGroups(page, 3);
  await page.keyboard.press('ControlOrMeta+a');
  const before = await nativeModel(page);
  for (const label of [
    'Alinear a la izquierda',
    'Espaciar en horizontal',
    'Organizar automáticamente',
  ]) {
    if (label === 'Organizar automáticamente') await runCommand(page, label);
    else
      await page
        .locator('.selection-toolbar')
        .getByRole('button', { name: label, exact: true })
        .click();
    const after = await nativeModel(page);
    expect(after.shapes).toEqual(before.shapes);
    expect(after.connectors).toEqual(before.connectors);
    expect(after.views[0]).toEqual(before.views[0]);
    expect(after.views[1].place).not.toEqual(before.views[1].place);
    await page.keyboard.press('ControlOrMeta+z');
    expect(await nativeModel(page)).toEqual(before);
  }
});

test('SVG, PNG and Markdown export the view while native JSON keeps the full model', async ({
  page,
}) => {
  const [id] = await narrowToGroups(page);
  await page.keyboard.press('Shift+ArrowRight');
  const full = await nativeModel(page);
  const svg = (
    await download(page, () => runCommand(page, 'Exportar SVG (vista actual)'))
  ).toString();
  // Mod+E opens the export menu in the top bar; Markdown is one of its rows.
  const markdown = (
    await download(page, async () => {
      await page.keyboard.press('ControlOrMeta+e');
      await page.getByRole('menuitem', { name: /^Markdown/ }).click();
    })
  ).toString();
  const png = await download(page, () => runCommand(page, 'Exportar PNG (vista actual)'));
  const shown = full.shapes.filter(
    (s) =>
      s.id === id ||
      s.parentId === id ||
      full.shapes.some((p) => p.id === s.parentId && p.parentId === id),
  );
  const shownIds = new Set(shown.map((s) => s.id));
  for (const s of full.shapes) {
    if (shownIds.has(s.id)) expect(svg).toContain(`data-shape-id="${s.id}"`);
    else expect(svg).not.toContain(`data-shape-id="${s.id}"`);
    if (s.type === 'item' && s.title && !shown.some((v) => v.title === s.title)) {
      expect(markdown).not.toContain(s.title);
    }
  }
  expect(markdown).toContain(shown.find((s) => s.type === 'item')!.title!);
  expect(full.shapes.length).toBeGreaterThan(shown.length);
  expect(full.views).toHaveLength(2);
  const svgSize = svg.match(/<svg[^>]*\bwidth="(\d+)" height="(\d+)"/)!;
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(Number(svgSize[1]) * 2);
  expect(png.readUInt32BE(20)).toBe(Number(svgSize[2]) * 2);
});

test('the draw.io export writes one page per view with the icons embedded', async ({ page }) => {
  const [id] = await narrowToGroups(page);
  const full = await nativeModel(page);
  const drawio = (
    await download(page, async () => {
      await page.keyboard.press('ControlOrMeta+e');
      await page.getByRole('menuitem', { name: /^draw\.io/ }).click();
    })
  ).toString();

  expect(drawio.startsWith('<mxfile ')).toBe(true);
  expect(drawio.match(/<diagram /g)).toHaveLength(2);
  expect(drawio).toContain('name="Vista de prueba"');
  // Every service card carries its icon as an SVG data URL, not a reference.
  expect(drawio).toContain('image=data:image/svg+xml,');
  // The pages are the model's own cells: the whole architecture, then the view
  // narrowed to one group — whose services are the only ones on its page.
  const pages = drawio.split('<diagram ').slice(1);
  for (const s of full.shapes) expect(pages[0]).toContain(`<mxCell id="${s.id}"`);
  const narrowed = full.shapes.filter(
    (s) =>
      s.id === id ||
      s.parentId === id ||
      full.shapes.some((p) => p.id === s.parentId && p.parentId === id),
  );
  expect(narrowed.length).toBeGreaterThan(0);
  expect(pages[1].match(/vertex="1"/g)).toHaveLength(narrowed.length);
  for (const s of narrowed) expect(pages[1]).toContain(`<mxCell id="${s.id}"`);
});

test('sharing defaults to the view, full model is explicit, and reopening resets scope', async ({
  page,
}) => {
  await narrowToGroups(page);
  const full = await nativeModel(page);
  await page.keyboard.press('ControlOrMeta+Shift+s');
  const scope = page.getByRole('combobox', { name: 'Alcance del enlace' });
  await expect(scope).toHaveValue('view');
  const projected = await sharedModel(page);
  expect(projected.shapes).toHaveLength(3);
  expect(projected.views).toEqual([]);
  expect(projected.rules).toBeUndefined();
  const visible = new Set(projected.shapes.map((s) => s.id));
  expect(projected.shapes.every((s) => !s.parentId || visible.has(s.parentId))).toBe(true);
  expect(
    projected.connectors.every((c) => visible.has(c.sourceId) && visible.has(c.targetId)),
  ).toBe(true);

  await scope.selectOption('model');
  expect((await sharedModel(page)).shapes).toEqual(full.shapes);
  await scope.selectOption('view');
  expect((await sharedModel(page)).shapes).toEqual(projected.shapes);
  await scope.selectOption('model');
  await sharedModel(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+Shift+s');
  await expect(scope).toHaveValue('view');
  expect((await sharedModel(page)).shapes).toEqual(projected.shapes);
  await expect(page.getByRole('dialog', { name: 'Compartir' })).toContainText(
    'ni se puede revocar',
  );
});
