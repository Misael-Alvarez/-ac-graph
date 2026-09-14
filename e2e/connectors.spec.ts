import { expect, test, type Locator, type Page } from '@playwright/test';
import { openNewDiagram } from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });

const stroke = (page: Page) => page.locator('.canvas-surface .connector-stroke');
const route = (page: Page) => stroke(page).getAttribute('d');
const choose = (page: Page, group: string, option: string) =>
  page
    .getByRole('radiogroup', { name: group, exact: true })
    .getByRole('radio', { name: option, exact: true })
    .click();

async function selectLine(page: Page) {
  const at = await pointOnLine(page, 0.2);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.inspector-type')).toHaveText('Conexión');
}

async function pointOnLine(page: Page, at: number) {
  return stroke(page).evaluate((el, at) => {
    const path = el as SVGPathElement;
    const p = path.getPointAtLength(path.getTotalLength() * at);
    const screen = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  }, at);
}

async function drag(page: Page, handle: Locator, dx: number, dy: number) {
  const box = (await handle.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await openNewDiagram(page);
  await page.keyboard.press('ControlOrMeta+/');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  // Insert the document in one input event; Firefox ignores synthetic clipboard data.
  await page.keyboard.insertText(
    'cloud: aws\nnodes:\n  fn: lambda\n  db: dynamodb\nedges:\n  - fn -> db: R/W\nlayout:\n  fn: [100, 120]\n  db: [900, 450]\n',
  );
  await expect(stroke(page)).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+/');
  await page
    .locator('.topbar')
    .getByRole('button', { name: 'Ajustar a la vista', exact: true })
    .click();
  await page.waitForTimeout(450);
  await selectLine(page);
});

test('ports, elbows, weight and color change the rendered line and its arrowhead', async ({
  page,
}) => {
  for (const [group, itemIndex, end] of [
    ['Puerto de origen', 0, false],
    ['Puerto de destino', 1, true],
  ] as const) {
    const box = await page
      .locator('rect[data-shape-id^="itm_"]')
      .nth(itemIndex)
      .evaluate((el) => ({
        x: Number(el.getAttribute('x')),
        y: Number(el.getAttribute('y')),
        w: Number(el.getAttribute('width')),
        h: Number(el.getAttribute('height')),
      }));
    for (const [name, x, y] of [
      ['Arriba', box.x + box.w / 2, box.y],
      ['Abajo', box.x + box.w / 2, box.y + box.h],
      ['Derecha', box.x + box.w, box.y + box.h / 2],
      ['Izquierda', box.x, box.y + box.h / 2],
    ] as const) {
      await choose(page, group, name);
      const point = await stroke(page).evaluate((el, end) => {
        const path = el as SVGPathElement;
        const p = path.getPointAtLength(end ? path.getTotalLength() : 0);
        return { x: p.x, y: p.y };
      }, end);
      expect(point.x).toBeCloseTo(x, 1);
      expect(point.y).toBeCloseTo(y, 1);
    }
    await choose(page, group, 'Automático');
    await expect(
      page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: 'Automático' }),
    ).toHaveAttribute('aria-checked', 'true');
  }
  await choose(page, 'Codos', 'Ortogonales');
  expect(await route(page)).not.toContain('Q');
  await choose(page, 'Codos', 'Redondeados');
  expect(await route(page)).toContain('Q');
  const normal = Number(await stroke(page).getAttribute('stroke-width'));
  await choose(page, 'Grosor', 'Grueso');
  expect(Number(await stroke(page).getAttribute('stroke-width'))).toBeGreaterThan(normal);
  await choose(page, 'Grosor', 'Fino');
  expect(Number(await stroke(page).getAttribute('stroke-width'))).toBeLessThan(normal);
  await choose(page, 'Grosor', 'Normal');
  await expect(stroke(page)).toHaveAttribute('stroke-width', String(normal));
  await page.locator('.color-field .input').fill('#cc4422');
  await expect(stroke(page)).toHaveAttribute('stroke', '#cc4422');
  await expect(stroke(page)).toHaveAttribute('marker-end', 'url(#arrowhead-c-cc4422)');
  await expect(page.locator('#arrowhead-c-cc4422 path')).toHaveAttribute('fill', '#cc4422');
  await page.locator('.color-field .input').fill('invalid');
  await expect(page.locator('.color-field .input')).toHaveAttribute('aria-invalid', 'true');
  await expect(stroke(page)).toHaveAttribute('stroke', '#cc4422');
  await page.locator('.color-field .input').fill('');
  await expect(stroke(page)).not.toHaveAttribute('stroke', '#cc4422');
});

test('points can be added, dragged, nudged and removed, with one undo per gesture', async ({
  page,
}) => {
  const original = await route(page);
  const handles = page.locator('[data-bend-index]');
  const count = await handles.count();
  await page.getByRole('button', { name: 'Añadir punto de ruta', exact: true }).click();
  await expect(handles).toHaveCount(count + 1);
  await expect(page.getByRole('button', { name: 'Restablecer ruta automática' })).toBeEnabled();
  const handle = page.locator('[data-bend-index="1"]');
  await handle.focus();
  const beforeNudge = await handle.getAttribute('transform');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  await expect(handle).not.toHaveAttribute('transform', beforeNudge!);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(handle).toHaveAttribute('transform', beforeNudge!);
  const beforeDrag = await route(page);
  await drag(page, handle, 65, 55);
  const afterDrag = await route(page);
  expect(afterDrag).not.toBe(beforeDrag);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(stroke(page)).toHaveAttribute('d', beforeDrag!);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(stroke(page)).toHaveAttribute('d', afterDrag!);
  await handle.focus();
  await page.keyboard.press('Delete');
  await expect(handles).toHaveCount(count);
  await expect(stroke(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Restablecer ruta automática' }).click();
  await expect(stroke(page)).toHaveAttribute('d', original!);
  await expect(page.getByRole('button', { name: 'Restablecer ruta automática' })).toBeDisabled();
});

test('reselecting a point starts a separate keyboard undo step', async ({ page }) => {
  await page.getByRole('button', { name: 'Añadir punto de ruta', exact: true }).click();
  const handle = page.locator('[data-bend-index="1"]');
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  const firstGesture = await route(page);
  await page.keyboard.press('Escape');
  await expect(handle).toHaveCount(0);
  await selectLine(page);
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  await expect(stroke(page)).not.toHaveAttribute('d', firstGesture!);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(stroke(page)).toHaveAttribute('d', firstGesture!);
});

test('double click adds a point and cancellation leaves the saved route untouched', async ({
  page,
}) => {
  const count = await page.locator('[data-bend-index]').count();
  const point = await pointOnLine(page, 0.15);
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.locator('[data-bend-index]')).toHaveCount(count + 1);
  const handle = page.locator('[data-bend-index="1"]');
  const original = await route(page);
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 50, { steps: 5 });
  await expect(stroke(page)).not.toHaveAttribute('d', original!);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(stroke(page)).toHaveAttribute('d', original!);
  await expect(page.locator('.connector.is-selected')).toHaveCount(1);
});

test('a pointer-up before the next animation frame still commits the final bend', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Añadir punto de ruta', exact: true }).click();
  const handle = page.locator('[data-bend-index="1"]');
  const box = (await handle.boundingBox())!;
  const original = await route(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await handle.dispatchEvent('pointerdown', { clientX: x, clientY: y, button: 0, pointerId: 1 });
  await page.evaluate(
    ({ x, y }) => {
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: x + 50, clientY: y + 40, pointerId: 1 }),
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: x + 100, clientY: y + 80, pointerId: 1 }),
      );
    },
    { x, y },
  );
  await expect(stroke(page)).not.toHaveAttribute('d', original!);
  const after = await handle.boundingBox();
  expect(after!.x - box.x).toBeGreaterThan(80);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(stroke(page)).toHaveAttribute('d', original!);
});

test('the label moves along the line by drag, keyboard or percent and can be reset', async ({
  page,
}) => {
  const label = page.locator('.connector-label');
  const original = await label.getAttribute('x');
  const slider = page.getByRole('slider', { name: 'Posición de la etiqueta' });
  const box = (await slider.boundingBox())!;
  const to = await pointOnLine(page, 0.1);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect(label).not.toHaveAttribute('x', original!);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(label).toHaveAttribute('x', original!);
  await slider.focus();
  await page.keyboard.press('End');
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  await page.getByRole('spinbutton', { name: 'Posición de la etiqueta', exact: true }).fill('25');
  await expect(slider).toHaveAttribute('aria-valuenow', '25');
  await page.getByRole('button', { name: 'Restablecer posición de etiqueta' }).click();
  await expect(label).toHaveAttribute('x', original!);
});

test('manual geometry and styles survive code, views, reload, SVG and shared links', async ({
  page,
}) => {
  await choose(page, 'Puerto de origen', 'Derecha');
  await choose(page, 'Puerto de destino', 'Izquierda');
  await page.getByRole('button', { name: 'Añadir punto de ruta', exact: true }).click();
  await drag(page, page.locator('[data-bend-index="1"]'), -60, 55);
  await choose(page, 'Codos', 'Ortogonales');
  await choose(page, 'Grosor', 'Grueso');
  await page.locator('.color-field .input').fill('#cc4422');
  await page.getByRole('spinbutton', { name: 'Posición de la etiqueta', exact: true }).fill('75');
  const drawn = await route(page);
  const labelX = await page.locator('.connector-label').getAttribute('x');

  await page.keyboard.press('ControlOrMeta+/');
  await expect(page.locator('.cm-content')).toContainText('via:');
  await expect(page.locator('.cm-content')).toContainText('labelAt: 0.75');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  await page.keyboard.press('ControlOrMeta+/');
  await expect(stroke(page)).toHaveAttribute('d', drawn!);
  await expect(page.locator('.connector-label')).toHaveAttribute('x', labelX!);

  await page.locator('.view-bar .chip', { hasText: 'Nueva vista' }).click();
  await page.locator('.view-bar-input').fill('Detalle');
  await page.keyboard.press('Enter');
  await drag(page, page.locator('rect[data-shape-id^="grp_"]').first(), 0, 80);
  await selectLine(page);
  await page.getByRole('button', { name: 'Añadir punto de ruta', exact: true }).click();
  await drag(page, page.locator('[data-bend-index="1"]'), 35, 20);
  const inView = await route(page);
  await page.locator('.view-bar [role="tab"]').first().click();
  await page.locator('.view-bar [role="tab"]').nth(1).click();
  await expect(stroke(page)).toHaveAttribute('d', inView!);
  await expect(page.locator('.topbar .save-status')).toHaveText('Guardado');
  await page.reload();
  // The editor opens on its main view; the named arrangement is document data.
  await page.locator('.view-bar [role="tab"]').nth(1).click();
  await expect(stroke(page)).toHaveAttribute('d', inView!);
  await expect(stroke(page)).toHaveAttribute('stroke', '#cc4422');

  const download = page.waitForEvent('download');
  await page.keyboard.press('ControlOrMeta+e');
  await page.getByRole('menuitem', { name: /^SVG/ }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const svg = Buffer.concat(chunks).toString();
  expect(svg).toContain(`d="${inView}"`);
  expect(svg).toContain('stroke="#cc4422"');
  expect(svg).not.toContain('connector-handle');

  await page.keyboard.press('ControlOrMeta+Shift+s');
  const link = await page.locator('.share-field').first().locator('input').inputValue();
  const markdown = await page.locator('.share-field').nth(2).locator('input').inputValue();
  const embed = markdown.match(/\((https?:\/\/[^)]+api\/embed[^)]*)\)/)![1];
  const response = await page.request.get(embed);
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain('stroke="#cc4422"');
  await page.goto(link);
  await expect(page.locator('.shared-surface .connector-stroke')).toHaveAttribute('d', inView!);
  await expect(page.locator('[data-bend-index], .connector-label-control')).toHaveCount(0);
});

test('presentation exposes no editing handles or label controls', async ({ page }) => {
  await page.getByRole('button', { name: 'Añadir punto de ruta', exact: true }).click();
  await expect(page.locator('[data-bend-index]').first()).toBeVisible();
  await page.keyboard.press('F5');
  await expect(page.locator('.presentation')).toBeVisible();
  await expect(page.locator('[data-bend-index], .connector-label-control, .inspector')).toHaveCount(
    0,
  );
});

test('connector controls remain reachable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const field = page.getByRole('spinbutton', { name: 'Posición de la etiqueta', exact: true });
  await field.fill('20');
  await expect(field).toHaveValue('20');
  const box = (await page.locator('.inspector').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Añadir punto de ruta', exact: true }).click();
  await expect(page.locator('[data-bend-index]').first()).toBeAttached();
  await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(0);
  await expect.poll(() => page.locator('.editor-root').evaluate((el) => el.scrollLeft)).toBe(0);
  expect((await page.locator('.inspector').boundingBox())!.x).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: test.info().outputPath('connector-mobile.png') });
});
