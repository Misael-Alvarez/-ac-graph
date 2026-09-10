// The tour of the product's states, shared by the style tools.
//
// `tour(browser, base, visit)` walks every screen, panel, menu and dialog in
// both themes (plus hover states and two narrower widths) and calls
// `visit(name, page, rootSelector)` at each one. What a visitor does with a
// state — record computed styles, map selectors to elements — is up to it;
// the list of states lives here so every tool sees the same product.
export async function tour(browser, base, visit) {
  const settle = (page, ms = 500) => page.waitForTimeout(ms);

  async function context(dark, width = 1440) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    await page.addInitScript((d) => {
      localStorage.clear();
      localStorage.setItem('aion-studio-preferences', JSON.stringify({ dark: d }));
    }, dark);
    await page.goto(base + '/');
    await page.evaluate(async () => {
      const dbs = (await indexedDB.databases?.()) ?? [];
      await Promise.all(
        dbs
          .filter((d) => d.name)
          .map(
            (d) =>
              new Promise((r) => {
                const q = indexedDB.deleteDatabase(d.name);
                q.onsuccess = q.onerror = q.onblocked = () => r();
              }),
          ),
      );
    });
    await page.reload();
    await page.waitForSelector('.library');
    return { ctx, page };
  }

  async function openShowcase(page) {
    await page.locator('.library-showcase').click();
    await page.waitForSelector('.canvas-surface');
    await settle(page, 700);
  }

  async function record(name, page, root) {
    await visit(name, page, root ?? 'body');
  }

  async function hovered(name, page, selector) {
    const target = page.locator(selector).first();
    if (!(await target.count())) return;
    await target.hover();
    await settle(page, 350);
    await visit(name, page, selector);
    await page.mouse.move(5, 450);
    await settle(page, 200);
  }

  for (const dark of [true, false]) {
    const t = dark ? 'dark' : 'light';
    console.log(`\n${t}`);
    const { ctx, page } = await context(dark);

    await settle(page, 900);
    await record(`${t}/home`, page);
    await hovered(`${t}/home:hover-template`, page, '.template-card.is-rich');
    await hovered(`${t}/home:hover-showcase`, page, '.library-showcase');
    await hovered(`${t}/home:hover-nav`, page, '.library-nav-link:not(.is-active)');

    await openShowcase(page);
    await record(`${t}/editor`, page);
    await hovered(`${t}/editor:hover-tool`, page, '[data-tool="group"]');
    await hovered(
      `${t}/editor:hover-topbar-button`,
      page,
      '.topbar .icon-button[aria-label="Deshacer"]',
    );
    await hovered(`${t}/editor:hover-primary`, page, '.topbar .button.is-primary');
    await hovered(`${t}/editor:hover-zoom`, page, '.zoom-controls .icon-button');

    await page
      .locator('.canvas-surface rect[data-shape-id^="itm_"]')
      .nth(2)
      .click({ position: { x: 30, y: 20 } });
    await settle(page, 400);
    await record(`${t}/inspector-service`, page, '.inspector');
    await hovered(`${t}/inspector:hover-chip`, page, '.chip-choice:not(.is-active)');
    await hovered(`${t}/inspector:hover-swatch`, page, '.fill-swatch:not(.is-active)');
    await hovered(`${t}/inspector:hover-section`, page, '.inspector-section-header');

    const point = await page.evaluate(() => {
      const g = document.querySelectorAll('.connector')[1];
      const path = g.querySelector('path[stroke="transparent"]');
      const p = path.getPointAtLength(path.getTotalLength() * 0.3);
      const s = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM());
      return { x: s.x, y: s.y };
    });
    await page.mouse.click(point.x, point.y);
    await settle(page, 400);
    await record(`${t}/inspector-connection`, page, '.inspector');
    await page.keyboard.press('Escape');

    await page.keyboard.press('ControlOrMeta+b');
    await settle(page, 500);
    await record(`${t}/browser`, page, '.side-panel.is-left');
    await hovered(`${t}/browser:hover-row`, page, '.browser-tile');
    await hovered(`${t}/browser:hover-tab`, page, '.browser-cloud.chip:not(.is-active)');
    await page.getByRole('tab', { name: /Propios/ }).click();
    await settle(page, 300);
    await record(`${t}/browser-mine`, page, '.side-panel.is-left');
    await page.keyboard.press('ControlOrMeta+b');
    await settle(page, 300);

    await page.keyboard.press('ControlOrMeta+k');
    await settle(page, 400);
    await record(`${t}/palette`, page, '.palette');
    await hovered(`${t}/palette:hover-row`, page, '.palette-row:not(.is-active)');
    await page.keyboard.press('Escape');
    await settle(page, 200);

    await page
      .locator('.canvas-surface rect[data-shape-id^="itm_"]')
      .nth(2)
      .click({ position: { x: 30, y: 20 } });
    await settle(page, 300);
    await page.locator('.icon-picker-trigger').click();
    await settle(page, 500);
    await record(`${t}/icon-picker`, page, '.icon-picker');
    await hovered(`${t}/icon-picker:hover-tile`, page, '.icon-picker-tile:not(.is-current)');
    await page.keyboard.press('Escape');
    await settle(page, 200);

    await page.keyboard.press('ControlOrMeta+h');
    await settle(page, 500);
    await record(`${t}/history`, page, '.side-panel:not(.is-left)');
    await page.keyboard.press('ControlOrMeta+h');
    await settle(page, 200);

    await page.keyboard.press('ControlOrMeta+i');
    await settle(page, 600);
    await record(`${t}/analysis`, page, '.side-panel:not(.is-left)');
    await hovered(`${t}/analysis:hover-row`, page, '.insight-row');
    await page.keyboard.press('ControlOrMeta+i');
    await settle(page, 200);

    await page.keyboard.press('ControlOrMeta+/');
    await settle(page, 600);
    await record(`${t}/code`, page, '.code-panel');
    await page.keyboard.press('ControlOrMeta+/');
    await settle(page, 200);

    await page.keyboard.press('ControlOrMeta+Shift+s');
    await settle(page, 500);
    await record(`${t}/share`, page, '.dialog');
    await page.keyboard.press('Escape');
    await settle(page, 200);

    await page.locator('.canvas-surface').click({ position: { x: 700, y: 60 } });
    await page.keyboard.press('Shift+?');
    await settle(page, 400);
    await record(`${t}/shortcuts`, page, '.dialog');
    await page.keyboard.press('Escape');
    await settle(page, 200);

    await page.locator('.topbar .icon-button[aria-label="Más"]').click();
    await settle(page, 300);
    await record(`${t}/more-menu`, page, '.topbar-menu');
    await hovered(`${t}/more-menu:hover-item`, page, '.topbar-menu-item');
    await page.keyboard.press('Escape');
    await settle(page, 200);

    await page.locator('.topbar .user-button').click();
    await settle(page, 300);
    await record(`${t}/account-menu`, page, '.topbar-menu');
    await page.keyboard.press('Escape');
    await settle(page, 200);

    await page.locator('.topbar button[aria-label="Exportar"]').click();
    await settle(page, 300);
    await record(`${t}/export-menu`, page, '.topbar-menu');
    await page.keyboard.press('Escape');
    await settle(page, 200);

    const g = await page
      .locator('.canvas-surface rect[data-shape-id^="grp_"]')
      .first()
      .boundingBox();
    await page.mouse.click(g.x + 30, g.y + 12, { button: 'right' });
    await settle(page, 300);
    await record(`${t}/context-menu`, page, '.context-menu');
    await page.keyboard.press('Escape');
    await settle(page, 200);

    await page.keyboard.press('ControlOrMeta+a');
    await settle(page, 400);
    await record(`${t}/selection-toolbar`, page, '.selection-toolbar');
    await page.keyboard.press('Escape');

    await page.keyboard.press('ControlOrMeta+f');
    await settle(page, 300);
    await record(`${t}/find-bar`, page, '.find-bar');
    await page.keyboard.press('Escape');

    await page.keyboard.press('ControlOrMeta+j');
    await settle(page, 400);
    await record(`${t}/ai-dialog`, page, '.dialog');
    await page.keyboard.press('Escape');

    // Keyboard focus rings: Tab from the canvas lands on the chrome.
    await page.locator('.canvas-surface').click({ position: { x: 700, y: 60 } });
    await page.keyboard.press('Tab');
    await settle(page, 200);
    await record(`${t}/focus-visible`, page);

    // A tooltip of the app's own, resting on a top bar control.
    await page.locator('.topbar .icon-button[aria-label="Deshacer"]').hover();
    await settle(page, 700);
    await record(`${t}/tooltip`, page);
    await page.mouse.move(5, 450);

    // Nothing to undo: the toast.
    await page.keyboard.press('ControlOrMeta+z');
    await settle(page, 300);
    await record(`${t}/toast`, page);
    await settle(page, 1200);

    // A group and a boundary in the inspector, and the position section open.
    await page
      .locator('.canvas-surface rect[data-shape-id^="grp_"]')
      .first()
      .click({ position: { x: 30, y: 12 } });
    await settle(page, 300);
    await page.getByRole('button', { name: /Posición/ }).click();
    await settle(page, 300);
    await record(`${t}/inspector-group`, page);
    await page.locator('[data-tool="boundary"]').click();
    await page.locator('.canvas-surface').click({ position: { x: 200, y: 700 } });
    await settle(page, 300);
    await page
      .locator('.canvas-surface rect[data-shape-id^="bd_"]')
      .first()
      .click({ position: { x: 20, y: 10 } });
    await settle(page, 300);
    await record(`${t}/inspector-boundary`, page);
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('Escape');

    // Drilling into a group: the breadcrumb.
    await page.locator('[data-tool="item"]').click();
    await page
      .locator('.canvas-surface rect[data-shape-id^="grp_"]')
      .first()
      .click({ position: { x: 30, y: 12 } });
    await page.locator('[data-tool="select"]').click();
    const group = await page
      .locator('.canvas-surface rect[data-shape-id^="grp_"]')
      .first()
      .boundingBox();
    await page.mouse.dblclick(group.x + 30, group.y + 12);
    await settle(page, 700);
    await record(`${t}/drilled`, page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+z');
    await settle(page, 300);

    // A second view: the view bar as a tab strip, and its input.
    await page.locator('.view-bar .chip').first().click();
    await settle(page, 200);
    await record(`${t}/view-input`, page);
    await page.locator('.view-bar-input').fill('Seguridad');
    await page.keyboard.press('Enter');
    await settle(page, 400);
    await record(`${t}/views`, page);
    await hovered(`${t}/views:hover-tab`, page, '.view-bar [role="tab"]:not(.is-active)');

    // Dialogs from the More menu.
    for (const [label, state] of [
      ['Plantillas', 'templates-dialog'],
      ['Cambiar de nube', 'switch-cloud-dialog'],
      ['Importar desde Markdown', 'import-dialog'],
      ['Mis iconos', 'icons-dialog'],
    ]) {
      await page.locator('.topbar .icon-button[aria-label="Más"]').click();
      await settle(page, 200);
      await page.getByRole('menuitem', { name: new RegExp(label) }).click();
      await settle(page, 400);
      await record(`${t}/${state}`, page);
      if (state === 'icons-dialog') {
        await page.getByRole('button', { name: /Subir un icono/ }).click();
        await settle(page, 300);
        await record(`${t}/icons-upload`, page);
      }
      await page.keyboard.press('Escape');
      await settle(page, 200);
    }

    // The upload form and the author's tab inside the picker.
    await page
      .locator('.canvas-surface rect[data-shape-id^="itm_"]')
      .nth(2)
      .click({ position: { x: 30, y: 20 } });
    await settle(page, 300);
    await page.locator('.icon-picker-trigger').click();
    await settle(page, 400);
    await page.getByRole('tab', { name: /Propios/ }).click();
    await settle(page, 300);
    await record(`${t}/icon-picker-mine`, page);
    await page.keyboard.press('Escape');

    // The library with a diagram in it, its card and the dialogs around it.
    await page.goto(base + '/');
    await page.waitForSelector('.library');
    await settle(page, 700);
    await record(`${t}/library-cards`, page);
    await hovered(`${t}/library:hover-card`, page, '.library-card');
    await page
      .locator('.library-card .icon-button[aria-label^="Eliminar"]')
      .first()
      .click({ force: true });
    await settle(page, 300);
    await record(`${t}/confirm-dialog`, page);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Nuevo diagrama' }).click();
    await settle(page, 400);
    await record(`${t}/new-dialog`, page);
    await page.locator('.dialog .template-card').filter({ hasText: 'Lienzo en blanco' }).click();
    await page.waitForSelector('.canvas-surface');
    await settle(page, 700);
    await record(`${t}/empty-canvas`, page);
    await hovered(`${t}/empty:hover-action`, page, '.empty-state-action');

    // An icon of the author's own, in the browser's tab and the picker's.
    await page.goto(base + '/');
    await page.waitForSelector('.library');
    await openShowcase(page);
    await page.keyboard.press('ControlOrMeta+b');
    await settle(page, 400);
    await page.getByRole('tab', { name: /Propios/ }).click();
    await page.locator('.browser-tile.is-upload').click();
    await settle(page, 200);
    await page.locator('.icon-upload-drop input[type=file]').setInputFiles({
      name: 'tour.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#f46800"/></svg>',
      ),
    });
    await page.getByLabel('Nombre').fill('Tour');
    await page.getByRole('button', { name: /Guardar y usar/ }).click();
    await settle(page, 500);
    await record(`${t}/browser-mine-with-icon`, page);
    await hovered(`${t}/browser:hover-mine-row`, page, '.browser-mine-row');
    await page.keyboard.press('ControlOrMeta+b');
    await settle(page, 200);
    await page
      .locator('.canvas-surface rect[data-shape-id^="itm_"]')
      .last()
      .click({ position: { x: 30, y: 20 } });
    await settle(page, 300);
    await page.locator('.icon-picker-trigger').click();
    await settle(page, 400);
    await page.getByRole('tab', { name: /Propios/ }).click();
    await settle(page, 300);
    await record(`${t}/icon-picker-mine-with-icon`, page);
    await hovered(`${t}/icon-picker:hover-mine-cell`, page, '.icon-picker-mine-cell');
    await page.keyboard.press('Escape');

    // History: a saved version, then compare it with the present.
    await page.keyboard.press('ControlOrMeta+h');
    await settle(page, 400);
    await page.getByRole('button', { name: 'Guardar versión' }).click();
    await settle(page, 600);
    await page.locator('[data-tool="group"]').click();
    await page.locator('.canvas-surface').click({ position: { x: 300, y: 720 } });
    await settle(page, 600);
    // The autosave has to have landed, or the status text (and the width of
    // everything beside it) depends on when the snapshot fires.
    await page.waitForSelector('.topbar .save-status.is-saved', { timeout: 8000 }).catch(() => {});
    const compare = page.getByRole('button', { name: /^Comparar/ }).first();
    if (await compare.count()) {
      await compare.click();
      await settle(page, 500);
      await record(`${t}/history-compare`, page);
      await page.getByRole('button', { name: /Volver al historial/ }).click();
    }
    await settle(page, 300);
    await record(`${t}/history-with-version`, page);
    await page.keyboard.press('ControlOrMeta+h');

    // The shared, read-only view.
    await page.keyboard.press('ControlOrMeta+Shift+s');
    await settle(page, 400);
    const link = await page.locator('.dialog input').first().inputValue();
    await page.keyboard.press('Escape');
    if (link.startsWith('http')) {
      await page.goto(link);
      await page
        .waitForSelector('.shared-surface, .shared-root', { timeout: 10000 })
        .catch(() => {});
      await settle(page, 700);
      await record(`${t}/shared`, page);
    }

    // A different tone, on the editor.
    await page.evaluate(() => {
      const prefs = JSON.parse(localStorage.getItem('aion-studio-preferences') || '{}');
      localStorage.setItem(
        'aion-studio-preferences',
        JSON.stringify({ ...prefs, accent: 'ocean' }),
      );
    });
    await page.goto(base + '/');
    await page.waitForSelector('.library');
    await openShowcase(page);
    await page
      .locator('.canvas-surface rect[data-shape-id^="itm_"]')
      .nth(2)
      .click({ position: { x: 30, y: 20 } });
    await settle(page, 300);
    await record(`${t}/editor-tone-ocean`, page);
    await page.evaluate(() => {
      const prefs = JSON.parse(localStorage.getItem('aion-studio-preferences') || '{}');
      delete prefs.accent;
      localStorage.setItem('aion-studio-preferences', JSON.stringify(prefs));
    });

    await page.goto(base + '/no-such-page');
    await settle(page, 500);
    await record(`${t}/not-found`, page);

    await ctx.close();

    for (const width of [1100, 820]) {
      const narrow = await context(dark, width);
      await settle(narrow.page, 600);
      await record(`${t}/home@${width}`, narrow.page);
      await openShowcase(narrow.page);
      await record(`${t}/editor@${width}`, narrow.page);
      await narrow.ctx.close();
    }
  }
}
