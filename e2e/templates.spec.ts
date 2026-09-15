import { expect, test, type Page } from '@playwright/test';
import { resetWorkspace } from './helpers';

/** Opens the microservices template as a diagram and names it. */
async function openNamed(page: Page, title: string) {
  await resetWorkspace(page);
  await page
    .locator('.library-templates .template-card')
    .filter({ hasText: 'Microservicios' })
    .click();
  await page.waitForSelector('.canvas-surface');
  await page.locator('.topbar-name').fill(title);
  await page.keyboard.press('Enter');
  await expect(page.locator('.topbar .save-status')).toHaveText('Guardado');
}

async function saveAsTemplate(page: Page) {
  await page.locator('.topbar button[aria-label="Más"]').click();
  await page.getByRole('menuitem', { name: 'Guardar como plantilla' }).click();
  await expect(page.locator('.toast')).toContainText('Guardado como punto de partida');
}

const yours = (page: Page) => page.locator('.library-templates .template-card.is-yours');

test('a diagram saved as a template joins the starting points, drawn, and stays out of the diagrams', async ({
  page,
}) => {
  await openNamed(page, 'Mi plantilla');
  await saveAsTemplate(page);

  await page.goto('/');
  await page.waitForSelector('.library-start');
  // One more starting point — after the blank sheet, before the house's.
  await expect(page.locator('.library-templates .template-card')).toHaveCount(7);
  await expect(page.locator('.library-templates .template-card').nth(1)).toHaveClass(/is-yours/);
  const card = yours(page);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Mi plantilla');
  await expect(card).toContainText('Tuya');
  await expect(card).toContainText('7 formas');
  // Drawn for real, as the built-in ones are.
  await expect(card.locator('.template-thumb img')).toHaveAttribute('src', /^data:image\/svg/);
  // The diagram it was saved from is the only diagram; the template is not one.
  await expect(page.locator('.library-grid .library-card')).toHaveCount(1);
  await expect(page.locator('.library-count')).toHaveText('1');

  // Starting from it makes a new diagram with the template's content and name.
  await card.locator('.template-open').click();
  await page.waitForSelector('.canvas-surface');
  await expect(page).toHaveURL(/\/d\//);
  await expect(page.locator('.topbar-name')).toHaveValue('Mi plantilla');
  await expect(page.locator('.canvas-surface [data-shape-id^="grp_"]')).toHaveCount(7);
  await page.goto('/');
  await page.waitForSelector('.library-start');
  await expect(page.locator('.library-grid .library-card')).toHaveCount(2);
  await expect(yours(page)).toHaveCount(1);
});

test('the home\u2019s «Nuevo diagrama» dialog offers a template of one\u2019s own, drawn, under «Tuyas»', async ({
  page,
}) => {
  await openNamed(page, 'Mi plantilla');
  await saveAsTemplate(page);

  await page.goto('/');
  await page.waitForSelector('.library-start');
  await page.getByRole('button', { name: 'Nuevo diagrama' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo diagrama' });
  await expect(dialog).toBeVisible();

  // The blank sheet first, in the grid under «Tuyas» beside theirs; the
  // house's under «Incluidas» — the same cards as the gallery below, a real
  // drawing on each.
  const headings = dialog.locator('.template-group-title');
  await expect(headings).toHaveCount(2);
  await expect(headings.nth(0)).toContainText('Tuyas');
  await expect(headings.nth(1)).toContainText('Incluidas');
  await expect(dialog.locator('.template-card')).toHaveCount(7);
  await expect(dialog.locator('.template-card').first()).toHaveClass(/is-blank/);
  const grids = dialog.locator('.library-templates');
  await expect(grids).toHaveCount(2);
  await expect(grids.nth(0).locator('.template-card')).toHaveCount(2);
  await expect(grids.nth(0).locator('.template-card').first()).toHaveClass(/is-blank/);
  await expect(grids.nth(1).locator('.template-card')).toHaveCount(5);
  const own = dialog.locator('.template-card.is-yours');
  await expect(own).toHaveCount(1);
  await expect(own).toContainText('Mi plantilla');
  await expect(own).toContainText('Tuya');
  await expect(own).toContainText('7 formas');
  await expect(own.locator('.template-thumb img')).toHaveAttribute('src', /^data:image\/svg/);
  await expect(
    dialog.locator('.template-card:not(.is-blank) .template-thumb img[src^="data:image/svg"]'),
  ).toHaveCount(6);

  // Starting from it makes a new diagram with the template's content and name.
  await own.click();
  await page.waitForSelector('.canvas-surface');
  await expect(page).toHaveURL(/\/d\//);
  await expect(page.locator('.topbar-name')).toHaveValue('Mi plantilla');
  await expect(page.locator('.canvas-surface [data-shape-id^="grp_"]')).toHaveCount(7);
  await page.goto('/');
  await page.waitForSelector('.library-start');
  await expect(page.locator('.library-grid .library-card')).toHaveCount(2);
  await expect(yours(page)).toHaveCount(1);
});

test('a template of one\u2019s own can be edited in place, is offered in the editor, and deleted', async ({
  page,
}) => {
  await openNamed(page, 'Base de pagos');
  await saveAsTemplate(page);
  await page.goto('/');
  await page.waitForSelector('.library-start');

  // Edit opens the template itself, not a copy.
  const card = yours(page);
  await card.hover();
  await card.getByRole('button', { name: 'Editar plantilla: Base de pagos' }).click();
  await page.waitForSelector('.canvas-surface');
  const templateUrl = page.url();
  await expect(page.locator('.topbar-name')).toHaveValue('Base de pagos');

  // The editor's own dialog lists it first, under "Tuyas".
  await page.locator('.topbar button[aria-label="Más"]').click();
  await page.getByRole('menuitem', { name: /^Plantillas/ }).click();
  const dialog = page.locator('.dialog');
  await expect(dialog.locator('.template-group-title').first()).toContainText('Tuyas');
  await expect(dialog.locator('.template-card.is-yours')).toHaveCount(1);
  await expect(dialog.locator('.template-card')).toHaveCount(6);
  await page.keyboard.press('Escape');

  // The palette offers the command too.
  await page.locator('.canvas-surface').click({ position: { x: 700, y: 60 } });
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.palette-input').fill('plantilla');
  await expect(page.getByRole('option', { name: 'Guardar como plantilla' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Deleting asks, then the card goes and the diagrams are untouched.
  await page.goto('/');
  await page.waitForSelector('.library-start');
  await yours(page).hover();
  await yours(page).getByRole('button', { name: 'Eliminar: Base de pagos' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Base de pagos');
  await confirm.getByRole('button', { name: 'Eliminar' }).click();
  await expect(yours(page)).toHaveCount(0);
  await expect(page.locator('.library-templates .template-card')).toHaveCount(6);
  await expect(page.locator('.library-grid .library-card')).toHaveCount(1);
  // And its page is gone with it.
  await page.goto(templateUrl);
  await expect(page.locator('body')).toContainText('Ese diagrama ya no existe.');
});
