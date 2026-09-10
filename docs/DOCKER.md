# Docker Operations

## Scope and requirements

This is a single-instance, self-hosted production build of AC Graph, not a cloud
deployment. Use Docker Desktop with Linux containers (including Apple Silicon)
or Docker Engine with Docker Compose v2.20+ and BuildKit. No AWS resources,
registry push or paid API are needed. CI uses GitHub Actions runner minutes under
the repository's existing quota; no paid service is provisioned by this setup.

- Node is `24.20.0` (24 LTS) in `.nvmrc` and CI.
- Docker uses `node:24.20.0-bookworm-slim` pinned to the multi-platform index
  `sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e`.
- The tag/digest was verified on 2026-09-08 with
  `docker buildx imagetools inspect node:24.20.0-bookworm-slim`; the index includes
  Linux ARM64 and AMD64. Docker chooses the host architecture without emulation.
- Stages are base, dependencies (`npm ci`), builder and runner. The runner copies
  only Next standalone output, `public` and `.next/static`, runs as `node` (UID
  1000), and starts `node server.js`, not a development server or `next start`.
- `.dockerignore` allowlists build inputs and excludes environment files, keys,
  credentials, Git history, agent skills, docs and host build/dependency caches.
  Never pass secrets as build arguments or `NEXT_PUBLIC_*` variables.

Image digests are immutable, not automatically patched. When updating Node,
verify the new exact tag/index, update `Dockerfile`, `.nvmrc`, both root `engines`
entries and this document together, then rebuild and rerun CI. Review and refresh
the optional PostgreSQL image separately before any real deployment.

## Start and inspect

Run from the repository root. The fixed Compose project is `acgraph-foundation`;
all commands below are scoped to it, not to other Docker projects.

```bash
docker compose -p acgraph-foundation config --quiet
docker compose -p acgraph-foundation build app
docker compose -p acgraph-foundation up -d --no-build --wait --wait-timeout 90 app
docker compose -p acgraph-foundation ps
curl --fail --silent --show-error http://127.0.0.1:3080/api/health
docker compose -p acgraph-foundation logs --tail 100 app
```

Open http://127.0.0.1:3080. `/api/health` returns HTTP 200 with
`{"status":"ok"}` and `Cache-Control: no-store`. It is a liveness check for the
HTTP process only, with no credentials or infrastructure details. It does not
check IndexedDB, Anthropic, PostgreSQL or diagram persistence. The image includes
a Node-based healthcheck, so curl is not needed inside the container. An unhealthy
status does not itself restart a container; the restart policy handles exits.

The app runs internally on port 3000, bound to `0.0.0.0` **inside** the container.
Compose publishes only `127.0.0.1:3080` on the host. Native `next dev` uses 3000;
automatic Playwright uses `127.0.0.1:3100`. To use another Docker host port without
changing either development or E2E:

```bash
APP_PORT=43127 docker compose -p acgraph-foundation up -d --build --wait app
curl --fail http://127.0.0.1:43127/api/health
```

Use a free port. Do not kill another process or remove another project's
containers to make a port available. There is no development Compose overlay:
use `npm run dev` for hot reload and Compose for the production artifact.

## Runtime configuration

No environment file is required. AI is disabled when `ANTHROPIC_API_KEY` is empty;
the rest of the app works. The safe, tracked `.env.example` lists supported
settings without real credentials. `.env`, `.env.local` and other private variants
remain ignored by Git and Docker.

Compose normally reads shell variables and `.env`, not Next's `.env.local`.
If a private `.env.local` already exists, do not overwrite it. To opt into its
runtime values explicitly:

```bash
docker compose --env-file .env.local -p acgraph-foundation config --quiet
docker compose --env-file .env.local -p acgraph-foundation up -d --build --wait app
```

Only the named runtime settings in `compose.yaml` are passed to containers;
no environment file is copied into the image. Shell variables take precedence.
Enabling Anthropic can incur provider charges. Leave the key empty for a no-paid-API
setup and all verification. Docker daemon administrators can inspect container
environment variables, so this is not a secret manager. Avoid sharing plain
`docker compose config`, `docker inspect` environment output or private logs;
use `config --quiet` for validation.

## Optional PostgreSQL

**PostgreSQL is a future backend sandbox, not current application persistence.**
There is no database client, `DATABASE_URL`, schema, migration or `depends_on`
connecting the app to it. The app starts independently. Nothing below moves
diagrams out of the browser or enables accounts, collaboration or server backups.

The `postgres` profile uses `postgres:17.11-bookworm`, pinned to index digest
`sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0`
(verified on 2026-09-08). It is off by default and is not started by CI.

Before its first start, configure a unique `POSTGRES_PASSWORD` privately in the
shell or the ignored environment file. There is deliberately no default password
or trust authentication. With no password, the official entrypoint refuses to
initialize an empty database. Compose still validates with the profile disabled;
`config --quiet` checks structure, not credential validity.

```bash
docker compose --env-file .env.local -p acgraph-foundation --profile postgres config --quiet
docker compose --env-file .env.local -p acgraph-foundation --profile postgres up -d --wait postgres
docker compose --env-file .env.local -p acgraph-foundation --profile postgres ps
docker compose --env-file .env.local -p acgraph-foundation --profile postgres exec postgres \
  pg_isready -h 127.0.0.1 -U acgraph -d acgraph
```

The database and bootstrap superuser are both `acgraph`, and the host port is
`127.0.0.1:55432` (`POSTGRES_PORT` overrides the port, never the loopback binding).
This is not a least-privilege production database setup. Its named volume is
`acgraph-foundation_postgres-data`, mounted at `/var/lib/postgresql/data`.
Changing `POSTGRES_PASSWORD` does not rotate credentials in an initialized volume;
use PostgreSQL's credential rotation procedure instead. Backups, migrations,
dedicated app roles and major-version upgrades are not configured.

## Stop safely

```bash
# Pause only the app, keeping the container.
docker compose -p acgraph-foundation stop app

# Remove this project's app container/network, keeping any volumes.
docker compose -p acgraph-foundation down --timeout 30

# If the optional database was started, include its profile to stop both services.
docker compose -p acgraph-foundation --profile postgres down --timeout 30
```

Keep the same `--env-file` option if one was used at startup. Shutdown allows 30
seconds for in-flight requests; Compose's init process forwards signals and reaps
children. Normal shutdown does not delete database volumes or browser diagrams.
Do not use `down -v`, `docker system prune`, `docker volume prune` or global cleanup
commands as a routine stop. No cleanup should touch another project's resources.

## Verification and limits

CI runs types (including generated route types), formatting, unit tests, lint,
production build and the critical Chromium suites: library/persistence, editor,
YAML code, imports, sharing/embeds and AI-disabled behavior. Playwright starts and
stops its own production server on 3100, never reuses `next dev`, and clears the
API key for its managed process. Locally it builds first; CI reuses its preceding
build. Next 16 isolates `.next/dev` from production `.next`, but two production
builds must not run concurrently in one checkout.

An explicit `E2E_BASE_URL` disables all Playwright server management. Only target a
disposable instance with AI disabled: tests clear browser storage and exercise AI
endpoints. The Docker CI job independently validates Compose, builds, waits for
health, checks non-root execution, HTML, a public SVG and generated static assets,
then removes only its own containers without removing volumes. It does not start
PostgreSQL, push an image or use cloud credentials.

Current limits:

- Diagrams, preferences and history live in browser IndexedDB/local storage,
  scoped to the exact origin (scheme, hostname and port). `localhost` and
  `127.0.0.1` are different origins. Browser cleanup can erase that data; export
  workspaces for backups. Container or database volumes do not back up diagrams.
- There is no authentication, server-side diagram repository or multi-user access
  control. Share links carry diagram data in their URL; treat them as sensitive.
- Loopback HTTP is a local operating baseline, not an internet-ready deployment.
  Before remote exposure, add TLS and a reverse proxy, request-size/time limits,
  authentication and appropriate rate limiting. AI rate limits are process-local.
- Next's runtime cache is ephemeral and per-container. Shared caching and
  multi-instance coordination are not configured.
- Builds need network access to Docker Hub, npm and Google Fonts used by the
  existing `next/font` configuration. Fonts are self-hosted after the build.
  There is no offline-build or vulnerability-scan guarantee; review image and
  dependency security updates before deployment.
