# AC Graph

A cloud architecture diagram editor for developers. Draw on a canvas, or write
the architecture as YAML and watch it draw itself — the two stay in sync.

## Getting started

```bash
npm install
npm run dev
```

The editor is at http://localhost:3000. Nothing else is required: diagrams live
in the browser (IndexedDB) until the backend lands.

To enable the AI features, copy `.env.example` to `.env.local` and set
`ANTHROPIC_API_KEY`. Without it everything else works and the AI panel says it
is unavailable.

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
- **Export** to SVG, PNG, Markdown and Mermaid. Exported files are entirely
  self-contained — icons and logos are inlined, so they render anywhere.
- **Import what already exists.** Paste a Terraform plan or `main.tf`,
  Kubernetes manifests or an OpenAPI description and get the architecture — one
  box, no format to choose. Each reader produces a DSL document and lets the
  compiler do the rest, so an import is editable as code the moment it lands.
- **Share a link.** The diagram travels compressed inside the URL, so a link
  works with no account and no server holding your data. `/api/embed` renders it
  to SVG server-side for embedding, and the README snippet is a Mermaid block,
  which GitHub renders natively.

## Keyboard

|                |                                                        |
| -------------- | ------------------------------------------------------ |
| `⌘K`           | Command palette: services and commands                 |
| `⌘J`           | AI assistant                                           |
| `⌘/`           | Split code view                                        |
| `V B U G I C`  | Select, boundary, sub-boundary, group, item, connector |
| `Space` + drag | Pan · `⌘` + wheel zooms at the cursor                  |
| `⌘1` / `⌘0`    | Fit to view / reset zoom                               |
| `?`            | Every shortcut                                         |

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
npx ac-graph check arch.yaml --fail-on medium --json
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

## Architecture

```
src/lib/domain/   Zod schemas — the single source of truth for every type
src/lib/engine/   Pure geometry, routing, layout. No browser APIs, so it can
                  render on a server for embeds.
src/lib/dsl/      YAML and Mermaid, in and out
src/lib/import/   Terraform, Kubernetes and OpenAPI, each into a DSL document
src/lib/ai/       Prompts, output schema, rate limiting
src/lib/share/    Link codec and share/embed URLs
src/lib/store/    DiagramRepository — the only I/O boundary in the app
src/lib/editor/   Reducer, viewport maths, export
src/components/   The editor: canvas, floating chrome, code panel
src/app/api/      Route handlers: AI (the only place the API key exists) and
                  the server-rendered embed
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
npm test             # unit tests
npm run test:e2e     # end-to-end tests (needs the dev server running)
npm run typecheck    # tsc --noEmit
npm run lint
npm run format
npm run cli -- check arch.yaml   # the CLI, without installing it
npm run mcp                      # the MCP server, on stdio
```
