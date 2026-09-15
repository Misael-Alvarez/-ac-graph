// Functional audit of roles per diagram, against a server-mode instance.
//
// Two browsers: Ada owns a diagram, Bob is a stranger, then a viewer, then an
// editor, then removed, then a viewer who leaves. Every control the share
// dialog, the read-only editor and the library gained for roles must change
// something observable, and this is where that is checked.
//
// Usage:
//   AUDIT_DATABASE_URL=postgres://… node scripts/audit-roles.mjs [baseUrl]
//
// The app must be running in server mode against that same database (see
// docs/AUTHENTIK.md). The script seeds two users and two sessions, works, and
// removes what it created except the users. Never point it at a real workspace.
import { register } from 'node:module';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import pg from 'pg';

register('../bin/hooks.mjs', import.meta.url);
const { createEmptyModel, addGroup } = await import('../src/lib/engine/index.ts');

const base = process.argv[2] ?? 'http://127.0.0.1:3100';
const databaseUrl = process.env.AUDIT_DATABASE_URL;
if (!databaseUrl) {
  console.error('Set AUDIT_DATABASE_URL to the database the server-mode app uses.');
  process.exit(2);
}
const shots = process.env.AUDIT_SHOTS ?? '';
if (shots) mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const shot = (page, name) => (shots ? page.screenshot({ path: `${shots}/${name}.png` }) : null);

/* --- Seed: two people who have "signed in once", each with a live session. --- */
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const ISSUER = 'https://audit.invalid/application/o/ac-graph/';
async function person(name) {
  const email = `${name.toLowerCase()}@audit.example`;
  const found = await pool.query('select id from users where lower(email) = $1', [email]);
  let id = found.rows[0]?.id;
  if (!id) {
    id = `usr_audit_${name.toLowerCase()}_${randomBytes(4).toString('hex')}`;
    await pool.query(
      'insert into users (id, issuer, subject, name, email) values ($1, $2, $3, $4, $5)',
      [id, ISSUER, `audit-${name.toLowerCase()}`, name, email],
    );
  }
  const cookie = randomBytes(32).toString('base64url');
  await pool.query(
    `insert into sessions (id_hash, user_id, expires_at) values ($1, $2, now() + interval '1 hour')`,
    [createHash('sha256').update(cookie).digest('hex'), id],
  );
  return { id, name, email, cookie };
}
const ada = await person('Ada');
const bob = await person('Bob');

const url = new URL(base);
const browser = await chromium.launch();
async function signedIn(cookie) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'es',
  });
  await context.addCookies([
    { name: 'acg_session', value: cookie, domain: url.hostname, path: '/', httpOnly: true },
  ]);
  return context.newPage();
}
const adaPage = await signedIn(ada.cookie);
const bobPage = await signedIn(bob.cookie);

let diagramId = null;
let bobDiagramId = null;
/** The account the sign-in page itself creates below; removed at the end. */
const carolEmail = `carol.${randomBytes(3).toString('hex')}@audit.invalid`;
try {
  const model = createEmptyModel();
  addGroup(model, 0, 0);

  /* 0. The front door, when the server keeps the passwords itself: a third
     person with no cookie at all creates an account from the sign-in page,
     lands in the library, signs out from the account menu, and signs back in.
     Skipped — and said so — when the server signs people in through a provider. */
  const config = await (await fetch(`${base}/api/config`)).json();
  if (config.auth?.provider === 'local') {
    const fresh = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'es',
    });
    const carol = await fresh.newPage();
    await carol.goto(`${base}/`);
    await carol.waitForSelector('.signin-form', { timeout: 15000 });
    check(
      'Sign-in page: a stranger sees the password form, not the app',
      (await carol.locator('.library').count()) === 0,
    );
    const password = 'audit passphrase 2026';
    if (config.auth.signup) {
      await carol.getByRole('button', { name: /Créala/ }).click();
      await carol.getByLabel('Tu nombre').fill('Carol Audit');
      await carol.getByLabel('Correo').fill(carolEmail);
      await carol.getByLabel('Contraseña').fill('short');
      await carol.getByRole('button', { name: 'Crear cuenta' }).click();
      await carol.waitForTimeout(400);
      check(
        'Sign-in page: a short password is refused with a message, not a request',
        (await carol.locator('.signin-form .ai-error').count()) === 1 &&
          (await carol.locator('.signin-form').count()) === 1,
      );
      await carol.getByLabel('Contraseña').fill(password);
      await carol.getByRole('button', { name: 'Crear cuenta' }).click();
      await carol.waitForSelector('.library', { timeout: 15000 });
      check('Sign-in page: creating an account lands in the library, signed in', true);
      await shot(carol, '00-signed-up');
    } else {
      // Sign-up closed: the account is made the way the operator would.
      const { createLocalUser } = await import('../src/server/auth/password.ts');
      await createLocalUser({ name: 'Carol Audit', email: carolEmail, password }, pool);
      await carol.getByLabel('Correo').fill(carolEmail);
      await carol.getByLabel('Contraseña').fill(password);
      await carol.getByRole('button', { name: 'Entrar' }).click();
      await carol.waitForSelector('.library', { timeout: 15000 });
      check('Sign-in page: an account made from the terminal signs in', true);
    }
    const whoami = await carol.evaluate(async () => (await fetch('/api/auth/me')).json());
    check(
      'Sign-in page: /api/auth/me knows the new person',
      whoami.user?.email === carolEmail,
      JSON.stringify(whoami),
    );
    // Out through the header's sign-out button, back to the form.
    await carol.getByRole('button', { name: 'Cerrar sesión' }).click();
    await carol.waitForSelector('.signin-form', { timeout: 15000 });
    check('Sign-in page: signing out returns to the form', true);
    const after = await carol.evaluate(async () => (await fetch('/api/auth/me')).status);
    check('Sign-in page: the session is gone on the server too', after === 401, String(after));
    // Wrong password, then the right one.
    await carol.getByLabel('Correo').fill(carolEmail);
    await carol.getByLabel('Contraseña').fill('not the passphrase');
    await carol.getByRole('button', { name: 'Entrar' }).click();
    await carol.waitForSelector('.signin-form .ai-error', { timeout: 10000 });
    check(
      'Sign-in page: a wrong password says so and stays on the form',
      /correo o la contraseña/.test(await carol.locator('.signin-form .ai-error').innerText()),
    );
    await carol.getByLabel('Contraseña').fill(password);
    await carol.getByRole('button', { name: 'Entrar' }).click();
    await carol.waitForSelector('.library', { timeout: 15000 });
    check('Sign-in page: the right password signs back in', true);
    await shot(carol, '00-signed-in-again');
    await fresh.close();
  } else {
    console.log(`(sign-in page: skipped — provider is ${config.auth?.provider ?? 'unknown'})`);
  }

  await adaPage.goto(`${base}/`);
  await adaPage.waitForSelector('.library', { timeout: 15000 });
  const created = await adaPage.evaluate(
    async (body) => {
      const r = await fetch('/api/diagrams', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'ac-graph' },
        body: JSON.stringify(body),
      });
      return r.json();
    },
    { title: 'Roles audit', model },
  );
  diagramId = created.id;
  check('Ada creates a diagram and is its owner', created.role === 'owner', diagramId);

  /* 1. A stranger. */
  await bobPage.goto(`${base}/d/${diagramId}`);
  await bobPage.waitForSelector('.page-note', { timeout: 15000 });
  const denied = (await bobPage.locator('.page-note').innerText()).replace(/\s+/g, ' ');
  check(
    'Bob (stranger) sees the no-access page naming Ada',
    /No tienes acceso/.test(denied) && /Ada/.test(denied),
    denied.slice(0, 80),
  );
  await shot(bobPage, '01-stranger');

  /* 2. The owner invites. */
  await adaPage.goto(`${base}/d/${diagramId}`);
  await adaPage.waitForSelector('.topbar', { timeout: 15000 });
  check(
    'The owner has no read-only badge',
    (await adaPage.locator('.readonly-badge').count()) === 0,
  );
  await adaPage.locator('.topbar button[aria-label="Compartir"]').click();
  const dialog = adaPage.getByRole('dialog', { name: 'Compartir' });
  await dialog.locator('.share-people-list').waitFor({ timeout: 10000 });
  check(
    'Share: people section lists the owner only',
    (await dialog.locator('.share-person').count()) === 1,
  );

  await dialog.locator('input[type="email"]').fill('nobody@audit.example');
  await dialog.locator('.share-invite button[type="submit"]').click();
  await dialog.locator('.share-people-note.is-error').waitFor({ timeout: 10000 });
  check(
    'Share: an unknown e-mail is explained',
    /iniciado sesión/.test(await dialog.locator('.share-people-note.is-error').innerText()),
  );

  await dialog.locator('input[type="email"]').fill(bob.email.toUpperCase());
  await dialog.locator('.share-invite select').selectOption('viewer');
  await dialog.locator('.share-invite button[type="submit"]').click();
  const bobRow = dialog.locator('.share-person').nth(1);
  await bobRow.waitFor({ timeout: 10000 });
  check(
    'Share: adding by e-mail (any case) lists the person with the chosen role',
    /Bob/.test(await bobRow.innerText()) &&
      (await bobRow.locator('select').inputValue()) === 'viewer',
  );
  await shot(adaPage, '02-share-people');

  /* 3. A viewer. */
  await bobPage.goto(`${base}/d/${diagramId}`);
  await bobPage.waitForSelector('.readonly-badge', { timeout: 15000 });
  check(
    'Viewer: read-only badge',
    /Solo lectura/.test(await bobPage.locator('.readonly-badge').innerText()),
  );
  check(
    'Viewer: one tool in the dock',
    (await bobPage.locator('.tool-dock .tool-button').count()) === 1,
  );
  check(
    'Viewer: title cannot be edited',
    (await bobPage.locator('.topbar-name').getAttribute('readonly')) !== null,
  );
  check(
    'Viewer: AI is disabled',
    await bobPage.locator('.topbar button[aria-label="IA"]').isDisabled(),
  );
  check(
    'Viewer: status bar says read-only',
    /Solo lectura/.test(await bobPage.locator('.statusbar').innerText()),
  );

  const item = bobPage.locator('.canvas-surface rect[data-shape-id^="itm_"]').first();
  await item.click({ position: { x: 30, y: 20 } });
  await bobPage.waitForSelector('.inspector', { timeout: 5000 });
  const enabled = await bobPage
    .locator('.inspector input:enabled, .inspector select:enabled, .inspector button:enabled')
    .count();
  check(
    'Viewer: inspector shows every property, none editable',
    (await bobPage.locator('fieldset.inspector-lock[disabled]').count()) === 1 && enabled === 0,
    `enabled controls: ${enabled}`,
  );
  check('Viewer: no resize handle', (await bobPage.locator('.resize-handle').count()) === 0);
  await item.click({ button: 'right', position: { x: 30, y: 20 } });
  await bobPage.waitForTimeout(250);
  const viewerRows = await bobPage.locator('.context-menu-item').allInnerTexts();
  check(
    'Viewer: the context menu offers only to comment',
    viewerRows.length === 1 && /Comentar/.test(viewerRows[0]),
    viewerRows.join(' | '),
  );
  await bobPage.keyboard.press('Escape');
  await bobPage.waitForTimeout(150);

  const shapesBefore = await bobPage.locator('.canvas-surface [data-shape-id]').count();
  await bobPage.keyboard.press('Delete');
  await bobPage.keyboard.press('Backspace');
  await bobPage.keyboard.press('Meta+z');
  await bobPage.waitForTimeout(250);
  const shapesAfter = await bobPage.locator('.canvas-surface [data-shape-id]').count();
  check('Viewer: delete and undo change nothing', shapesBefore === shapesAfter && shapesBefore > 0);

  await bobPage.keyboard.press('Meta+k');
  await bobPage.waitForSelector('.palette-input', { timeout: 5000 });
  await bobPage.locator('.palette-input').fill('Vaciar');
  await bobPage.waitForTimeout(250);
  check(
    'Viewer: the palette does not offer to clear the canvas',
    (await bobPage
      .locator('.palette-row')
      .filter({ hasText: /Vaciar/ })
      .count()) === 0,
  );
  await bobPage.keyboard.press('Escape');
  await shot(bobPage, '03-viewer');

  await adaPage.keyboard.press('Escape');
  await adaPage
    .waitForFunction(() => document.querySelectorAll('.presence-avatar').length >= 2, null, {
      timeout: 15000,
    })
    .catch(() => {});
  check(
    'Presence: the owner sees the viewer in the room',
    (await adaPage.locator('.presence-avatar').count()) >= 2,
  );

  /* 3b. Comments: a viewer speaks, the owner hears it live, and only the right people delete. */
  const bobItem = bobPage.locator('.canvas-surface rect[data-shape-id^="itm_"]').first();
  await bobItem.click({ button: 'right', position: { x: 30, y: 20 } });
  await bobPage.getByRole('menuitem', { name: 'Comentar…' }).click();
  const bobPanel = bobPage.locator('.side-panel[aria-label="Comentarios"]');
  await bobPanel.locator('.comment-field').fill('Roles audit: is this in prod?');
  await bobPage.keyboard.press('Enter');
  await bobPanel.locator('.comment-thread').waitFor({ timeout: 10000 });
  check(
    'Comments: a viewer may comment, and the thread is signed by them',
    (await bobPanel.locator('.comment-thread .comment-meta b').first().innerText()) === 'Tú',
  );
  const adaPin = adaPage.locator('.canvas-surface .comment-pin:not(.is-draft)');
  await adaPin.waitFor({ timeout: 10000 }).catch(() => {});
  check('Comments: the owner sees the pin appear live', (await adaPin.count()) === 1);
  const adaToast = await adaPage
    .locator('.toast')
    .innerText()
    .catch(() => '');
  check('Comments: the owner is told who spoke', /Bob comentó/.test(adaToast), adaToast);
  await adaPin.click();
  const adaPanel = adaPage.locator('.side-panel[aria-label="Comentarios"]');
  await adaPanel.locator('.comment-thread.is-focused').waitFor({ timeout: 10000 });
  check(
    'Comments: pressing the pin opens the panel on the thread',
    /Roles audit: is this in prod\?/.test(
      await adaPanel.locator('.comment-thread.is-focused').innerText(),
    ),
  );
  await adaPanel.getByRole('textbox', { name: 'Responder' }).fill('Yes, prod.');
  await adaPanel.getByRole('textbox', { name: 'Responder' }).press('Enter');
  await bobPanel
    .locator('.comment-row')
    .nth(1)
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  check(
    'Comments: the reply reaches the viewer live',
    (await bobPanel.locator('.comment-row').count()) === 2,
  );
  await shot(bobPage, '07-comments-viewer');
  // Bob (author) may delete his; Ada (owner) may too. A stranger may not even read.
  const threadRow = await pool.query('select id from comment_threads where diagram_id = $1', [
    diagramId,
  ]);
  const strangerCookie = (await person('Carol')).cookie;
  // From Node, so the cookie is a stranger's and not this browser's.
  const strangerRead = await fetch(`${base}/api/diagrams/${diagramId}/comments`, {
    headers: { cookie: `acg_session=${strangerCookie}` },
  });
  check(
    'Comments: a stranger is refused',
    strangerRead.status === 403,
    String(strangerRead.status),
  );
  check(
    'Comments: the owner may delete a thread that is not theirs',
    (await adaPanel.getByRole('button', { name: 'Eliminar hilo' }).count()) === 1 &&
      threadRow.rows.length === 1,
  );
  await adaPanel.getByRole('button', { name: 'Eliminar hilo' }).click();
  await bobPanel
    .locator('.comment-thread')
    .waitFor({ state: 'detached', timeout: 10000 })
    .catch(() => {});
  check(
    'Comments: the deletion reaches the viewer live',
    (await bobPanel.locator('.comment-thread').count()) === 0,
  );
  await pool.query('delete from sessions where id_hash = $1', [
    createHash('sha256').update(strangerCookie).digest('hex'),
  ]);
  // Both panels away, so the steps below meet the editor they expect.
  await adaPage.keyboard.press('Meta+Shift+c');
  await bobPage.keyboard.press('Meta+Shift+c');
  await adaPage.waitForTimeout(300);

  /* 4. Promoted live. */
  await adaPage.locator('.topbar button[aria-label="Compartir"]').click();
  await dialog.locator('.share-person').nth(1).locator('select').waitFor({ timeout: 10000 });
  await dialog.locator('.share-person').nth(1).locator('select').selectOption('editor');
  await bobPage.waitForFunction(
    () => document.querySelectorAll('.readonly-badge').length === 0,
    null,
    {
      timeout: 15000,
    },
  );
  check(
    'Editor: promotion takes effect live (badge gone, tools back)',
    (await bobPage.locator('.tool-dock .tool-button').count()) > 1,
  );
  const toasts = await bobPage
    .locator('.toast')
    .allInnerTexts()
    .catch(() => []);
  check(
    'Editor: told by whom',
    toasts.some((text) => /Ada/.test(text)),
    toasts.join(' | ').slice(0, 60),
  );
  await shot(bobPage, '04-editor');

  /* 5. Removed live. */
  await dialog.locator('.share-person').nth(1).getByRole('button', { name: 'Quitar' }).click();
  await bobPage.waitForSelector('.editor-banner.is-danger', { timeout: 15000 });
  const banner = await bobPage.locator('.editor-banner.is-danger').innerText();
  check(
    'Removed: banner names who did it, copy stays downloadable',
    /Ada te retiró/.test(banner) && /Descargar/.test(banner),
    banner.slice(0, 60),
  );
  check('Removed: read-only again', (await bobPage.locator('.readonly-badge').count()) === 1);
  await dialog
    .locator('.share-person')
    .nth(1)
    .waitFor({ state: 'detached', timeout: 10000 })
    .catch(() => {});
  check(
    'Share: the list follows the removal',
    (await dialog.locator('.share-person').count()) === 1,
  );
  await shot(bobPage, '05-removed');

  /* 6. The library of a viewer. */
  await dialog.locator('input[type="email"]').fill(bob.email);
  await dialog.locator('.share-invite select').selectOption('viewer');
  await dialog.locator('.share-invite button[type="submit"]').click();
  await dialog.locator('.share-person').nth(1).waitFor({ timeout: 10000 });
  await bobPage.goto(`${base}/`);
  await bobPage.waitForSelector('.library-card', { timeout: 15000 });
  const card = bobPage.locator('.library-card').filter({ hasText: 'Roles audit' }).first();
  check(
    'Library: a shared diagram wears its role',
    /Puede ver/.test(await card.locator('.library-card-role').innerText()),
  );
  check(
    'Library: a non-owner can leave, not delete',
    (await card.getByRole('button', { name: /^Salir/ }).count()) === 1 &&
      (await card.getByRole('button', { name: /^Eliminar/ }).count()) === 0,
  );
  await shot(bobPage, '06-library');
  if (shots) await card.screenshot({ path: `${shots}/06-library-card.png` });
  const cards = await bobPage.locator('.library-card').filter({ hasText: 'Roles audit' }).count();
  // The card's actions take the pointer only while the card is hovered, as a
  // person's hand would have it; the hit test runs before the move otherwise.
  await card.hover();
  await card.getByRole('button', { name: /^Salir/ }).click();
  await bobPage.getByRole('button', { name: 'Salir' }).last().click();
  await bobPage
    .waitForFunction(
      (n) =>
        [...document.querySelectorAll('.library-card')].filter((c) =>
          c.textContent.includes('Roles audit'),
        ).length < n,
      cards,
      { timeout: 10000 },
    )
    .catch(() => {});
  const cardsAfter = await bobPage
    .locator('.library-card')
    .filter({ hasText: 'Roles audit' })
    .count();
  check(
    'Library: leaving removes the diagram from the library',
    cardsAfter === cards - 1,
    `${cards} -> ${cardsAfter}`,
  );
  await dialog
    .locator('.share-person')
    .nth(1)
    .waitFor({ state: 'detached', timeout: 10000 })
    .catch(() => {});
  check(
    'Share: the owner sees the departure',
    (await dialog.locator('.share-person').count()) === 1,
  );

  /* 7. One icon library for the workspace: what Ada uploads, Bob sees and may tidy. */
  await adaPage.goto(`${base}/d/${diagramId}`);
  await adaPage.waitForSelector('.canvas-surface', { timeout: 15000 });
  await adaPage.locator('.topbar button[aria-label="Más"]').click();
  await adaPage.getByRole('menuitem', { name: /Iconos del workspace/ }).click();
  const iconsDialog = adaPage.locator('.dialog');
  await iconsDialog.waitFor({ timeout: 10000 });
  check(
    "Icons: the dialog is the workspace's, and says so",
    /Iconos del workspace/.test(await iconsDialog.locator('.dialog-header').innerText()),
  );
  await iconsDialog.locator('.icon-picker-tile.is-upload').click();
  await iconsDialog.locator('.icon-upload-drop input[type=file]').setInputFiles({
    name: 'roles-audit.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" fill="#0f62fe"/></svg>',
    ),
  });
  await iconsDialog.getByLabel('Nombre').fill('Roles audit icon');
  await iconsDialog.getByRole('button', { name: /Guardar y usar/ }).click();
  await iconsDialog
    .locator('.icon-picker-tile[data-key^="custom-roles-audit"]')
    .waitFor({ timeout: 10000 });
  const stored = await pool.query(
    "select key, created_by from icons where key like 'custom-roles-audit%'",
  );
  check(
    'Icons: an upload is stored for the workspace, attributed to Ada',
    stored.rows.length === 1 && stored.rows[0].created_by === ada.id,
  );
  await adaPage.keyboard.press('Escape');

  await bobPage.goto(`${base}/`);
  await bobPage.waitForSelector('.library', { timeout: 15000 });
  await bobPage.locator('.library-templates .template-card.is-blank').click();
  await bobPage.waitForSelector('.canvas-surface', { timeout: 15000 });
  bobDiagramId = bobPage.url().match(/\/d\/([^/?#]+)/)?.[1] ?? null;
  await bobPage.locator('.topbar button[aria-label="Más"]').click();
  await bobPage.getByRole('menuitem', { name: /Iconos del workspace/ }).click();
  const bobIcons = bobPage.locator('.dialog');
  const bobTile = bobIcons.locator('.icon-picker-tile[data-key^="custom-roles-audit"]');
  await bobTile.waitFor({ timeout: 10000 }).catch(() => {});
  check("Icons: Bob's browser lists what Ada uploaded", (await bobTile.count()) === 1);
  await shot(bobPage, '07-icons-shared');
  await bobIcons.getByRole('button', { name: /^Quitar del workspace: Roles audit icon/ }).click();
  await bobTile.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  const left = await pool.query("select 1 from icons where key like 'custom-roles-audit%'");
  check('Icons: Bob removes it for everyone', left.rows.length === 0);
  await bobPage.keyboard.press('Escape');

  await adaPage.locator('.topbar button[aria-label="Más"]').click();
  await adaPage.getByRole('menuitem', { name: /Iconos del workspace/ }).click();
  await adaPage.locator('.dialog').waitFor({ timeout: 10000 });
  await adaPage.waitForTimeout(800);
  check(
    "Icons: Ada's next look no longer shows it",
    (await adaPage.locator('.dialog .icon-picker-tile[data-key^="custom-roles-audit"]').count()) ===
      0,
  );
  await adaPage.keyboard.press('Escape');
} finally {
  /* --- Clean up: the diagram, the icon and the two sessions; the people stay. --- */
  await pool.query("delete from icons where key like 'custom-roles-audit%'").catch(() => {});
  for (const id of [diagramId, bobDiagramId]) {
    if (id) await pool.query('delete from diagrams where id = $1', [id]).catch(() => {});
  }
  for (const who of [ada, bob]) {
    await pool
      .query('delete from sessions where id_hash = $1', [
        createHash('sha256').update(who.cookie).digest('hex'),
      ])
      .catch(() => {});
  }
  // The account the sign-in page made is the one seeded thing that goes.
  await pool.query('delete from users where lower(email) = $1', [carolEmail]).catch(() => {});
  await pool.end();
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
