import { expect, test } from '@playwright/test';
import { addGroupAt, openNewDiagram } from './helpers';

/** The item inside a freshly placed group: the shape the DSL calls a node. */
async function selectAnItem(page: import('@playwright/test').Page) {
  await addGroupAt(page, 420, 260);
  await page.locator('[data-tool="select"]').click();
  await page.locator('[data-shape-id^="itm_"]').first().click({ force: true });
  await expect(page.locator('.inspector')).toBeVisible();
}

const codeText = (page: import('@playwright/test').Page) =>
  page.locator('.code-editor .cm-content').innerText();

test.beforeEach(async ({ page }) => {
  await openNewDiagram(page);
});

/** Picks one answer in a chip group: the fixed lists are radios, not selects. */
const choose = (page: import('@playwright/test').Page, group: string, option: string) =>
  page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: option }).click();

test('what a node is reaches the document, and the canvas', async ({ page }) => {
  await selectAnItem(page);
  // "Qué es" opens by default now that its answers are drawn on the card.
  await expect(page.getByLabel('Tecnología')).toBeVisible();

  await page.getByLabel('Tecnología').fill('FastAPI');
  await page.getByLabel('Responsable').fill('payments-platform');
  await choose(page, 'Entorno', 'prod');
  await choose(page, 'Criticidad', 'critical');

  // The card shows what it was told: environment, criticality, technology.
  await expect(page.locator('.canvas-surface [data-badge="environment"]')).toContainText('PROD');
  await expect(page.locator('.canvas-surface [data-badge="criticality"]')).toContainText(
    'CRITICAL',
  );
  await expect(page.locator('.canvas-surface [data-badge="technology"]')).toContainText('FASTAPI');

  await page.keyboard.press('ControlOrMeta+/');
  await expect.poll(() => codeText(page)).toContain('technology: FastAPI');
  await expect.poll(() => codeText(page)).toContain('owner: payments-platform');
  await expect.poll(() => codeText(page)).toContain('environment: prod');
  await expect.poll(() => codeText(page)).toContain('criticality: critical');
});

test('the metadata survives a reload', async ({ page }) => {
  await selectAnItem(page);
  await page.getByLabel('Responsable').fill('payments-platform');
  await expect(page.locator('.topbar .save-status')).toContainText('Guardado');

  await page.reload();
  await page.waitForSelector('.canvas-surface');
  await page.locator('[data-shape-id^="itm_"]').first().click({ force: true });
  await expect(page.getByLabel('Responsable')).toHaveValue('payments-platform');
});
