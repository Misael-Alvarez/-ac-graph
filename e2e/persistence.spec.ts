import { expect, test } from '@playwright/test';
import { addGroupAt, openNewDiagram } from './helpers';

test.beforeEach(async ({ page }) => {
  await openNewDiagram(page);
});

test('confirms autosave and keeps the model and title after reload', async ({ page }) => {
  await addGroupAt(page, 400, 300);
  await page.locator('.topbar-name').fill('Persistence check');
  await expect(page.locator('.topbar .save-status')).toHaveText('Guardado');
  await page.reload();
  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(1);
  await expect(page.locator('.topbar-name')).toHaveValue('Persistence check');
});

test('keeps an edit when navigating away before the debounce, then reopening', async ({ page }) => {
  const url = page.url();
  await addGroupAt(page, 400, 300);
  await expect(page.locator('.topbar .save-status')).toHaveText('Sin guardar');
  await page.locator('.topbar-back').click();
  await expect(page).toHaveURL(/\/$/);
  await page.locator('.library-card-open').click();
  await expect(page).toHaveURL(url);
  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(1);
  await expect(page.locator('.topbar .save-status')).toHaveText('Guardado');
});

test('recovers a journal on immediate reload even if the departing IndexedDB write fails', async ({
  page,
}) => {
  // This patch only lives in the current page. Reload restores normal IDB I/O,
  // so the assertion cannot accidentally pass thanks to the departure flush.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'diagrams') throw new DOMException('Test quota', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await addGroupAt(page, 400, 300);
  await page.reload();
  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(1);
  await expect(page.locator('.topbar .save-status')).toHaveText('Guardado');
  await page.reload();
  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(1);
});

test('never reports saved after a quota failure and retries without requiring another edit', async ({
  page,
}) => {
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'diagrams') {
        IDBObjectStore.prototype.put = put;
        throw new DOMException('Test quota', 'QuotaExceededError');
      }
      return put.call(this, value, key);
    };
  });
  await addGroupAt(page, 400, 300);
  await expect(page.locator('.topbar .save-status')).toHaveText('No se pudo guardar');
  await page.getByRole('button', { name: 'Reintentar guardado' }).click();
  await expect(page.locator('.topbar .save-status')).toHaveText('Guardado');
  await page.reload();
  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(1);
});

test('catches invalid JSON imports, clears selection on a valid import and preserves undo', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await addGroupAt(page, 400, 300);
  await page.locator('.canvas-surface').click({ position: { x: 420, y: 320 } });
  await expect(page.locator('.inspector')).toBeVisible();
  const input = page.locator('input[data-open-project]');
  for (const content of ['{bad json', '{"shapes": false}']) {
    await input.setInputFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: Buffer.from(content),
    });
    await expect(page.locator('.toast')).toHaveText('Ese archivo no es un diagrama válido');
    await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(1);
  }
  await input.setInputFiles({
    name: 'empty.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ canvas: { w: 1600, h: 1200 }, shapes: [], connectors: [] }),
    ),
  });
  await expect(page.locator('.empty-state')).toBeVisible();
  await expect(page.locator('.inspector')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Rehacer', exact: true }).click();
  await expect(page.locator('.empty-state')).toBeVisible();
  expect(errors).toEqual([]);
});

test('catches file read errors without replacing the current model', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await addGroupAt(page, 400, 300);
  await page.evaluate(() => {
    FileReader.prototype.readAsText = function () {
      queueMicrotask(() => this.dispatchEvent(new ProgressEvent('error')));
    };
  });
  await page.locator('input[data-open-project]').setInputFiles({
    name: 'unreadable.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  });
  await expect(page.locator('.toast')).toHaveText('Ese archivo no es un diagrama válido');
  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('snapshots the current unsaved model and restores without a pending autosave undoing it', async ({
  page,
}) => {
  await addGroupAt(page, 300, 250);
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.palette-input').fill('Historial');
  await page.keyboard.press('Enter');
  const panel = page.getByRole('complementary', { name: 'Historial' });
  await panel.getByRole('button', { name: 'Guardar versión' }).click();
  await expect(page.locator('.toast')).toHaveText('Versión guardada');
  await expect(panel.locator('.version-row')).toHaveCount(2);
  await addGroupAt(page, 650, 400);
  await expect(page.locator('.topbar .save-status')).toHaveText('Sin guardar');
  await panel.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(1);
  await expect(page.locator('.topbar .save-status')).toHaveText('Guardado');
  await page.reload();
  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(1);
});

for (const webLocks of [true, false]) {
  test(`a copied session cannot recover or acknowledge a live tab's journal (${webLocks ? 'Web Locks' : 'no Web Locks'})`, async ({
    page,
  }) => {
    const originalSession = await page.evaluate(() =>
      sessionStorage.getItem('ac-graph-draft-session'),
    );
    expect(originalSession).toBeTruthy();
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === 'diagrams') throw new DOMException('Test quota', 'QuotaExceededError');
        return put.call(this, value, key);
      };
    });
    await addGroupAt(page, 400, 300);
    const originalDraft = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((key) => key.startsWith('ac-graph-draft:'))!;
      return { key, value: localStorage.getItem(key) };
    });
    expect(originalDraft.value).toBeTruthy();
    await page.context().addInitScript((enabled) => {
      Reflect.set(window, '__draftSessionAtBoot', sessionStorage.getItem('ac-graph-draft-session'));
      if (!enabled) Object.defineProperty(navigator, 'locks', { value: undefined });
    }, webLocks);
    const popup = page.waitForEvent('popup');
    await page.evaluate((url) => {
      window.open(url, '_blank');
    }, page.url());
    const copied = await popup;
    try {
      await expect(copied.locator('.canvas-surface')).toBeVisible();
      expect(await copied.evaluate(() => Reflect.get(window, '__draftSessionAtBoot'))).toBe(
        originalSession,
      );
      if (webLocks) {
        expect(
          await copied.evaluate(() => sessionStorage.getItem('ac-graph-draft-session')),
        ).not.toBe(originalSession);
      } else {
        // Next also mounts a route announcer with role="alert", so the message
        // is located by its text rather than by role alone.
        await expect(
          copied.getByText('recuperación automática de borradores está desactivada'),
        ).toBeVisible();
      }
      await expect(copied.locator('[data-shape-id^="grp_"]')).toHaveCount(0);
      await addGroupAt(copied, 400, 300);
      await expect(copied.locator('.topbar .save-status')).toHaveText('Guardado');
      expect(await copied.evaluate((key) => localStorage.getItem(key), originalDraft.key)).toBe(
        originalDraft.value,
      );
      expect(await page.evaluate(() => sessionStorage.getItem('ac-graph-draft-session'))).toBe(
        originalSession,
      );
    } finally {
      await copied.close();
    }
    expect(await page.evaluate((key) => localStorage.getItem(key), originalDraft.key)).toBe(
      originalDraft.value,
    );
  });
}
