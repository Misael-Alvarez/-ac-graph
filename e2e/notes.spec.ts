import { expect, test, type Page } from '@playwright/test';
import { addGroupAt, openNewDiagram, pagePoint } from './helpers';

/** The dock tool, then a press on the canvas: the same gesture as every other shape. */
async function place(page: Page, tool: 'region' | 'note' | 'text', x: number, y: number) {
  await page.locator(`[data-tool="${tool}"]`).click();
  await page.locator('.canvas-surface').click({ position: { x, y } });
}

async function download(page: Page, trigger: () => Promise<void>) {
  const pending = page.waitForEvent('download');
  await trigger();
  const stream = await (await pending).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

test.beforeEach(async ({ page }) => {
  await openNewDiagram(page);
  await page.mouse.move(5, 5);
});

test('a note is placed, selected and written on at once, and draws its markup', async ({
  page,
}) => {
  await place(page, 'note', 500, 300);
  const note = page.locator('.canvas-surface [data-shape-id^="nt_"]');
  await expect(note).toHaveCount(1);
  // Placed and already selected, with the text field waiting.
  await expect(page.locator('.inspector-type')).toHaveText('Nota');
  const field = page.locator('.inspector textarea');
  await expect(field).toBeFocused();
  await expect(page.locator('.tool-button[data-tool="select"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await field.fill('# Pendiente\n- migrar la **cola** a `SQS`\n\nRevisión el jueves');
  const canvas = page.locator('.canvas-surface');
  await expect(canvas).toContainText('Pendiente');
  await expect(canvas).toContainText('migrar la');
  await expect(canvas).toContainText('Revisión el jueves');
  // The heading is drawn larger than the body; the bold word in a heavier weight.
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('.canvas-surface text')]
      .filter((t) => /Pendiente|migrar/.test(t.textContent ?? ''))
      .map((t) => Number(t.getAttribute('font-size'))),
  );
  expect(Math.max(...sizes)).toBeGreaterThan(Math.min(...sizes) * 1.5);
  await expect(canvas.locator('tspan[font-weight="600"]', { hasText: 'cola' })).toHaveCount(1);
  await expect(canvas.locator('tspan[font-family*="monospace"]', { hasText: 'SQS' })).toHaveCount(
    1,
  );
  // The hero shows the first line, without its markup.
  await expect(page.locator('.inspector-hero-title')).toHaveText('Pendiente');

  // Its paper comes in five colours.
  await page.getByRole('button', { name: 'Rosa' }).click();
  await expect(page.locator('.canvas-surface path[data-shape-id^="nt_"]')).toHaveAttribute(
    'fill',
    '#fbcfe8',
  );
});

test('the keyboard places all three, and Escape then leaves the canvas as it was', async ({
  page,
}) => {
  await page.locator('.canvas-surface').click({ position: { x: 400, y: 570 } });
  await page.keyboard.press('r');
  await expect(page.locator('.tool-button[data-tool="region"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('.canvas-surface').click({ position: { x: 200, y: 150 } });
  await expect(page.locator('.canvas-surface [data-shape-id^="rg_"]')).toHaveCount(1);
  await expect(page.locator('.inspector-type')).toHaveText('Región');
  // A region's caption is its title, edited in the hero like any name.
  await page.locator('.inspector .inspector-hero-title').fill('Zona DMZ');
  await expect(page.locator('.canvas-surface')).toContainText('ZONA DMZ');

  await page.locator('.canvas-surface').click({ position: { x: 400, y: 570 } });
  await page.keyboard.press('t');
  await page.locator('.canvas-surface').click({ position: { x: 200, y: 600 } });
  await expect(page.locator('.canvas-surface [data-shape-id^="tx_"]')).toHaveCount(1);
  await expect(page.locator('.inspector-type')).toHaveText('Texto');
  await page.locator('.inspector textarea').fill('## Fase 2');
  await expect(page.locator('.canvas-surface')).toContainText('Fase 2');

  await page.locator('.canvas-surface').click({ position: { x: 400, y: 570 } });
  await page.keyboard.press('n');
  await page.locator('.canvas-surface').click({ position: { x: 600, y: 600 } });
  await expect(page.locator('.canvas-surface [data-shape-id^="nt_"]')).toHaveCount(1);

  // Three shapes, three undos, nothing.
  await page.locator('.canvas-surface').click({ position: { x: 400, y: 570 } });
  for (let i = 0; i < 5; i++) await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.canvas-surface [data-shape-id]')).toHaveCount(0);
});

test('a region lies under the groups, never collides, and a lasso across it takes only the services', async ({
  page,
}) => {
  await addGroupAt(page, 300, 200);
  await place(page, 'region', 200, 150);
  const region = page.locator('.canvas-surface [data-shape-id^="rg_"]');
  await expect(region).toHaveCount(1);
  // Painted before the group: earlier in the document is lower on the sheet.
  const order = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.canvas-surface [data-shape-id]')];
    return {
      region: all.findIndex((el) => el.getAttribute('data-shape-id')!.startsWith('rg_')),
      group: all.findIndex((el) => el.getAttribute('data-shape-id')!.startsWith('grp_')),
    };
  });
  expect(order.region).toBeLessThan(order.group);
  // Overlapping the group is the point, so nothing is flagged.
  await expect(page.locator('.collision-outline')).toHaveCount(0);

  // A lasso from the sheet across part of the region and over the group
  // selects the group alone; the region would have to be enclosed whole.
  await page.keyboard.press('Escape');
  const from = await pagePoint(page, 150, 120);
  const to = await pagePoint(page, 700, 450);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  // The group and its service — and Delete proves the region was not among them.
  await expect(page.locator('.inspector')).toContainText('2 formas seleccionadas');
  await page.keyboard.press('Delete');
  await expect(page.locator('.canvas-surface [data-shape-id^="grp_"]')).toHaveCount(0);
  await expect(region).toHaveCount(1);
});

test('an arrow will not attach to a note', async ({ page }) => {
  await addGroupAt(page, 200, 200);
  await place(page, 'note', 800, 200);
  await page.keyboard.press('Escape');
  await page.locator('[data-tool="connector"]').click();
  await page
    .locator('.canvas-surface rect[data-shape-id^="itm_"]')
    .first()
    .click({ position: { x: 30, y: 20 } });
  await page
    .locator('.canvas-surface [data-shape-id^="nt_"]')
    .click({ position: { x: 30, y: 30 } });
  await expect(page.locator('.canvas-surface .connector-stroke')).toHaveCount(0);
  await expect(page.locator('.statusbar')).toContainText('0 conexiones');
});

test('notes survive the code panel, a reload and reach the export', async ({ page }) => {
  await addGroupAt(page, 200, 200);
  await place(page, 'note', 800, 200);
  await page.locator('.inspector textarea').fill('Recordar **esto**');
  await place(page, 'region', 100, 100);
  await page.locator('.inspector .inspector-hero-title').fill('Zona');

  // The document carries them in their own section, with their geometry.
  await page.keyboard.press('ControlOrMeta+/');
  await expect(page.locator('.cm-content')).toBeVisible();
  const yaml = await page.locator('.cm-content').innerText();
  expect(yaml).toContain('notes:');
  expect(yaml).toMatch(/recordar-esto:\s+text: Recordar \*\*esto\*\*/);
  expect(yaml).toMatch(/zona:\s+kind: region/);
  await page.keyboard.press('ControlOrMeta+/');

  // Saved as schema 4 and read back.
  await expect(page.locator('.topbar .save-status')).toHaveText('Guardado');
  await page.reload();
  await page.waitForSelector('.canvas-surface');
  await expect(page.locator('.canvas-surface [data-shape-id^="nt_"]')).toHaveCount(1);
  await expect(page.locator('.canvas-surface [data-shape-id^="rg_"]')).toHaveCount(1);
  await expect(page.locator('.canvas-surface')).toContainText('Recordar');

  // And in the SVG, with the same lines the screen draws.
  const svg = await download(page, async () => {
    await page.keyboard.press('ControlOrMeta+e');
    await page.getByRole('menuitem', { name: /^SVG/ }).click();
  });
  expect(svg).toContain('Recordar');
  expect(svg).toContain('ZONA');
  expect(svg).toMatch(/<tspan[^>]*font-weight="600"[^>]*>esto<\/tspan>/);
  // The reader who cannot see it is told what it says.
  expect(svg).toMatch(/<desc>[^<]*Notas: Recordar esto; Zona\./);
});
