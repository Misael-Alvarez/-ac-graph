// Accounts kept on this server, from a terminal.
//
// For the operator: the first account on a fresh deployment, a colleague's
// account when sign-up from the page is closed (AUTH_SIGNUP=closed), a
// forgotten password. Talks to the database directly with the same code the
// sign-in page uses, so a password set here is a password that signs in.
//
// Usage (DATABASE_URL points at the app's database):
//   node scripts/users.mjs list
//   node scripts/users.mjs create <email> "<name>"     # asks for the password
//   node scripts/users.mjs passwd <email>              # asks for the new password
//   node scripts/users.mjs delete <email>              # the account, its sessions and its memberships
//
// The password is asked for without echo; set PASSWORD in the environment
// instead where there is no terminal (a one-off task, a script). Accounts
// that came through an identity provider are listed but cannot be given a
// password: they sign in through the provider.
import { register } from 'node:module';
import { createInterface } from 'node:readline';
import pg from 'pg';

register('../bin/hooks.mjs', import.meta.url);
process.env.LOG_LEVEL ??= 'warn';
const { createLocalUser, LOCAL_ISSUER, setPassword, RegisterBodySchema } =
  await import('../src/server/auth/password.ts');

const [command, ...args] = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL?.trim();

function usage(code = 2) {
  console.error(
    [
      'Usage: DATABASE_URL=postgres://… node scripts/users.mjs <command>',
      '  list                      every account, with how it signs in',
      '  create <email> "<name>"   a local account; the password is asked for (or PASSWORD)',
      '  passwd <email>            a new password for a local account',
      '  delete <email>            removes the account and everything that was only its own',
    ].join('\n'),
  );
  process.exit(code);
}

if (!command || !['list', 'create', 'passwd', 'delete'].includes(command)) usage();
if (!databaseUrl) {
  console.error('Set DATABASE_URL to the database the app uses.');
  process.exit(2);
}

/** A password typed without echo, or the PASSWORD variable where there is no terminal. */
async function askPassword(prompt) {
  const fromEnv = process.env.PASSWORD;
  if (fromEnv !== undefined) return fromEnv;
  if (!process.stdin.isTTY) {
    console.error('No terminal to ask on: set PASSWORD in the environment.');
    process.exit(2);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const muted = { on: false };
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (text) => {
    if (!muted.on) write(text);
  };
  const answer = await new Promise((resolve) => {
    rl.question(prompt, (value) => resolve(value));
    muted.on = true;
  });
  muted.on = false;
  rl.close();
  process.stdout.write('\n');
  return answer;
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const email = args[0]?.trim().toLowerCase();

try {
  if (command === 'list') {
    const rows = await pool.query(
      `select email, name, issuer, password_hash is not null as has_password, created_at
         from users order by created_at`,
    );
    if (!rows.rows.length) console.log('No accounts yet.');
    for (const row of rows.rows) {
      const how =
        row.issuer === LOCAL_ISSUER
          ? row.has_password
            ? 'password'
            : 'local, no password set'
          : `provider ${row.issuer}`;
      console.log(`${row.email ?? '(no e-mail)'}\t${row.name}\t${how}`);
    }
  } else if (command === 'create') {
    const name = args.slice(1).join(' ').trim();
    if (!email || !name) usage();
    const password = await askPassword(`Password for ${email}: `);
    const body = RegisterBodySchema.safeParse({ email, name, password });
    if (!body.success) {
      console.error(body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
      process.exit(1);
    }
    const user = await createLocalUser(body.data, pool);
    console.log(`Created ${user.email} (${user.id}).`);
  } else if (command === 'passwd') {
    if (!email) usage();
    const password = await askPassword(`New password for ${email}: `);
    const changed = await setPassword(email, password, pool);
    if (!changed) {
      console.error(`No local account with e-mail ${email}.`);
      process.exit(1);
    }
    console.log(`Password updated for ${email}. Existing sessions stay signed in.`);
  } else if (command === 'delete') {
    if (!email) usage();
    const found = await pool.query('select id from users where lower(email) = $1', [email]);
    if (!found.rows.length) {
      console.error(`No account with e-mail ${email}.`);
      process.exit(1);
    }
    // Sessions and memberships go with the row (cascade); diagrams the person
    // owned would go too, so refuse while there are any.
    const owned = await pool.query('select count(*)::int as n from diagrams where owner_id = $1', [
      found.rows[0].id,
    ]);
    if (owned.rows[0].n > 0) {
      console.error(
        `${email} owns ${owned.rows[0].n} diagram(s). Delete or duplicate them under another owner first.`,
      );
      process.exit(1);
    }
    await pool.query('delete from users where id = $1', [found.rows[0].id]);
    console.log(`Deleted ${email}.`);
  }
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'email_taken') {
    console.error(`There is an account with e-mail ${email} already.`);
    process.exit(1);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
} finally {
  await pool.end();
}
