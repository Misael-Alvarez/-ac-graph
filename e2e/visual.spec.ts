import { expect, test, type Page } from '@playwright/test';

/**
 * Pixel baselines of the product's states.
 *
 * These exist so the stylesheet can be reorganised without fear: a change that
 * moves a single pixel in any of these screens is a change somebody meant to
 * make, or a regression. They run under the `visual` project only — see
 * `npm run test:visual` and `npm run test:visual:update` — because baselines
 * are platform-specific and are accepted by a person, not by CI.
 *
 * Every screenshot is taken with animations disabled and the same data: the
 * Microservices template, which carries an inventory, so chips and tags are in
 * the frame.
 */

const THEMES = [
  ['dark', true],
  ['light', false],
] as const;

async function reset(page: Page, dark: boolean) {
  await page.addInitScript((isDark) => {
    localStorage.clear();
    localStorage.setItem('aion-studio-preferences', JSON.stringify({ dark: isDark }));
  }, dark);
  await page.goto('/');
  await page.evaluate(async () => {
    const databases = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      databases
        .filter((db) => db.name)
        .map(
          (db) =>
            new Promise<void>((resolve) => {
              const request = indexedDB.deleteDatabase(db.name!);
              request.onsuccess = request.onerror = request.onblocked = () => resolve();
            }),
        ),
    );
  });
  await page.reload();
  await page.waitForSelector('.library');
}

async function openShowcase(page: Page) {
  await page.locator('.library-showcase').click();
  await page.waitForSelector('.canvas-surface');
  // Framing and the entrance stagger have settled.
  await page.waitForTimeout(700);
}

/** Text that changes between runs must not be in the frame. */
async function freeze(page: Page) {
  await page.addStyleTag({
    content: `
      .library-footer, .topbar-menu-stamp { visibility: hidden !important; }
      .library-card-meta { visibility: hidden !important; }
      *, *::before, *::after { animation-play-state: paused !important; caret-color: transparent !important; }
    `,
  });
}

for (const [theme, dark] of THEMES) {
  test.describe(`${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await reset(page, dark);
      await freeze(page);
    });

    test('home', async ({ page }) => {
      await page.waitForTimeout(1200);
      await expect(page).toHaveScreenshot(`home-${theme}.png`, { fullPage: true });
    });

    test('editor', async ({ page }) => {
      await openShowcase(page);
      await expect(page).toHaveScreenshot(`editor-${theme}.png`);
    });

    test('inspector for a service', async ({ page }) => {
      await openShowcase(page);
      await page
        .locator('.canvas-surface rect[data-shape-id^="itm_"]')
        .nth(2)
        .click({ position: { x: 30, y: 20 } });
      await page.waitForTimeout(400);
      await expect(page.locator('.inspector')).toHaveScreenshot(`inspector-service-${theme}.png`);
    });

    test('inspector for a connection', async ({ page }) => {
      await openShowcase(page);
      const point = await page.evaluate(() => {
        const g = document.querySelectorAll('.connector')[1];
        const path = g.querySelector<SVGPathElement>('path[stroke="transparent"]')!;
        const p = path.getPointAtLength(path.getTotalLength() * 0.3);
        const s = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!);
        return { x: s.x, y: s.y };
      });
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(400);
      await expect(page.locator('.inspector')).toHaveScreenshot(
        `inspector-connection-${theme}.png`,
      );
    });

    test('service browser', async ({ page }) => {
      await openShowcase(page);
      await page.keyboard.press('ControlOrMeta+b');
      await page.waitForTimeout(500);
      await expect(page.locator('.side-panel.is-left')).toHaveScreenshot(`browser-${theme}.png`);
    });

    test('command palette', async ({ page }) => {
      await openShowcase(page);
      await page.keyboard.press('ControlOrMeta+k');
      await page.waitForTimeout(400);
      await expect(page.locator('.palette')).toHaveScreenshot(`palette-${theme}.png`);
    });

    test('icon picker', async ({ page }) => {
      await openShowcase(page);
      await page
        .locator('.canvas-surface rect[data-shape-id^="itm_"]')
        .nth(2)
        .click({ position: { x: 30, y: 20 } });
      await page.locator('.icon-picker-trigger').click();
      await page.waitForTimeout(500);
      await expect(page.locator('.icon-picker')).toHaveScreenshot(`icon-picker-${theme}.png`);
    });

    test('history panel', async ({ page }) => {
      await openShowcase(page);
      await page.keyboard.press('ControlOrMeta+h');
      await page.waitForTimeout(500);
      await expect(page.locator('.side-panel:not(.is-left)')).toHaveScreenshot(
        `history-${theme}.png`,
      );
    });

    test('analysis panel', async ({ page }) => {
      await openShowcase(page);
      await page.keyboard.press('ControlOrMeta+i');
      await page.waitForTimeout(600);
      await expect(page.locator('.side-panel:not(.is-left)')).toHaveScreenshot(
        `analysis-${theme}.png`,
      );
    });

    test('share dialog', async ({ page }) => {
      await openShowcase(page);
      await page.keyboard.press('ControlOrMeta+Shift+s');
      await page.waitForTimeout(500);
      await freeze(page);
      // The link carries the diagram id; only the frame around it is compared.
      await page.addStyleTag({
        content: '.dialog input, .dialog pre, .dialog textarea { color: transparent !important; }',
      });
      await expect(page.locator('.dialog')).toHaveScreenshot(`share-${theme}.png`);
    });

    test('shortcuts sheet', async ({ page }) => {
      await openShowcase(page);
      await page.locator('.canvas-surface').click({ position: { x: 700, y: 60 } });
      await page.keyboard.press('Shift+?');
      await page.waitForTimeout(400);
      await expect(page.locator('.dialog')).toHaveScreenshot(`shortcuts-${theme}.png`);
    });

    test('account menu', async ({ page }) => {
      await openShowcase(page);
      await page.locator('.topbar .user-button').click();
      await page.waitForTimeout(300);
      await freeze(page);
      await expect(page.locator('.topbar-menu')).toHaveScreenshot(`account-menu-${theme}.png`);
    });
  });
}
