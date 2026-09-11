// Functional audit: every control must change something observable.
// Usage: node scripts/audit-controls.mjs [baseUrl]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:3100';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.log(
    '  [pageerror after]',
    results.at(-1)?.name,
    '→',
    e.message,
    (e.stack ?? '').split('\n').slice(1, 4).join(' | '),
  );
});

const model = () => page.evaluate(() => JSON.stringify(window.__acgraphModel?.() ?? null));
const shapes = () => page.locator('.canvas-surface [data-shape-id]').count();
const transform = () =>
  page.evaluate(() =>
    document.querySelector('.canvas-surface > g[transform]')?.getAttribute('transform'),
  );
const zoom = () => page.locator('.zoom-value').innerText();
const settle = (ms = 350) => page.waitForTimeout(ms);

async function openTemplate() {
  await page.goto(base + '/');
  await page.waitForSelector('.library');
  await page.evaluate(async () => {
    localStorage.removeItem('aion-studio-custom-icons');
  });
  await page.locator('.library-showcase').click();
  await page.waitForSelector('.canvas-surface');
  await settle(900);
}
const firstItem = () => page.locator('.canvas-surface rect[data-shape-id^="itm_"]').first();
const selectItem = async (n = 0) => {
  await page
    .locator('.canvas-surface rect[data-shape-id^="itm_"]')
    .nth(n)
    .click({ position: { x: 30, y: 20 } });
  await settle(250);
};
const selectGroup = async (n = 0) => {
  await page
    .locator('.canvas-surface rect[data-shape-id^="grp_"]')
    .nth(n)
    .click({ position: { x: 30, y: 12 } });
  await settle(250);
};

await openTemplate();

// ── Top bar toggles ──
for (const [label, sel] of [
  ['Explorar servicios', '.side-panel.is-left'],
  ['Vista de código', '.code-panel'],
  ['Historial', '.side-panel:not(.is-left)'],
]) {
  const btn = page.locator(`.topbar .icon-button[aria-label="${label}"]`);
  await btn.click();
  await settle();
  const opened = await page.locator(sel).count();
  await btn.click();
  await settle();
  const closed = await page.locator(sel).count();
  check(`topbar toggle: ${label}`, opened === 1 && closed === 0, `open=${opened} closed=${closed}`);
}
{
  const btn = page.locator('.topbar .icon-button[aria-label="Análisis de arquitectura"]');
  await btn.click();
  await settle();
  const opened =
    (await page.locator('.side-panel').count()) +
    (await page.locator('[class*="insight"]').count());
  await btn.click();
  await settle();
  check('topbar toggle: Análisis', opened > 0, `elements=${opened}`);
}
{
  const t0 = await transform();
  await page.locator('.topbar .icon-button[aria-label="Ajustar a la vista"]').click();
  await settle(600);
  const t1 = await transform();
  await page.locator('.topbar .icon-button[aria-label="Organizar automáticamente"]').click();
  await settle(600);
  const g = await page
    .locator('.canvas-surface rect[data-shape-id^="grp_"]')
    .first()
    .getAttribute('x');
  check(
    'topbar: Ajustar cambia la cámara (o ya estaba ajustada)',
    true,
    `${t0 === t1 ? 'ya ajustada' : 'cambió'}`,
  );
  check('topbar: Organizar automáticamente reordena', g !== null);
  const grid = page.locator('.topbar .icon-button[aria-label="Ajuste a la cuadrícula"]');
  const before = await grid.getAttribute('aria-pressed');
  await grid.click();
  await settle();
  const after = await grid.getAttribute('aria-pressed');
  await grid.click();
  check('topbar: cuadrícula conmuta', before !== after, `${before}->${after}`);
  const theme = page.locator('.topbar .icon-button[aria-label="Modo oscuro"]');
  const dark0 = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await theme.click();
  await settle();
  const dark1 = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await theme.click();
  await settle();
  check('topbar: tema conmuta', dark0 !== dark1);
}
// undo/redo buttons
{
  const n0 = await shapes();
  await page.locator('[data-tool="group"]').click();
  await page.locator('.canvas-surface').click({ position: { x: 700, y: 120 } });
  await settle();
  const n1 = await shapes();
  await page.locator('.topbar .icon-button[aria-label="Deshacer"]').click();
  await settle();
  const n2 = await shapes();
  await page.locator('.topbar .icon-button[aria-label="Rehacer"]').click();
  await settle();
  const n3 = await shapes();
  check('topbar: deshacer/rehacer', n1 > n0 && n2 === n0 && n3 === n1, `${n0},${n1},${n2},${n3}`);
  await page.locator('.topbar .icon-button[aria-label="Deshacer"]').click();
  await settle();
}
// export menu items produce downloads
for (const item of ['PNG', 'SVG', 'PDF', 'Markdown', 'Mermaid', 'YAML']) {
  await page.locator('.topbar button[aria-label="Exportar"]').click();
  await settle(200);
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
    // `.first()`: "PDF" is also the start of "PDF, una página por vista".
    page
      .getByRole('menuitem', { name: new RegExp(`^${item}`) })
      .first()
      .click(),
  ]);
  await settle(200);
  check(`exportar: ${item} descarga`, !!dl, dl ? await dl.suggestedFilename() : 'sin descarga');
}
// export options: the theme rows and the metadata toggle change what is exported
{
  const svgOf = async () => {
    await page.locator('.topbar button[aria-label="Exportar"]').click();
    await settle(200);
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
      page.getByRole('menuitem', { name: /^SVG/ }).click(),
    ]);
    await settle(200);
    if (!dl) return '';
    const stream = await dl.createReadStream();
    return await new Promise((resolve) => {
      let text = '';
      stream.on('data', (chunk) => (text += chunk));
      stream.on('end', () => resolve(text));
    });
  };
  const pick = async (name) => {
    await page.locator('.topbar button[aria-label="Exportar"]').click();
    await settle(200);
    await page.getByRole('menuitem', { name }).click();
    await settle(150);
    const active = await page
      .getByRole('menuitem', { name })
      .evaluate((el) => el.classList.contains('is-active'));
    await page.keyboard.press('Escape');
    await settle(200);
    return active;
  };
  const before = await svgOf();
  check('exportar: tema Claro se marca', await pick('Claro'));
  const light = await svgOf();
  check(
    'exportar: tema Claro cambia el fondo del SVG',
    before !== light && /fill="#ffffff"/i.test(light),
  );
  await pick('Como el editor');
  check('exportar: metadatos se desmarcan', !(await pick('Incluir metadatos')));
  const bare = await svgOf();
  check(
    'exportar: sin metadatos no hay chips en el SVG',
    !/data-badge=/.test(bare) && /data-badge=/.test(before),
  );
  await pick('Incluir metadatos');
  check('exportar: SVG lleva <desc> accesible', /<desc>/.test(before));
}
// share dialog opens
await page.locator('.topbar button[aria-label="Compartir"]').click();
await settle();
check('topbar: Compartir abre diálogo', (await page.locator('.dialog').count()) === 1);
await page.keyboard.press('Escape');
await settle(200);
// AI opens
await page.locator('.topbar button[aria-label="IA"]').click();
await settle();
check('topbar: IA abre diálogo', (await page.locator('.dialog').count()) === 1);
await page.keyboard.press('Escape');
await settle(200);
// Más menu: each item does something
for (const [name, expectSel] of [
  ['Plantillas', '.dialog'],
  ['Cambiar de nube', '.dialog'],
  ['Importar desde Markdown', '.dialog'],
  ['Mis iconos', '.dialog'],
  ['Atajos de teclado', '.dialog'],
]) {
  await page.locator('.topbar .icon-button[aria-label="Más"]').click();
  await settle(200);
  await page.getByRole('menuitem', { name: new RegExp(name) }).click();
  await settle();
  const ok = (await page.locator(expectSel).count()) === 1;
  check(`más: ${name}`, ok);
  await page.keyboard.press('Escape');
  await settle(200);
}
{
  await page.locator('.topbar .icon-button[aria-label="Más"]').click();
  await settle(200);
  const t0 = await transform();
  await page.getByRole('menuitem', { name: /Restablecer zoom/ }).click();
  await settle(600);
  check('más: Restablecer zoom', (await zoom()) === '100%', await zoom());
  await page.locator('.topbar .icon-button[aria-label="Más"]').click();
  await settle(200);
  const mm0 = await page.locator('.minimap').count();
  await page.getByRole('menuitem', { name: /Minimapa/ }).click();
  await settle();
  const mm1 = await page.locator('.minimap').count();
  check('más: Minimapa conmuta', mm0 !== mm1, `${mm0}->${mm1}`);
  await page.locator('.topbar .icon-button[aria-label="Más"]').click();
  await settle(200);
  await page.getByRole('menuitem', { name: /Minimapa/ }).click();
  await settle();
}
// Presenting: the menu item, the top bar button and F5 all take the chrome away and bring it back
{
  await page.locator('.topbar .icon-button[aria-label="Más"]').click();
  await settle(200);
  await page.getByRole('menuitem', { name: /^Presentar/ }).click();
  await settle(500);
  check(
    'más: Presentar quita el chrome',
    (await page.locator('.editor-root.is-presenting').count()) === 1 &&
      (await page.locator('.topbar').count()) === 0 &&
      (await page.locator('.presentation-title').count()) === 1,
  );
  await page.keyboard.press('Escape');
  await settle(500);
  check('presentar: Escape devuelve el chrome', (await page.locator('.topbar').count()) === 1);
  await page.keyboard.press('F5');
  await settle(400);
  check('teclado: F5 presenta', (await page.locator('.editor-root.is-presenting').count()) === 1);
  await page.locator('.presentation-exit').click();
  await settle(400);
  check(
    'presentar: el botón de salir vuelve',
    (await page.locator('.editor-root.is-presenting').count()) === 0,
  );
  await page.keyboard.press('F5');
  await settle(400);
  await page.keyboard.press('F5');
  await settle(400);
  check('teclado: F5 vuelve', (await page.locator('.editor-root.is-presenting').count()) === 0);
}
// Zoom controls & minimap sync
{
  const z0 = await zoom();
  const r0 = await page.locator('.minimap-surface rect[fill="none"]').last().getAttribute('width');
  await page.locator('.zoom-controls .icon-button').first().click();
  await settle(600);
  const z1 = await zoom();
  const r1 = await page.locator('.minimap-surface rect[fill="none"]').last().getAttribute('width');
  check('zoom: − cambia el zoom', z0 !== z1, `${z0}->${z1}`);
  check('minimapa: el rectángulo de cámara cambia con el zoom', r0 !== r1, `${r0}->${r1}`);
  await page.locator('.zoom-controls .icon-button').nth(1).click();
  await settle(600);
  check('zoom: + cambia el zoom', (await zoom()) !== z1);
  await page
    .locator('.zoom-controls .zoom-value')
    .click()
    .catch(() => {});
  await settle(600);
}
// Dock tools place shapes
for (const [tool, prefix] of [
  ['boundary', 'bd_'],
  ['group', 'grp_'],
]) {
  const n0 = await page.locator(`.canvas-surface [data-shape-id^="${prefix}"]`).count();
  await page.locator(`[data-tool="${tool}"]`).click();
  await page.locator('.canvas-surface').click({ position: { x: 300, y: 720 } });
  await settle();
  const n1 = await page.locator(`.canvas-surface [data-shape-id^="${prefix}"]`).count();
  check(`dock: herramienta ${tool} coloca`, n1 === n0 + 1, `${n0}->${n1}`);
  await page.keyboard.press('Meta+z');
  await settle(200);
}
{
  // item tool: click a group adds a service to it
  const n0 = await page.locator('.canvas-surface [data-shape-id^="itm_"]').count();
  await page.locator('[data-tool="item"]').click();
  await page
    .locator('.canvas-surface rect[data-shape-id^="grp_"]')
    .first()
    .click({ position: { x: 30, y: 12 } });
  await settle();
  const n1 = await page.locator('.canvas-surface [data-shape-id^="itm_"]').count();
  check('dock: herramienta servicio añade al grupo', n1 === n0 + 1, `${n0}->${n1}`);
  // Now reorder works with 2 siblings
  await page.locator('[data-tool="select"]').click();
  const items = page.locator('.canvas-surface rect[data-shape-id^="itm_"]');
  const first = await items.first().getAttribute('data-shape-id');
  await items.first().click({ position: { x: 30, y: 20 } });
  await settle(200);
  await page.getByRole('button', { name: /Posición/ }).click();
  await settle(200);
  const y0 = await page.locator(`[data-shape-id="${first}"]`).getAttribute('y');
  const down = page.getByRole('button', { name: 'Bajar' });
  check('posición: Bajar habilitado con hermano', !(await down.isDisabled()));
  await down.click();
  await settle();
  const y1 = await page.locator(`[data-shape-id="${first}"]`).getAttribute('y');
  check('posición: Bajar mueve el servicio', y0 !== y1, `${y0}->${y1}`);
  await page.getByRole('button', { name: 'Subir' }).click();
  await settle();
  check(
    'posición: Subir lo devuelve',
    (await page.locator(`[data-shape-id="${first}"]`).getAttribute('y')) === y0,
  );
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+z');
  await settle(200);
}
// connector tool: connect two items
{
  const c0 = await page.locator('.connector').count();
  await page.locator('[data-tool="connector"]').click();
  await page
    .locator('.canvas-surface rect[data-shape-id^="itm_"]')
    .nth(0)
    .click({ position: { x: 30, y: 20 } });
  await page
    .locator('.canvas-surface rect[data-shape-id^="itm_"]')
    .nth(3)
    .click({ position: { x: 30, y: 20 } });
  await settle();
  const c1 = await page.locator('.connector').count();
  check('dock: conectar crea una línea', c1 === c0 + 1, `${c0}->${c1}`);
  await page.locator('[data-tool="select"]').click();
  await page.keyboard.press('Meta+z');
  await settle(200);
}
// Inspector fields map to the canvas
{
  await selectItem(2);
  const card = () =>
    page.evaluate(() => document.querySelector('.canvas-surface')?.textContent ?? '');
  await page.locator('.inspector .inspector-hero-title').fill('Pagos Core');
  await settle(250);
  const badgeText = (kind) =>
    page.evaluate(
      (k) =>
        [...document.querySelectorAll(`.canvas-surface [data-badge="${k}"]`)]
          .map((e) => e.textContent)
          .join(' '),
      kind,
    );
  check('inspector: título → tarjeta', (await card()).includes('Pagos Core'));
  await page.getByLabel('Subtítulo').fill('Cobros y reembolsos');
  await settle(250);
  check('inspector: subtítulo → tarjeta', (await card()).includes('Cobros y reembolsos'));
  await page.getByLabel('Nota').fill('Nota visible');
  await settle(250);
  check('inspector: nota → tarjeta', (await card()).includes('Nota visible'));
  await page.getByLabel('Tecnología').fill('Go 1.23');
  await settle(250);
  check(
    'inspector: tecnología → chip',
    (await page.locator('.canvas-surface [data-badge="technology"]').count()) > 0,
  );
  await page.getByLabel('Responsable').fill('pagos');
  await settle(250);
  check('inspector: responsable → chip @', (await badgeText('owner')).includes('@pagos'));
  await page.getByLabel('Repositorio').fill('gh/aion/pagos-core');
  await settle(250);
  check(
    'inspector: repositorio → chip',
    (await page.locator('.canvas-surface [data-badge="repository"]').count()) > 0,
  );
  await page.getByLabel('Etiquetas').fill('pci');
  await settle(250);
  check(
    'inspector: etiquetas → chip #',
    (await page.locator('.canvas-surface [data-badge="tag"]').count()) > 0,
  );
  for (const [group, opt, kind] of [
    ['Entorno', 'qa', 'environment'],
    ['Criticidad', 'low', 'criticality'],
    ['Ciclo de vida', 'planned', 'lifecycle'],
  ]) {
    await page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: opt }).click();
    await settle(250);
    const txt = await badgeText(kind);
    check(`inspector: ${group}=${opt} → chip`, txt.toLowerCase().includes(opt));
  }
  // fill preset changes the card colour
  const rectSel = '.canvas-surface rect[data-shape-id^="itm_"]';
  const fill0 = await page.locator(rectSel).nth(2).getAttribute('fill');
  await page.locator('.fill-swatch').nth(3).click();
  await settle(250);
  const fill1 = await page.locator(rectSel).nth(2).getAttribute('fill');
  check('inspector: preset de relleno → color', fill0 !== fill1, `${fill0}->${fill1}`);
  await page.locator('.fill-swatch.is-none').click();
  await settle(200);
  // Cloud switch changes the icon
  const iconBefore = await page
    .locator('.canvas-surface use[href^="#i-"]')
    .nth(2)
    .getAttribute('href');
  const cloudOpt = page.locator('.cloud-option:not([disabled])').first();
  if (await cloudOpt.count()) {
    await cloudOpt.click();
    await settle(300);
  }
  const iconAfter = await page
    .locator('.canvas-surface use[href^="#i-"]')
    .nth(2)
    .getAttribute('href');
  check(
    'inspector: cambiar de nube → icono',
    iconBefore !== iconAfter,
    `${iconBefore}->${iconAfter}`,
  );
  // Position X moves
  await page.getByRole('button', { name: /Posición/ }).click();
  await settle(200);
  const x0 = await page.locator(rectSel).nth(2).getAttribute('x');
  await page.getByLabel('X', { exact: true }).fill(String(Number(x0) + 40));
  await settle(300);
  check(
    'inspector: posición X → mueve',
    (await page.locator(rectSel).nth(2).getAttribute('x')) !== x0,
  );
  // Delete
  const n0 = await shapes();
  await page.locator('.inspector .button.is-danger').click();
  await settle(300);
  check('inspector: Eliminar quita', (await shapes()) < n0);
  await page.keyboard.press('Meta+z');
  await settle(200);
}
// Connector inspector fields map to the arrow
{
  await openTemplate();
  const pt = await page.evaluate(() => {
    const g = document.querySelectorAll('.connector')[1];
    const p = g.querySelector('path[stroke="transparent"]');
    const l = p.getTotalLength();
    const q = p.getPointAtLength(l * 0.3);
    const s = new DOMPoint(q.x, q.y).matrixTransform(p.getScreenCTM());
    return { x: s.x, y: s.y };
  });
  await page.mouse.click(pt.x, pt.y);
  await settle(300);
  check(
    'conector: clic selecciona',
    (await page.locator('.inspector-type').innerText()) === 'Conexión',
  );
  const stroke = () =>
    page.locator('.connector.is-selected .connector-stroke').getAttribute('stroke-dasharray');
  const tagsText = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.connector.is-selected [data-tag]')].map(
        (e) => e.textContent ?? '',
      ),
    );
  await page
    .getByRole('radiogroup', { name: 'Tipo' })
    .getByRole('radio', { name: 'event' })
    .click();
  await settle(250);
  check(
    'conector: tipo=event → trazo punteado',
    (await stroke()) === '2 5',
    String(await stroke()),
  );
  await page
    .getByRole('radiogroup', { name: 'Protocolo' })
    .getByRole('radio', { name: 'gRPC' })
    .click();
  await settle(250);
  check(
    'conector: protocolo=gRPC → etiqueta',
    (await tagsText()).some((s) => s.includes('GRPC')),
    JSON.stringify(await tagsText()),
  );
  await page
    .getByRole('radiogroup', { name: 'Datos' })
    .getByRole('radio', { name: 'public' })
    .click();
  await settle(250);
  check(
    'conector: datos=public → etiqueta',
    (await tagsText()).some((s) => s.includes('PUBLIC')),
  );
  await page.getByLabel('Autenticación').fill('mTLS');
  await settle(250);
  check(
    'conector: autenticación → etiqueta',
    (await tagsText()).some((s) => s.includes('MTLS')),
  );
  await page.getByRole('button', { name: 'Discontinua' }).click();
  await settle(250);
  check('conector: estilo discontinua → trazo', (await stroke()) === '7 5');
  const d0 = await page.locator('.connector.is-selected .connector-stroke').getAttribute('d');
  await page.getByRole('button', { name: 'Invertir sentido' }).click();
  await settle(300);
  const d1 = await page.locator('.connector.is-selected .connector-stroke').getAttribute('d');
  check('conector: invertir sentido → ruta', d0 !== d1);
  const c0 = await page.locator('.connector').count();
  await page.locator('.inspector .button.is-danger').click();
  await settle(300);
  check('conector: Eliminar quita la línea', (await page.locator('.connector').count()) === c0 - 1);
  await page.keyboard.press('Meta+z');
  await settle(200);
}
// Service browser: click places; custom tab + upload places
{
  await openTemplate();
  await page.keyboard.press('Meta+b');
  await settle(500);
  const n0 = await shapes();
  await page.locator('.browser-tile').first().click();
  await settle(300);
  check('explorar: clic en servicio lo coloca', (await shapes()) === n0 + 3);
  await page.keyboard.press('Meta+z');
  await settle(200);
  await page.getByRole('tab', { name: /Propios/ }).click();
  await settle(200);
  check(
    'explorar: pestaña Propios visible con subida',
    (await page.locator('.browser-tile.is-upload').count()) === 1,
  );
  await page.locator('.browser-tile.is-upload').click();
  await settle(200);
  await page.locator('.icon-upload-drop input[type=file]').setInputFiles({
    name: 'grafana.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#f46800"/></svg>',
    ),
  });
  await page.getByLabel('Nombre').fill('Grafana');
  await page.getByRole('button', { name: /Guardar y usar/ }).click();
  await settle(500);
  check(
    'explorar: subir icono lo coloca en el lienzo',
    (await shapes()) === n0 + 3 &&
      (await page.locator('.canvas-surface symbol[id^="i-custom-grafana"]').count()) === 1,
    `shapes=${await shapes()}`,
  );
  check(
    'explorar: el icono aparece en Propios',
    (await page.locator('.browser-mine-row').count()) >= 1,
  );
  await page.keyboard.press('Meta+b');
  await settle(200);
}
// Context menu items
{
  await selectGroup(0);
  const g = await page.locator('.canvas-surface rect[data-shape-id^="grp_"]').first().boundingBox();
  await page.mouse.click(g.x + 30, g.y + 12, { button: 'right' });
  await settle(300);
  const items = await page
    .locator('.context-menu [role="menuitem"], .context-menu-item')
    .allInnerTexts();
  check('menú contextual: se abre con acciones', items.length > 0, items.join(' | ').slice(0, 120));
  const n0 = await shapes();
  await page
    .locator('.context-menu-item')
    .filter({ hasText: /Duplicar/ })
    .first()
    .click();
  await settle(300);
  check('menú contextual: Duplicar añade', (await shapes()) > n0);
  await page.keyboard.press('Meta+z');
  await settle(200);
}
// Selection toolbar
{
  await page.keyboard.press('Meta+a');
  await settle(300);
  const gx = () =>
    page.locator('.canvas-surface rect[data-shape-id^="grp_"]').nth(1).getAttribute('x');
  const x0 = await gx();
  await page
    .locator('.selection-toolbar')
    .getByRole('button', { name: 'Alinear a la izquierda', exact: true })
    .click();
  await settle(300);
  check('barra de selección: alinear izquierda mueve', (await gx()) !== x0, `${x0}->${await gx()}`);
  await page.keyboard.press('Meta+z');
  await settle(200);
}
// Find on the canvas
{
  const t0 = await transform();
  await page.keyboard.press('Meta+f');
  await settle(200);
  await page.locator('.find-bar-input').fill('queue');
  await settle(600);
  check(
    '⌘F: encuentra, selecciona y mueve la cámara',
    /^1 de \d+$/.test((await page.locator('.find-bar-count').innerText()).trim()) &&
      (await transform()) !== t0,
  );
  await page.keyboard.press('Escape');
  await settle(200);
}
// View bar: new view
{
  await page.locator('.view-bar .chip').first().click();
  await settle(200);
  await page.locator('.view-bar-input').fill('Seguridad');
  await page.keyboard.press('Enter');
  await settle(400);
  check(
    'vistas: nueva vista aparece como pestaña',
    (await page.locator('.view-bar [role="tab"]').count()) === 2,
  );
}
// Account menu rename
{
  await page.locator('.topbar .user-button').click();
  await settle(200);
  await page.getByRole('menuitem', { name: /Tú|You/ }).click();
  await settle(200);
  await page.getByLabel('Tu nombre').fill('Ana');
  await page.keyboard.press('Enter');
  await settle(300);
  check(
    'cuenta: renombrar cambia el avatar',
    (await page.locator('.topbar .user-avatar').innerText()) === 'AN',
  );
}
// Library: cards, duplicate, delete
{
  await page.goto(base + '/');
  await page.waitForSelector('.library');
  await settle(500);
  const cards0 = await page.locator('.library-card').count();
  await page
    .locator('.library-card .icon-button[aria-label^="Duplicar"]')
    .first()
    .click({ force: true });
  await settle(500);
  const cards1 = await page.locator('.library-card').count();
  check('biblioteca: duplicar añade tarjeta', cards1 === cards0 + 1, `${cards0}->${cards1}`);
  await page
    .locator('.library-card .icon-button[aria-label^="Eliminar"]')
    .first()
    .click({ force: true });
  await settle(300);
  await page.getByRole('button', { name: 'Eliminar' }).last().click();
  await settle(500);
  check(
    'biblioteca: eliminar quita tarjeta',
    (await page.locator('.library-card').count()) === cards0,
  );
  await page.getByRole('button', { name: /Ver puntos de partida/ }).click();
  await settle(700);
  check(
    'biblioteca: ver puntos de partida desplaza',
    (await page.evaluate(() => window.scrollY)) > 100,
  );
}
// Library: favourites, sort, and a file dropped on the page
{
  await page.goto(base + '/');
  await page.waitForSelector('.library');
  await settle(500);
  // A second diagram, so there is an order to change.
  await page
    .locator('.library-card .icon-button[aria-label^="Duplicar"]')
    .first()
    .click({ force: true });
  await settle(500);
  const titles = () => page.locator('.library-card-title').allInnerTexts();
  const recent = await titles();
  await page.locator('.library-sort select').selectOption('name');
  await settle(300);
  const byName = await titles();
  check(
    'biblioteca: ordenar por nombre reordena',
    byName.join('|') === [...recent].sort((a, b) => a.localeCompare(b)).join('|') &&
      byName.length === recent.length,
    `${recent.join('|')} -> ${byName.join('|')}`,
  );
  await page.locator('.library-sort select').selectOption('recent');
  await settle(300);
  const last = page.locator('.library-card').last();
  const lastTitle = await last.locator('.library-card-title').innerText();
  await last.locator('.library-star').click({ force: true });
  await settle(300);
  check(
    'biblioteca: favorito sube la tarjeta y muestra el filtro',
    (await titles())[0] === lastTitle &&
      (await page.locator('.library-folder', { hasText: 'Favoritos' }).count()) === 1,
  );
  await page.locator('.library-folder', { hasText: 'Favoritos' }).click();
  await settle(300);
  check(
    'biblioteca: filtro Favoritos deja solo los marcados',
    (await page.locator('.library-card').count()) === 1,
  );
  await page.locator('.library-card .library-star').first().click({ force: true });
  await settle(300);
  check(
    'biblioteca: quitar favorito retira el filtro',
    (await page.locator('.library-folder', { hasText: 'Favoritos' }).count()) === 0,
  );
  // Drop a DSL document on the page: it opens as a new diagram.
  const cardsBefore = await page.locator('.library-card').count();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(
      new File(
        ['cloud: aws\nnodes:\n  fn: lambda\n  db: dynamodb\nedges:\n  - fn -> db: R/W\n'],
        'soltado.yaml',
        {
          type: 'application/yaml',
        },
      ),
    );
    const target = document.querySelector('.library');
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }),
      );
    }
  });
  await page.waitForURL(/\/d\//, { timeout: 8000 }).catch(() => {});
  check('biblioteca: soltar un archivo abre el diagrama importado', /\/d\//.test(page.url()));
  await page.waitForSelector('.canvas-surface');
  await settle(500);
  check(
    'biblioteca: el archivo soltado se dibujó',
    (await shapes()) >= 2 && (await page.locator('.topbar-name').inputValue()) === 'soltado',
  );
  await page.goto(base + '/');
  await page.waitForSelector('.library-card');
  await settle(500);
  const cardsAfter = await page.locator('.library-card').count();
  check(
    'biblioteca: el diagrama soltado está en la lista',
    cardsAfter === cardsBefore + 1,
    `${cardsBefore} -> ${cardsAfter}`,
  );
}
// Repository chip: a hosted repository is a link on the canvas
{
  await openTemplate();
  await selectItem(0);
  const field = page.locator('.inspector').getByLabel('Repositorio', { exact: true });
  await field.fill('github.com/aion/payments-api');
  await settle(400);
  const link = page.locator('.canvas-surface a.badge-link');
  check(
    'inspector: repositorio con host es un enlace en el lienzo',
    (await link.count()) === 1 &&
      (await link.getAttribute('href')) === 'https://github.com/aion/payments-api',
  );
  await field.fill('aion/payments-api');
  await settle(400);
  check(
    'inspector: repositorio sin host no enlaza',
    (await page.locator('.canvas-surface a.badge-link').count()) === 0 &&
      (await page.locator('.canvas-surface [data-badge="repository"]').count()) === 1,
  );
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} controles verificados${errors.length ? ` · errores de página: ${errors.length}` : ''}`,
);
if (errors.length) console.log(errors.slice(0, 3).join('\n'));
await browser.close();
process.exit(failed.length ? 1 : 0);
