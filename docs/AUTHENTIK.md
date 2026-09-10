# Server mode with Authentik

AC Graph runs in one of two modes, decided at start-up from environment
variables alone:

| Mode       | Storage                  | Identity                     | When                                                                          |
| ---------- | ------------------------ | ---------------------------- | ----------------------------------------------------------------------------- |
| **local**  | IndexedDB in the browser | none                         | default                                                                       |
| **server** | PostgreSQL               | OpenID Connect via Authentik | `DATABASE_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID` **and** `APP_URL` are all set |

`GET /api/config` tells the browser which mode it is in. In local mode every
other server route answers `404 {"code":"server_mode_off"}` and never touches a
database or an identity provider.

Server mode gives one workspace where each diagram belongs to whoever created
it: only its **members** — the owner, and the editors and viewers the owner let
in — can open it (see [Who can open a diagram](#6-who-can-open-a-diagram)).

## 1. Create the provider in Authentik

_Admin interface → Applications → Providers → Create → OAuth2/OpenID Provider._

| Field                      | Value                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                       | `AC Graph`                                                                                                                                                                            |
| Authorization flow         | `default-provider-authorization-implicit-consent` (or explicit consent, either works)                                                                                                 |
| Client type                | **Public** (recommended, PKCE only) or **Confidential** (then copy the client secret)                                                                                                 |
| Client ID                  | keep the generated value, or set your own → `OIDC_CLIENT_ID`                                                                                                                          |
| Redirect URIs / Origins    | **Strict**: `${APP_URL}/api/auth/callback`, e.g. `https://graph.example.com/api/auth/callback`                                                                                        |
| Signing key                | **Required.** `authentik Self-signed Certificate` or any RS256/ES256 key. The app verifies the ID token signature against the provider's JWKS; an HS256 (no key) provider is rejected |
| Scopes (Advanced)          | `openid`, `profile`, `email` — the defaults; `offline_access` is not needed                                                                                                           |
| Subject mode               | `Based on the User's hashed ID` (default). Users are linked by `(issuer, subject)`, so **never change this later**                                                                    |
| Include claims in id_token | enabled (default) — the app reads `sub`, `name`, `preferred_username`, `email`, `picture` from the ID token                                                                           |
| PKCE                       | Authentik accepts `S256` for every provider; the app always sends it                                                                                                                  |

Then _Applications → Create_: name `AC Graph`, slug `ac-graph`, provider `AC Graph`,
Launch URL `${APP_URL}`. The issuer shown on the provider page is what goes into
`OIDC_ISSUER`, **including the trailing slash**:

```
https://auth.example.com/application/o/ac-graph/
```

Discovery is `${OIDC_ISSUER}.well-known/openid-configuration`; the app fetches it
on the first login, not at start-up.

Assign the users or groups who may use the app to the Application (Policy /
Group / User bindings). Anyone Authentik lets through gets full access to the
workspace.

## 2. Environment variables

| Variable             | Required | Meaning                                                                                                                                                      |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`       | yes      | PostgreSQL connection string. `compose.server.yaml` builds it from `POSTGRES_PASSWORD`; set it yourself for `next dev`                                       |
| `OIDC_ISSUER`        | yes      | The provider's issuer URL, trailing slash included                                                                                                           |
| `OIDC_CLIENT_ID`     | yes      | Client ID from the provider                                                                                                                                  |
| `OIDC_CLIENT_SECRET` | no       | Only for a confidential client. Empty = public client, PKCE alone                                                                                            |
| `APP_URL`            | yes      | The origin the **browser** uses, e.g. `https://graph.example.com` or `http://localhost:3080`. Decides the `Secure` flag on cookies and the CSRF origin check |
| `SESSION_TTL_HOURS`  | no       | Session lifetime, default `12`. Sessions are not refreshed; Authentik's own SSO session makes re-login a redirect                                            |
| `PGPOOL_MAX`         | no       | Connections per app process, default `10`                                                                                                                    |
| `POSTGRES_PASSWORD`  | compose  | Password of the `acgraph` database user in the Compose stack                                                                                                 |

Logging, metrics and tracing (`LOG_LEVEL`, `LOG_FORMAT`, `METRICS_TOKEN`,
`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`) are independent of server
mode and described in [DOCKER.md](DOCKER.md#logs-metrics-and-traces). In server
mode the access records additionally carry `userId`, `sessionKey` (a one-way
digest of the cookie, shared by the tabs of one browser) and `diagramId`, and
`/api/metrics` counts sessions, logins by outcome, saves and 412 conflicts.

Two things bite when the app runs in Docker:

- **The container must reach `OIDC_ISSUER` under the same URL the browser
  uses.** The ID token's `iss` claim has to equal `OIDC_ISSUER` byte for byte, so
  `host.docker.internal` or a container-only hostname will not work unless
  Authentik is also configured to issue tokens under that name. Use a real
  hostname that resolves from both sides (a reverse proxy or a hosts entry inside
  the container).
- **`http://` issuers are accepted only for development.** The HTTPS-only rule
  of `openid-client` is relaxed for a plain-http issuer (the ID token signature
  is still verified); production must use `https://`.

## 3. Start

```bash
export POSTGRES_PASSWORD='<strong unique password>'
export OIDC_ISSUER='https://auth.example.com/application/o/ac-graph/'
export OIDC_CLIENT_ID='<client id>'
export OIDC_CLIENT_SECRET=''            # or the secret of a confidential client
export APP_URL='http://localhost:3080'  # what the browser will type

docker compose -f compose.yaml -f compose.server.yaml -p acgraph-foundation up -d --build --wait
curl --fail http://127.0.0.1:3080/api/config   # → {"mode":"server","auth":{...}}
```

Or put those variables in `.env.local` and add `--env-file .env.local`. The
overlay removes the `postgres` profile, so the database starts with the app and
the app waits for its health check. Missing required variables fail the `up`
with a clear message instead of starting in local mode by accident.

The schema is created and migrated by the app itself on its first database
access (`schema_migrations` table, advisory-locked so several replicas can boot
at once). There is nothing to run by hand.

For `next dev` against the sandbox database:

```bash
POSTGRES_PASSWORD=devtest docker compose -p acgraph-foundation --profile postgres up -d --wait postgres
DATABASE_URL=postgres://acgraph:devtest@127.0.0.1:55432/acgraph \
OIDC_ISSUER=... OIDC_CLIENT_ID=... APP_URL=http://localhost:3000 npm run dev
```

## 4. How a login works

1. Browser → `GET /api/auth/login?next=/d/dgm_abc`. Only same-site paths are
   accepted for `next`; anything else becomes `/`.
2. The app stores `state`, `nonce` and the PKCE verifier in `auth_states` (10
   minutes), sets a 10-minute `acg_auth_state` cookie holding the `state`, and
   redirects to Authentik with `code_challenge_method=S256`.
3. Authentik → `GET /api/auth/callback?code=…&state=…`. The `state` must match
   both the cookie and a live row, which is consumed (one shot). The code is
   redeemed, the ID token is verified (signature against the JWKS, `iss`,
   `aud`, `exp`, `nonce`), and the user is upserted by `(issuer, subject)` — name, e-mail and picture are
   refreshed from the claims each time.
4. A session row is created (32 random bytes; only its SHA-256 is stored) and
   the `acg_session` cookie is set: `HttpOnly; SameSite=Lax; Path=/`,
   `Secure` when `APP_URL` is https, `Max-Age` = `SESSION_TTL_HOURS`.
5. `POST /api/auth/logout` (same-origin only) deletes the row and clears the
   cookie. It answers `200 {"endSessionUrl"}` when Authentik exposes an
   end-session endpoint so the browser can also close the SSO session, `204`
   otherwise.

Every mutating call (`POST`/`PUT`/`PATCH`/`DELETE`) must carry
`x-requested-with: ac-graph` and an `Origin` (or `Referer`) equal to `APP_URL`;
otherwise it is `403 forbidden`. `HttpDiagramRepository` and `sendPresence`
do this for you.

## 5. Collaboration

`GET /api/diagrams/{id}/events` is a Server-Sent Events stream with `saved`,
`meta`, `deleted` and `presence` events, a `: ping` every 15 s and the roster on
join. `POST /api/diagrams/{id}/presence` updates this tab's cursor and editing
flag; a viewer that stays silent for 15 s drops off the roster. Colours are
assigned per user from a fixed palette of eight, so one person looks the same in
every tab and on every screen.

What the editor does with that, end to end (verified with two signed-in browsers
against the Compose stack):

- **Roster and cursors.** The top bar shows a live pill and the avatars of
  everyone in the room; other people's cursors move over the canvas with their
  name in their colour. Cursor traffic is throttled to ~12 updates/s per tab.
- **Live saves.** When someone else saves and you have no unsaved changes, their
  revision replaces your canvas as one undo step and a toast names who saved.
  The adopted model is marked `origin: 'remote'` so your autosave does not write
  it straight back — that echo is exactly how two editors would otherwise re-save
  each other's work forever.
- **Conflicts.** If you had unsaved changes when their save landed, or your own
  save comes back `412`, your status turns to _Newer version elsewhere_ and a
  banner offers two buttons: **Download my copy** (your model as JSON) and
  **Load latest** (theirs, dropping your pending edit and its local journal).
  Nothing is merged for you. After loading theirs you keep editing normally and
  your next save goes through.
- **Deletion.** If someone deletes the diagram under you, a banner says who and
  offers to download your local copy.

## 6. Who can open a diagram

Every diagram has members with one of three roles, kept in `diagram_members`:

| Role     | Read, export, presence, history | Save, rename, restore | Delete, manage members |
| -------- | ------------------------------- | --------------------- | ---------------------- |
| `owner`  | yes                             | yes                   | yes                    |
| `editor` | yes                             | yes                   | no                     |
| `viewer` | yes                             | no                    | no                     |

The owner is `ownerId` — whoever created the diagram (or imported it) — and
there is exactly one. Anyone who can read a diagram may duplicate it into a
copy of their own. The library lists only the diagrams one is a member of, with
a chip naming the role when it is not one's own; a member who is not the owner
can leave from the card. Every route checks the role in the database, in the
same transaction that locks the row for a write, so a revoked person cannot
finish a save that was already in flight. A stranger gets `403 {"code":"no_access"}`
with the owner's name, so the interface can say whom to ask; an unknown id is
still a 404.

**Sharing** happens in the Share dialog, above the links. The owner adds people
by e-mail (`PUT /api/diagrams/:id/members {email, role}`; the person must have
signed in once, else `404 user_not_found`), changes a role in place
(`PATCH /api/diagrams/:id/members/:userId {role}`) or removes someone
(`DELETE /api/diagrams/:id/members/:userId`); every member sees the list
(`GET /api/diagrams/:id/members`) and may remove themself. Each change is
published to the room as an `access` event, so the dialog refreshes on every
screen and the person concerned sees the change live: a promotion unlocks the
editor on the spot, a demotion locks it, a removal leaves the canvas on screen,
read-only, with a banner and a button to download the copy.

**A viewer's editor** is the whole editor with writing taken out: the tool dock
keeps only the selector, the inspector shows every property in a disabled
fieldset, undo/redo/delete/AI/templates/clear are greyed out in the palette
and the menus, drags and resizes never start, the YAML panel is read-only, and
every edit is dropped before the reducer as a last line of defence. Presence
still works — a viewer is in the room like anyone else.

`npm run audit:roles -- <baseUrl>` (with `AUDIT_DATABASE_URL` pointing at the
same database as the running server-mode app) drives two browsers through the
whole story and asserts each of these behaviours.

## What it does not do yet

- **One workspace.** Everyone signs into the same space; there are no teams,
  folders shared as a unit or workspace-wide roles — access is per diagram (see
  section 6). Ownership cannot be transferred yet.
- **Invitations reach accounts, not inboxes.** Adding someone requires that they
  have signed in once (the identity provider is the only source of accounts);
  nobody is e-mailed.
- **The live layer is best effort across replicas.** Several app processes on
  one PostgreSQL share presence and events through `LISTEN/NOTIFY` (channel
  `acgraph_collab`): a viewer on replica A sees cursors and `saved` events from
  replica B. The listening connection is opened at start-up and reconnects with
  a growing delay if the server drops it; while it is down, that replica misses
  what the others say, and presence heals through heartbeats within 15 s.
  Persistence and optimistic concurrency never depend on the bus. The listening
  connection must reach PostgreSQL directly (or through a pooler in _session_
  mode) — `LISTEN` does not survive transaction-mode pooling such as PgBouncer's
  default. Metrics: `acgraph_collab_bus_*`.
- **No simultaneous merge.** Two people editing the same diagram at once get
  last-writer-wins with conflict detection (`412 conflict` carrying the current
  record), not a CRDT merge. The editor reloads on a conflict; it does not merge.
- **No automatic backups.** The `postgres-data` volume is the only copy. Use
  `pg_dump` or the workspace export (`GET /api/workspace/export`) on a schedule.
- **No session refresh or revocation from Authentik.** A session lives its TTL
  even if the user is disabled in Authentik in the meantime.
- **Login errors are a redirect, not a page of their own.** A provider that
  cannot be reached, or a rejected or expired callback, sends the browser back
  to the sign-in page with `?auth_error=…`; the sign-in card shows a generic
  failure line and the cause is in the server log only (`could not start login`
  / `login callback failed`, with the request id; `acgraph_logins_total{result="error"}`
  counts them).
