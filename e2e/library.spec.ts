import { expect, test } from '@playwright/test';
import { resetWorkspace } from './helpers';

test.beforeEach(async ({ page }) => {
  await resetWorkspace(page);
});

test('starts empty and offers a way in', async ({ page }) => {
  await expect(page.locator('.library-start')).toBeVisible();
  await expect(page.getByText('Aquí no hay nada todavía')).toBeVisible();
  // A blank canvas plus one card per template.
  await expect(page.locator('.library-templates .template-card')).toHaveCount(6);
});

test('creates a diagram and returns to the library', async ({ page }) => {
  await page.getByRole('button', { name: 'Nuevo diagrama' }).click();
  await page.locator('.dialog .template-card').filter({ hasText: 'Lienzo en blanco' }).click();
  await expect(page).toHaveURL(/\/d\//);
  await page.waitForSelector('.canvas-surface');

  await page.getByRole('button', { name: 'Todos los diagramas' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.library-card')).toHaveCount(1);
});

test('starting from a template lands with its content', async ({ page }) => {
  await page
    .locator('.library-templates .template-card')
    .filter({ hasText: 'API serverless' })
    .first()
    .click();
  await page.waitForSelector('.canvas-surface');
  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(5);
});

test('renames a diagram and shows the new name in the library', async ({ page }) => {
  await page.getByRole('button', { name: 'Nuevo diagrama' }).click();
  await page.locator('.dialog .template-card').filter({ hasText: 'Lienzo en blanco' }).click();
  await page.waitForSelector('.topbar-name');
  await page.locator('.topbar-name').fill('Pagos');

  await page.getByRole('button', { name: 'Todos los diagramas' }).click();
  await expect(page.locator('.library-card-title')).toContainText('Pagos');
});

test('persists work across a reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Nuevo diagrama' }).click();
  await page.locator('.dialog .template-card').filter({ hasText: 'Lienzo en blanco' }).click();
  await page.waitForSelector('.canvas-surface');
  await page.locator('[data-tool="group"]').click();
  await page.locator('.canvas-surface').click({ position: { x: 400, y: 300 } });

  // The status must admit the change is not written yet, then confirm it is.
  await expect(page.locator('.topbar .save-status')).toContainText('Sin guardar');
  await expect(page.locator('.topbar .save-status')).toContainText('Guardado');

  await page.reload();
  await page.waitForSelector('.canvas-surface');
  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(1);
});

test('duplicates and deletes from the card', async ({ page }) => {
  await page.getByRole('button', { name: 'Nuevo diagrama' }).click();
  await page.locator('.dialog .template-card').filter({ hasText: 'Lienzo en blanco' }).click();
  await page.waitForSelector('.canvas-surface');
  await page.getByRole('button', { name: 'Todos los diagramas' }).click();
  await expect(page.locator('.library-card')).toHaveCount(1);

  await page.locator('.library-card').first().hover();
  await page.getByRole('button', { name: /Duplicar:/ }).click();
  await expect(page.locator('.library-card')).toHaveCount(2);

  await page.locator('.library-card').first().hover();
  await page
    .getByRole('button', { name: /Eliminar:/ })
    .first()
    .click();

  // The confirmation is the app's own dialog now, not the browser's.
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toBeVisible();
  await expect(page.locator('.library-card')).toHaveCount(2);
  await confirmation.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(page.locator('.library-card')).toHaveCount(1);
});

test('cancelling the confirmation keeps the diagram', async ({ page }) => {
  await page.getByRole('button', { name: 'Nuevo diagrama' }).click();
  await page.locator('.dialog .template-card').filter({ hasText: 'Lienzo en blanco' }).click();
  await page.waitForSelector('.canvas-surface');
  await page.getByRole('button', { name: 'Todos los diagramas' }).click();

  await page.locator('.library-card').first().hover();
  await page
    .getByRole('button', { name: /Eliminar:/ })
    .first()
    .click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.locator('.library-card')).toHaveCount(1);
});

test('searches by name', async ({ page }) => {
  await page
    .locator('.library-templates .template-card')
    .filter({ hasText: 'API serverless' })
    .first()
    .click();
  await page.waitForSelector('.canvas-surface');
  await page.getByRole('button', { name: 'Todos los diagramas' }).click();
  await page.getByRole('button', { name: 'Nuevo diagrama' }).click();
  await page.locator('.dialog .template-card').filter({ hasText: 'Lienzo en blanco' }).click();
  await page.waitForSelector('.canvas-surface');
  await page.getByRole('button', { name: 'Todos los diagramas' }).click();

  await expect(page.locator('.library-card')).toHaveCount(2);
  await page.locator('.library-search-input').fill('Serverless');
  await expect(page.locator('.library-card')).toHaveCount(1);
  await page.locator('.library-search-input').fill('nada de esto existe');
  await expect(page.getByText('Ningún diagrama coincide')).toBeVisible();
});

test('exports and re-imports the whole workspace', async ({ page }) => {
  await page
    .locator('.library-templates .template-card')
    .filter({ hasText: 'API serverless' })
    .first()
    .click();
  await page.waitForSelector('.canvas-surface');
  await page.getByRole('button', { name: 'Todos los diagramas' }).click();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar todo' }).click();
  const file = await download;
  const path = await file.path();

  await page.setInputFiles('input[type="file"]', path);
  await expect(page.locator('.library-card')).toHaveCount(2);
});

test('offers a way back when the diagram does not exist', async ({ page }) => {
  await page.goto('/d/does-not-exist');
  await expect(page.getByText('Ese diagrama ya no existe')).toBeVisible();
  await page.getByRole('button', { name: 'Todos los diagramas' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('offers templates even once the library has diagrams', async ({ page }) => {
  await page.getByRole('button', { name: 'Nuevo diagrama' }).click();
  await page.locator('.dialog .template-card').filter({ hasText: 'Lienzo en blanco' }).click();
  await page.waitForSelector('.canvas-surface');
  await page.getByRole('button', { name: 'Todos los diagramas' }).click();

  // The inline start screen is gone now; the picker has to carry the templates.
  await expect(page.locator('.library-start')).toHaveCount(0);
  await page.getByRole('button', { name: 'Nuevo diagrama' }).click();
  await expect(page.locator('.dialog .template-card')).toHaveCount(6);

  await page.locator('.dialog .template-card').filter({ hasText: 'Pipeline de ML' }).click();
  await page.waitForSelector('.canvas-surface');
  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(5);
});
