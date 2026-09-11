import { test, expect, type Page } from '@playwright/test';
import { resetWorkspace } from './helpers';

/** The microservices template: several groups, edges and metadata to draw a legend from. */
async function openTemplate(page: Page) {
  await resetWorkspace(page);
  await page
    .locator('.library-templates .template-card')
    .filter({ hasText: 'Microservicios' })
    .click();
  await page.waitForSelector('.canvas-surface');
  await expect(page.locator('[data-shape-id^="grp_"]').first()).toBeVisible();
}

async function addView(page: Page, name: string) {
  await page.locator('.view-bar .chip', { hasText: 'Nueva vista' }).click();
  await page.locator('.view-bar-input').fill(name);
  await page.keyboard.press('Enter');
  await expect(page.locator('.view-bar .chip.is-active')).toHaveText(new RegExp(name));
}

const transform = (page: Page) =>
  page.locator('.canvas-surface > g[transform]').first().getAttribute('transform');

async function download(page: Page, trigger: () => Promise<void>) {
  const pending = page.waitForEvent('download');
  await trigger();
  const stream = await (await pending).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test('F5 presents: the chrome goes, the views walk with the arrows, Escape returns everything', async ({
  page,
}) => {
  await openTemplate(page);
  await addView(page, 'Vista corta');
  // Back to the whole architecture so the presentation starts at slide one.
  await page.locator('.view-bar [role="tab"]').first().click();
  const before = await transform(page);

  await page.keyboard.press('F5');
  const root = page.locator('.editor-root.is-presenting');
  await expect(root).toHaveCount(1);
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page.locator('.tool-dock')).toHaveCount(0);
  await expect(page.locator('.statusbar')).toHaveCount(0);
  await expect(page.locator('.view-bar')).toHaveCount(0);
  await expect(page.locator('.presentation-title b')).toHaveText(/Microservicios/);
  await expect(page.locator('.presentation-counter')).toHaveText('1 de 2');
  // The legend says what the drawing uses, in the reader's language of marks.
  await expect(page.locator('.presentation-legend .presentation-chip').first()).toBeVisible();
  // The camera framed the slide.
  await expect.poll(() => transform(page)).not.toBe(before);

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.presentation-counter')).toHaveText('2 de 2');
  await expect(page.locator('.presentation-title span')).toHaveText('Vista corta');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.presentation-counter')).toHaveText('2 de 2');
  await page.keyboard.press('Home');
  await expect(page.locator('.presentation-counter')).toHaveText('1 de 2');
  await page.locator('.presentation-nav button[aria-label="Vista siguiente"]').click();
  await expect(page.locator('.presentation-counter')).toHaveText('2 de 2');

  // Nothing can be edited while presenting: a press on a card drags the sheet.
  const card = page.locator('.canvas-surface rect[data-shape-id^="grp_"]').first();
  const box = (await card.boundingBox())!;
  const shown = await transform(page);
  await page.mouse.move(box.x + 20, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 80, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => transform(page)).not.toBe(shown);
  await expect(page.locator('.inspector')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.locator('.editor-root.is-presenting')).toHaveCount(0);
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('.tool-dock')).toBeVisible();
  await expect(page.locator('.view-bar .chip.is-active')).toHaveText(/Vista corta/);
  // The camera slides back to where the author left it.
  await expect.poll(() => transform(page)).toBe(before);
});

test('the More menu and the palette present too, and the PDF has one page per view', async ({
  page,
}) => {
  await openTemplate(page);
  await addView(page, 'Otra vista');

  await page.locator('.topbar .icon-button[aria-label="Más"]').click();
  await page.getByRole('menuitem', { name: /^Presentar/ }).click();
  await expect(page.locator('.editor-root.is-presenting')).toHaveCount(1);
  await page.locator('.presentation-exit').click();
  await expect(page.locator('.editor-root.is-presenting')).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.palette-input').fill('Presentar');
  await page.getByRole('option', { name: 'Presentar' }).click();
  await expect(page.locator('.editor-root.is-presenting')).toHaveCount(1);
  await page.keyboard.press('Escape');

  const pdf = await download(page, async () => {
    await page.keyboard.press('ControlOrMeta+e');
    await page.getByRole('menuitem', { name: /^PDF, una página por vista/ }).click();
  });
  const text = pdf.toString('latin1');
  expect(text.startsWith('%PDF-1.4')).toBe(true);
  expect(text).toContain('/Count 2');
  expect(text.match(/\/Type \/Page\b/g)).toHaveLength(2);
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
});

test('with one view the PDF-per-view export is greyed out and presenting has no pager', async ({
  page,
}) => {
  await openTemplate(page);
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.getByRole('menuitem', { name: /^PDF, una página por vista/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('F5');
  await expect(page.locator('.editor-root.is-presenting')).toHaveCount(1);
  await expect(page.locator('.presentation-nav')).toHaveCount(0);
  await expect(page.locator('.presentation-title span')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.topbar')).toBeVisible();
});
