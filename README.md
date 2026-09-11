# AC Graph

AION Cloud's architecture diagram platform. Draw on a canvas, or write the
architecture as YAML and watch it draw itself — the two stay in sync. Run it
alone in a browser, or as a shared workspace behind the company's Authentik
sign-in where everyone sees the same diagrams and each other's cursors.

## Getting started

Use Node.js 24 LTS, pinned in `.nvmrc` (also used by CI and Docker).

```bash
nvm install
nvm use
npm ci
npm run dev
```

The editor is at http://localhost:3000. Nothing else is required: diagrams live
in the browser (IndexedDB) until the backend lands.

AI is optional. `.env.example` documents the private `.env.local` settings;
leave `ANTHROPIC_API_KEY` empty to keep AI disabled and avoid provider charges.
Never put real credentials in the tracked template.

## Docker

Docker Desktop (Linux containers) or Docker Engine with Compose is enough. No
cloud account, deployment, registry push or paid API is required.

```bash
docker compose config --quiet
docker compose up -d --build --wait app
curl --fail http://127.0.0.1:3080/api/health
docker compose down
```

Open http://127.0.0.1:3080. The production image uses a pinned Node 24 image,
Next.js standalone output, a non-root user and a healthcheck. Host ports bind
only to loopback. Docker does not read `.env.local` unless explicitly requested.

That is **local mode**: diagrams live in the browser's IndexedDB, a different
host or port is a different workspace, and there are no accounts.

**Server mode** — the shared, signed-in workspace — layers a second Compose
file on top and needs four settings (the database password, the Authentik
issuer and client id, and the public URL):

```bash
POSTGRES_PASSWORD=… OIDC_ISSUER=https://auth.example.com/application/o/ac-graph/ \
OIDC_CLIENT_ID=… APP_URL=http://127.0.0.1:3080 \
docker compose -f compose.yaml -f compose.server.yaml -p acgraph-foundation up -d --build --wait
```

Diagrams then live in PostgreSQL, every route demands an Authentik session, and
editors of the same diagram see each other live. Set-up of the Authentik
provider and what server mode does not do yet are in
[docs/AUTHENTIK.md](docs/AUTHENTIK.md); ports, private runtime configuration
and safe shutdown are in [docs/DOCKER.md](docs/DOCKER.md).

In both modes the server logs one JSON record per request (with a request id
that is also returned as `x-request-id`), serves Prometheus metrics at
`/api/metrics`, and exports OpenTelemetry traces when
`OTEL_EXPORTER_OTLP_ENDPOINT` names a collector. Details and the variables
(`LOG_LEVEL`, `LOG_FORMAT`, `METRICS_TOKEN`, `OTEL_*`) are in
[docs/DOCKER.md](docs/DOCKER.md#logs-metrics-and-traces).

## What it does

- **572 cloud services** across AWS, Azure, Google Cloud, Oracle Cloud, IBM
  Cloud and generic infrastructure, browsable by provider and by functional area
  rather than as one long list.
- **Switch cloud in one click.** Every service is mapped to its equivalent role
  in the other providers, so an AWS diagram becomes a GCP one and anything with
  no equivalent is reported rather than silently changed.
- **Diagram as code.** A YAML DSL compiles to a diagram and back, losslessly,
  positions included. Edit either side; whichever has focus wins.
- **Generate with AI.** Describe a system and get a diagram, or ask what the one
  on screen is missing. A generated diagram is one undo step away from gone.
- **Export** from the top bar to PNG, SVG, PDF, Markdown, Mermaid, YAML and
  JSON. Image and document exports show the current view, on the editor's theme
  or one chosen for paper, with or without the metadata chips; the JSON is the
  whole model. Files are self-contained — icons and the logo are inlined — and
  the SVG carries a spoken description of the diagram, as the canvas does for
  screen readers. A repository chip that names a host is a link, in the editor
  and in the export.
- **Write on it.** A region tints the part of the picture you are talking
  about, a note is a square of yellow paper with `**bold**`, bullets and
  headings, a text is a caption with nothing behind it. None of them is a
  service: the analysis, the cloud switch and the arrows leave them alone, the
  YAML keeps them in a `notes:` section, and the export draws them as the
  screen does.
- **Keep it as a starting point.** More › Save as template puts a copy of the
  diagram among the templates on the home page, drawn for real, with edit and
  delete on hover; start from it as from any of the built-in ones, and in
  server mode share it by inviting people, like a diagram.
- **Present it.** `F5` (or More › Present) drops every panel and bar and shows
  the diagram alone on the theme's background: arrow keys step through the
  views with the camera gliding between them, a legend names the tones on
  screen, `Esc` brings the editor back where it was. The Export menu can write
  one PDF page per view.
- **Work together.** In server mode every diagram lives in PostgreSQL and every
  editor is live: you see who is in the room, where their cursor is, and their
  saves land on your canvas as one undo step. Two people saving over each other
  is detected, never merged silently — the loser chooses whose version to keep.
- **A library that keeps up.** Sort by recent edit, name or creation, star what
  matters, and drop any file on the page — a project export, YAML, Mermaid,
  Terraform, a Kubernetes manifest, OpenAPI or a Markdown outline — to import it.
- **One icon library for the team.** In server mode an icon anyone uploads
  is kept for the whole workspace, stored once however many times it is
  uploaded, and offered to every editor; in the browser-only mode the library
  is the browser's. Either way a diagram embeds the icons it uses.
- **Decide who is in.** A diagram is the owner's until they share it: from the
  Share dialog they add people by e-mail as editors or viewers, change roles or
  remove them, and the change reaches the other person's screen at once. A
  viewer gets the whole editor read-only — every property, every export, live
  presence — and nothing that writes.
- **Sign in with the company account.** Authentik (OpenID Connect) is the only
  identity; there are no local passwords. See [docs/AUTHENTIK.md](docs/AUTHENTIK.md).
- **Official icons.** AWS, Google Cloud and IBM Cloud services draw with the
  vendors' own architecture artwork, vendored under `vendor/icons` with
  per-symbol provenance in `src/data/iconSources.json`.
- **Import what already exists.** Paste a Terraform plan or `main.tf`,
  Kubernetes manifests or an OpenAPI description and get the architecture — one
  box, no format to choose. Each reader produces a DSL document and lets the
  compiler do the rest, so an import is editable as code the moment it lands.
- **Share a link.** The diagram travels compressed inside the URL, so a link
  works with no account and no server holding your data. `/api/embed` renders it
  to SVG server-side for embedding, and the README snippet is a Mermaid block,
  which GitHub renders natively.

## Keyboard

Every binding is declared once in `src/lib/editor/shortcuts.ts`; the handler,
the palette hints and the `?` sheet all read that table, so they cannot drift.

|                     |                                                             |
| ------------------- | ----------------------------------------------------------- |
| `⌘K`                | Command palette: services and commands                      |
| `⌘E`                | Export menu · `⌘S` JSON · `⌘⇧S` share                       |
| `⌘J`                | AI assistant                                                |
| `⌘/` `⌘B` `⌘H` `⌘I` | Code panel, service browser, history, insights              |
| `V B U G I C H`     | Select, boundary, sub-boundary, group, item, connector, pan |
| `R N T`             | Region, note, text                                          |
| `Space` + drag      | Pan · `⌘` + wheel zooms at the cursor                       |
| `⌘1` / `⌘0`         | Fit to view / reset zoom                                    |
| `F5`                | Present · `←` `→` step through views · `Esc` leaves         |
| `⌘⇧L`               | Auto-layout · `⌘⇧D` theme · `⌘'` grid · `⌘M` minimap        |
| `?`                 | Every shortcut, spelled for your platform                   |

## The DSL

```yaml
version: 1
cloud: aws
boundaries:
  vpc: { label: Production VPC }
nodes:
  cdn: cloudfront
  api: { service: apigateway, label: Public API, in: vpc }
  fn: { service: lambda, in: vpc }
edges:
  - cdn -> api: HTTPS
  - api -> fn: invoke
layout:
  cdn: [80, 80]
```

`cloud` resolves unprefixed service names, so retargeting a whole diagram is a
one-line change. `layout` is written by the canvas and pins manual positions;
leave it out and the layered auto-layout decides.

## The service catalogue

The catalogue and the cross-cloud equivalence table are generated from a master
list of cloud services:

```bash
node scripts/buildData.mjs  path/to/cloud-services-master-list.md
node scripts/buildIcons.mjs path/to/cloud-services-master-list.md
```

Both read their baseline from the last commit rather than the working tree, so
re-running cannot feed on its own output. Nothing is ever removed: stored
diagrams reference service keys, so the build is a union of what the app already
has and what the list adds.

Icons come from three places, in order: the symbols the app already shipped, the
official AWS architecture icon set, and — for Azure, Google Cloud, Oracle and
IBM, where no equivalent artwork is redistributable — a generated mark carrying
the provider's colour and the service's category, drawn in the same idiom as the
official ones.

## From the terminal

The same library the editor runs on, as a command. `check` is the one that
matters: an architecture a pipeline can read is an architecture that can fail a
build, which is what stops a diagram quietly stopping being true.

```bash
npx ac-graph check main.tf                 # analyse; exits non-zero on findings
npx ac-graph check arch.yaml --rules standards.yaml --fail-on medium --json
npx ac-graph import k8s/deployment.yaml -o architecture.yaml
npx ac-graph diff before.yaml after.yaml   # non-zero when anything moved
npx ac-graph mermaid arch.yaml             # for a pull request or a README
npx ac-graph fmt arch.yaml                 # canonical form, in place
```

Every command detects what it was handed, so `check main.tf`, `check
deployment.yaml` and `check openapi.json` all work without a flag. Findings come
out as a kind and its values under `--json`, never as a sentence, so a pipeline
that greps them does not break when somebody runs it with `--lang es`.

There is deliberately no `render`: the SVG is drawn by the same React components
the canvas uses, and a second renderer written for the terminal would drift from
what the editor shows.

## From an agent

An MCP server over stdio, so the architecture is queryable from Claude Code,
Cursor or anything else that speaks the protocol.

```json
{
  "mcpServers": {
    "ac-graph": { "command": "npx", "args": ["ac-graph-mcp"] }
  }
}
```

| Tool                   | Answers                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `read_architecture`    | What services exist, what connects them, what metadata they carry          |
| `analyze_architecture` | Cycles, single points of failure, orphans, coupling, ownership, data flows |
| `analyze_impact`       | What breaks if this service goes away                                      |
| `search_components`    | Which catalogue key is the right one                                       |
| `diff_architecture`    | What moved between two versions                                            |
| `write_architecture`   | Propose a change — refused unless it compiles                              |
| `to_mermaid`           | A diagram for a pull request                                               |

Both run the library directly under Node's TypeScript stripping, with a
twenty-line resolver in `bin/hooks.mjs` teaching Node the two import rules Next
uses. That is the whole cost of not keeping a second copy of the library, or a
bundler, for the sake of a binary.

## Standards, made executable

A team already has architecture rules — production services name an owner,
nothing but payments talks to the ledger, customer data never travels
unauthenticated. They live in a wiki page nobody reads and a reviewer's memory.
Written into the document, they are checked by the editor, failed on by CI and
answerable by an agent.

```yaml
rules:
  - id: prod-needs-owner
    description: Every production service names the team that answers for it.
    services: { environment: prod }
    require: { owner: true }

  - id: ledger-is-private
    description: Only the payments service talks to the ledger.
    links: { to: { tag: database } }
    forbid: true
    except: { from: { owner: payments } }

  - id: pci-authenticated
    description: Card data never travels unauthenticated.
    links: { dataClass: [pci, pii] }
    require: { auth: true }
```

A rule is about `services` or about `links`, and either **requires** something
of what it matches or **forbids** the match existing. A matcher is a value, a
list of allowed values, `true` for "is set at all", or a cloud prefix like
`aws-`. `description` is the team's own sentence and is shown verbatim, in
whatever language it was written in — it is the one piece of copy in the app
that belongs to the data rather than to the interface.

Rules that match nothing are reported separately. A rule with a typo in its
selector passes trivially and looks exactly like a rule that is working, which
is the most common way a standard silently stops being enforced. For the same
reason an unreadable rule is refused rather than narrowed: every field name is
checked against what the model actually knows.

`ac-graph check --rules standards.yaml` adds an organisation-wide file on top of
whatever a document declares for itself.

## Architecture

```
src/lib/domain/   Zod schemas — the single source of truth for every type
src/lib/engine/   Pure geometry, routing, layout. No browser APIs, so it can
                  render on a server for embeds.
src/lib/dsl/      YAML and Mermaid, in and out
src/lib/import/   Terraform, Kubernetes and OpenAPI, each into a DSL document
src/lib/rules/    Declarative standards, and checking a model against them
src/lib/ai/       Prompts, output schema, rate limiting
src/lib/share/    Link codec and share/embed URLs
src/lib/store/    DiagramRepository — the only I/O boundary in the app
src/lib/editor/   Reducer, viewport maths, export
src/components/   The editor: canvas, floating chrome, code panel
src/app/api/      Route handlers: AI (the only place the API key exists), the
                  server-rendered embed, and in server mode the diagram API,
                  sessions and live events; /api/health and /api/metrics
src/server/       Server mode: PostgreSQL repository, OIDC sessions, presence
                  and live events shared between replicas over LISTEN/NOTIFY,
                  and observability (JSON logs, Prometheus metrics, optional
                  OpenTelemetry traces) behind one request wrapper
src/instrumentation.ts  Next.js start-up hook: logger, metrics, traces
bin/              The CLI and the MCP server, over the same library
```

Two rules hold the shape:

**The UI never touches I/O.** Everything goes through `DiagramRepository`, which
is async today over IndexedDB and will be the same interface over an API.

**The engine never touches the browser.** That is what lets `/api/embed` render
an image with the same code the canvas draws with — no headless browser, and no
way for an embed to drift from what the author saw.

## Commands

```bash
npm run dev          # development server
npm run build        # production build
npm run start        # serve standalone output after build, including assets
npm test             # unit tests
npm run test:e2e      # builds and manages its own production server on 3100
npm run test:e2e:critical # library, editor, code, import, share and AI-disabled flows
npm run typecheck    # next typegen + tsc --noEmit
npm run lint
npm run format
npm run cli -- check arch.yaml   # the CLI, without installing it
npm run mcp                      # the MCP server, on stdio
```

Install Chromium once with `npx playwright install chromium`. Playwright does not
reuse `next dev` or an occupied port. Next 16 separates production output (`.next`)
from development output (`.next/dev`). CI builds first, then Playwright starts
that build. Do not run multiple production builds against the same checkout.

To test an already running **disposable, AI-disabled** server instead, set
`E2E_BASE_URL=http://127.0.0.1:3080 npm run test:e2e:critical`. With an explicit URL,
Playwright does not build, start or stop a server. The tests clear browser storage;
never point them at a real user workspace or a deployment with paid AI enabled.

CI checks types, formatting, unit tests, lint, a production build and the critical
Chromium flows. A separate Docker job builds the image and checks non-root
execution, health, HTML, public files and generated static assets without cloud
credentials or a database.

## Where the work stands

- `docs/CONTEXTO.md` — how to resume: environment, commands, decisions, limits, next step.
- `docs/CHECKPOINTS.md` — every delivery, what was verified, what is left.
- `docs/PLAN_MEJORAS.md` — the improvement plan in three horizons, with status.
