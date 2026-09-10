import { expect, test } from '@playwright/test';
import { addGroupAt, openNewDiagram } from './helpers';

/**
 * Waits for the edit to reach storage.
 *
 * A snapshot keeps the state already written to disk — that is what makes
 * restoring a way back — so a comparison taken before the autosave lands is
 * comparing against the diagram as it was a second ago.
 */
async function settle(page: import('@playwright/test').Page) {
  const status = page.locator('.topbar .save-status');
  await expect(status).toContainText('Sin guardar');
  await expect(status).toContainText('Guardado');
}

async function openHistory(page: import('@playwright/test').Page) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.palette input').first().fill('historial');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.version-list');
  // A blank canvas is not snapshotted when the first edit lands, so a settled
  // list holds exactly the current state. Waiting for the empty-history note
  // means the next assertion is not racing the panel's own refresh.
  await expect(page.locator('.version-row')).toHaveCount(1);
  await expect(page.getByText('Aún no hay versiones anteriores')).toBeVisible();
}

/**
 * Takes a snapshot and waits for the panel to show it.
 *
 * The list is re-read a beat after the model changes, so clicking "compare"
 * straight away would compare against whatever was newest before.
 */
async function snapshot(page: import('@playwright/test').Page) {
  const rows = await page.locator('.version-row').count();
  await page.getByRole('button', { name: 'Guardar versión' }).click();
  await expect(page.locator('.version-row')).toHaveCount(rows + 1);
}

test('compares a snapshot with where the diagram is now', async ({ page }) => {
  await openNewDiagram(page);
  await addGroupAt(page, 300, 240);
  await page.locator('[data-tool="select"]').click();

  await settle(page);
  await openHistory(page);
  await snapshot(page);

  // Añade algo después de la instantánea.
  await addGroupAt(page, 700, 240);
  await page.locator('[data-tool="select"]').click();
  await settle(page);

  await page.getByRole('button', { name: 'Comparar' }).first().click();
  const list = page.locator('.version-list');
  await expect(list).toContainText('Servicios');
  await expect(list.locator('.diff-row.is-added')).toHaveCount(1);

  // Y el lienzo señala lo que la lista nombra.
  await expect(page.locator('.diff-added')).toHaveCount(1);

  await page.getByRole('button', { name: 'Volver al historial' }).click();
  await expect(page.locator('.diff-added')).toHaveCount(0);
});

test('says plainly when nothing has changed', async ({ page }) => {
  await openNewDiagram(page);
  await addGroupAt(page, 300, 240);
  await page.locator('[data-tool="select"]').click();

  await settle(page);
  await openHistory(page);
  await snapshot(page);
  await page.getByRole('button', { name: 'Comparar' }).first().click();

  await expect(page.locator('.version-list')).toContainText('No ha cambiado nada');
});
