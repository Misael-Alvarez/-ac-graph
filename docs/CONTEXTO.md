# Contexto de trabajo — cómo retomar AC Graph

Última actualización: 2026-09-10 (H1 cerrado del todo, incluida la fase 2 de componentes de sistema, pendiente de commit; victorias rápidas en `origin/main`).

Este documento existe para que una sesión nueva — una persona o un agente — pueda continuar exactamente donde se dejó sin redescubrir el entorno. Lo que aquí se dice se verificó en la máquina de desarrollo; lo que no se pudo verificar se marca como tal.

---

## 1. Qué es y dónde está

- **Producto:** AC Graph, editor de arquitecturas cloud para AION Cloud. Next 16.3.3 · React 19.2.8 · TypeScript · Zod · Immer · PostgreSQL opcional · OIDC (Authentik) opcional.
- **Repositorio:** `/Users/misaelalvarezcamarillo/Desktop/diagram-editor`, rama `main`, sincronizada con `origin/main` en `b195b01` (push del 2026-09-10). GitHub avisa de que el repositorio **se movió** a `https://github.com/Misael-Alvarez/-ac-graph.git`; el remoto local sigue apuntando a `Digraph.git` y funciona por redirección; actualizarlo con `git remote set-url origin` cuando el usuario lo pida.
- **Estado del árbol:** HEAD `e2fcc1d` con **H1 #2 fase 2 sin confirmar**: `src/components/ui/{Kbd,SearchField,Chip,GroupHeader,Tile,Row,Field,Section}.tsx` + `ui.test.ts`; explorador, selector (+`CustomIcons`), paleta, historial, análisis, menús, contextual, atajos, dock, estado vacío, biblioteca e inspector migrados; `TopBar.tsx` partido en `ExportMenu/MoreMenu/AccountMenu` (+`menuProps.ts`); `Library.tsx` partido en `LibraryHeader/LibraryHero/LibraryToolbar/DiagramCard/TemplateGallery`. `styles:compare` = 0 diferencias. Commits de esta etapa, por tema:
  - `d3e1e40` — Make the build reproducible and the image safe to ship
  - `af03dd8` — Never lose a change, and make undo mean what it says
  - `c056a10` — Run it for a team: PostgreSQL, single sign-on and a live room
  - `c7a6a9b` — Draw what the diagram knows, and let people bring their own icons
  - `b7f0a92` — Give the interface one face, one material and one anatomy
  - `dd5fcdb` — Verify the interface the way it is used: every control, every pixel, every property
  - `69408f2` — Write down where the work stands and how to pick it up
  - `c03cf6e` — Record the checkpoint's commits in the context and the checkpoint log
  - `f12fdb2` — See what the server is doing: one id per request, one line per request, metrics and traces
  - `9db935a` — Let replicas share the room: presence and events over LISTEN/NOTIFY
  - `c3afefa` — Decide who is in: owners, editors and viewers per diagram
  - `b195b01` — Seven small things the plan had waiting
  - `e2fcc1d` — Record where the work stands after the quick wins
- **Idioma de trabajo con el usuario:** español. Código y comentarios en inglés.

## 2. Documentos y su papel

| Documento                                          | Para qué                                                                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/PLAN_MAESTRO.md`                             | Plan de fases F0–F9 (visión completa). Estado real por fase en `CHECKPOINTS.md`.                                                                                |
| `docs/CHECKPOINTS.md`                              | Registro de cada entrega: qué, cómo se verificó, límites. **Fuente de verdad del avance.**                                                                      |
| `docs/PLAN_MEJORAS.md`                             | Plan detallado en tres horizontes (H1 consolidar · H2 producto de equipo · H3 plataforma) con backlog por área, victorias rápidas, métricas. Marca ✅ lo hecho. |
| `docs/PLAN_DISENO.md`                              | Anatomía "Aurora": una sola anatomía de panel/fila/celda/campo para todas las superficies.                                                                      |
| `docs/AUTHENTIK.md`, `docs/DOCKER.md`, `README.md` | Operación: modo servidor, provider OIDC, contenedores; `DOCKER.md` § "Logs, metrics and traces" describe logs, `/api/metrics` y trazas.                         |
| `AGENTS.md`                                        | Exige leer `node_modules/next/dist/docs/` antes de escribir código Next (APIs distintas a las conocidas).                                                       |

## 3. Entorno y comandos

- Node del host: v25.5.0; el proyecto fija `>=24.20.0 <25` (`.nvmrc` 24.20.0). Funciona con 25 en la práctica; CI usa 24.
- **Puertos:** `next dev` 3000 · servidor de pruebas 3100 (`127.0.0.1`) · Docker 3080 (loopback) · PostgreSQL 55432.
- **Nunca** ejecutar `node .next/standalone/server.js` a mano tras un build: `npm start` copia `public` y `.next/static` al standalone; sin eso los chunks dan 404 y la página queda en "Cargando…".

```bash
# Verificación completa (orden habitual)
npm run typecheck && npm run format:check && npm run lint && npm test && npm run build

# Servidor de pruebas externo (evita que Playwright levante uno por worker)
(PORT=3100 HOSTNAME=127.0.0.1 ANTHROPIC_API_KEY= nohup npm start > /tmp/acgraph-3100.log 2>&1 &)
kill $(lsof -tnP -iTCP:3100 -sTCP:LISTEN)     # para pararlo

# E2E funcionales (136), visuales (24) y auditoría de controles (83)
E2E_BASE_URL=http://127.0.0.1:3100 npm run test:e2e
E2E_BASE_URL=http://127.0.0.1:3100 npm run test:visual          # compara con e2e/__screenshots__
E2E_BASE_URL=http://127.0.0.1:3100 npm run test:visual:update   # acepta nuevas líneas base (decisión humana)
npm run audit:controls -- http://127.0.0.1:3100

# Cambios de CSS: exactitud propiedad a propiedad
npm run styles:snapshot -- /tmp/antes.json        # con el build anterior sirviendo en 3100
# … cambiar CSS, npm run build, reiniciar 3100 …
npm run styles:snapshot -- /tmp/despues.json
npm run styles:compare -- /tmp/antes.json /tmp/despues.json   # debe dar 0

# Observabilidad (con el servidor de 3100 arriba)
curl -si http://127.0.0.1:3100/api/health | grep -i x-request-id          # id por respuesta
curl -s  http://127.0.0.1:3100/api/metrics | grep '^acgraph_'              # Prometheus
grep '"msg":"http request"' /tmp/acgraph-3100.log                          # líneas de acceso JSON
# Trazas: OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 al arrancar; colector falso de prueba en
# /var/folders/wy/kf7vlr0s0013stp8jdglkst80000gn/T/opencode/fake-otlp.mjs (temporal; GET /dump lista spans)

# Auditoría de roles (modo servidor, dos navegadores; siembra y limpia sus propios usuarios/sesiones)
AUDIT_DATABASE_URL=postgres://postgres:test@127.0.0.1:55433/acgraph_test npm run audit:roles -- http://127.0.0.1:3100
# (el servidor debe correr en modo servidor contra esa misma base: DATABASE_URL + OIDC_ISSUER + OIDC_CLIENT_ID + APP_URL)

# PostgreSQL desechable para las pruebas *.pg.test.ts (se destruye al parar)
docker run -d --rm --name acgraph-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=acgraph_test -p 127.0.0.1:55433:5432 postgres:17.11-bookworm
TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55433/acgraph_test npm test
docker stop acgraph-test-pg

# Docker (proyecto acgraph-foundation; no tocar contenedores consultoria-*)
docker compose -p acgraph-foundation build app
ANTHROPIC_API_KEY= docker compose -p acgraph-foundation up -d --no-build --wait --wait-timeout 90 app
# Modo servidor: -f compose.yaml -f compose.server.yaml con DATABASE_URL, OIDC_ISSUER, OIDC_CLIENT_ID, APP_URL
```

- Con dos workers de Playwright y servidor externo la máquina va bien; con `webServer` automático y 5 workers se cuelga.
- Firefox de Playwright está instalado (`playwright install firefox`); el navegador por defecto del usuario es Firefox. Los bugs reportados por el usuario conviene reproducirlos ahí además de en Chromium.
- Capturas de verificación en `/var/folders/wy/kf7vlr0s0013stp8jdglkst80000gn/T/opencode/shots/` (temporal; regenerables).

## 4. Estado del contenedor

`acgraph-foundation-app-1` en **modo local** en http://127.0.0.1:3080 con la imagen reconstruida el 2026-09-10 en `b195b01` (H1 completo y victorias rápidas; `/api/config` → `{"mode":"local"}`; `docker compose -p acgraph-foundation logs --no-log-prefix app` muestra JSON; `/api/metrics` responde; en modo local `acgraph_collab_bus_connected` es 0 porque el bus es en memoria). El volumen `postgres-data` del proyecto tiene contraseña desconocida en esta sesión (no hay `.env.local`); para pruebas se usa el contenedor desechable de la sección 3. El pie de la portada y el menú de cuenta muestran el **sello de compilación** (`NEXT_PUBLIC_BUILD_STAMP`): si la hora no coincide con el último build, el navegador sirve caché (`Cmd+Shift+R`). Volumen `postgres-data` conserva usuarios/sesiones semilla (Ana Torres, Luis Pérez; ids en `/var/folders/wy/kf7vlr0s0013stp8jdglkst80000gn/T/opencode/sessions.json`, temporal).

## 5. Decisiones que no hay que rediscutir

- **Barra de herramientas a la izquierda, vertical.** Se probó abajo al centro y el usuario la rechazó. No moverla.
- **Todo control cambia algo observable.** Nada de adorno; cada control nuevo entra en `scripts/audit-controls.mjs`.
- **Metadatos visibles en el lienzo:** cada campo del inspector tiene su marca (chips en servicios, etiquetas y trazo en conectores). Si se añade un campo, se añade su marca.
- **Deshacer:** ráfagas coalescidas (`coalesceKey`), Cmd+Z desde campos cae al dibujo, historial vacío avisa. No romperlo.
- **Iconos propios** viven en el navegador y se **embeben en el documento** al usarse (`model.customIcons`), para que enlaces y exportaciones los lleven.
- **CSS:** un solo `globals.css` en orden de cascada; cada selector una vez salvo los _cascade-pinned_ (comentados). **No añadir capas de sobrescritura al final**; cambiar la regla donde está y verificar con `styles:compare`.
- **Componentes de sistema (`src/components/ui/`):** `PanelHead`, `SearchField`, `Chip`/`ChipRow`, `GroupHeader`, `Tile` (+`SpriteIcon`), `Row`, `Field`/`NumberField`, `Section`, `Kbd`. Una fila, tesela, chip o cabecera nueva se hace con ellos; las clases propias de la superficie van por props (`className`, `labelClassName`, `countClassName`) porque el CSS y las pruebas las nombran. `ui.test.ts` fija el HTML exacto: si cambia el marcado, cambia el test a conciencia y se pasa `styles:compare`. La instantánea de estilos identifica cada elemento por etiqueta + clases + posición: no envolver en nodos nuevos.
- **Tokens:** `tokens.ts` ↔ `globals.css` en paridad (test). Acento por tono (`data-accent`): violeta AION, índigo, grafito, océano, rosa.
- **Tipografía:** Geist / Geist Mono autoalojadas. Paleta pizarra-azul (`#0b1020 / #121a2e / #1a2440`).
- **Movimiento:** lo que abre el teclado no se anima (paleta ⌘K); popovers crecen desde su disparador; tooltips propios (instantáneos entre vecinos, nunca repiten la etiqueta visible); todo sobre transform/opacity; apagado con `prefers-reduced-motion`; materiales respetan `prefers-reduced-transparency` y `prefers-contrast`. **Salidas**: todo lo que entra animado sale animado y más corto (diálogos 140 ms, menús/popovers 120 ms, toast 180 ms) con `usePresence` + keyframes `*-out`; al añadir una superficie nueva, envolver su estado de apertura con `usePresence` y usar `presence.key` para que reabrir empiece limpio.
- **Sin virtualización de listas:** explorador y selector muestran una nube (≤128 filas) o ≤120 resultados; `content-visibility: auto` se probó y se retiró (hace saltar el scroll). No reabrir salvo que las listas crezcan de verdad.
- **Enlaces en chips:** solo cuando el valor nombra un host (`repositoryUrl`); `org/repo` es etiqueta. No adivinar forges.
- **Authentik:** el provider `ac-graph` **no existe** aún; el usuario pidió no configurarlo por ahora. Cuando toque: `docs/AUTHENTIK.md` (redirect `${APP_URL}/api/auth/callback`, PKCE, RS256, `NODE_EXTRA_CA_CERTS` + `extra_hosts` para `auth.localhost`).
- **Roles por diagrama:** la autorización vive en `PgDiagramRepository` (nunca solo en la UI): cada lectura hace join con `diagram_members` del actor y cada escritura lee el rol con el `for update`. Extraño → `DiagramForbiddenError` (403 `no_access` con `owner.name`); inexistente → 404. El propietario es `owner_id` (una sola fila `owner`, intocable, sin transferencia). El editor de un lector es el editor completo con la escritura quitada: guarda única en `dispatch` (`guardDispatch`) **y** controles desactivados a la vista; al añadir un control que escribe, comprobar `readOnly` de `useEditor()` o `enabled` del comando. Los cambios de acceso viajan como evento `access` y el cliente reacciona en vivo. La sección «Personas» solo existe en modo servidor (`useMembersApi()`); se audita con `npm run audit:roles`, no con `audit:controls`.
- **Bus entre réplicas:** toda publicación viva pasa por `collaboration()` (`publish`/`touch`/`leave`), nunca por `events().publish` directo (solo entrega local). Un canal `acgraph_collab`, un `origin` por proceso, presencia como estado absoluto por sesión, eco propio ignorado. `LISTEN` necesita conexión directa a PostgreSQL (o pooler en modo sesión). Best effort por diseño: sin cola ni reenvío; el TTL de 15 s cura la presencia.
- **Observabilidad:** toda ruta API pasa por `observe(request, { route })` (`withUser`/`withServerMode` lo exigen). Al crear una ruta: declarar su plantilla (`/api/x/[id]`), nunca el path concreto; **ningún id como etiqueta de métrica** (hay prueba que lo comprueba); no registrar query string, cuerpo ni cabeceras; usar `log()` (nunca `console.*`) y `appMetrics()` para contadores nuevos, declarados en `metrics.ts`. Logger y registro Prometheus son propios (sin dependencia); el SDK de OTel solo se carga con `OTEL_EXPORTER_OTLP_ENDPOINT`. En tests, `captureLogs()` de `src/server/testing/logs.ts`; la suite arranca con `LOG_LEVEL=silent`.

## 6. Límites conocidos (no son bugs pendientes; son alcance)

- Bus de colaboración best effort (mensajes perdidos mientras una réplica tiene caída la conexión de escucha; sin cola). Un solo canal para todos los diagramas.
- Un solo workspace: sin equipos ni roles de workspace, la propiedad no se transfiere; invitar exige que la persona haya iniciado sesión una vez (H3 #23).
- Sin CRDT: colaboración = presencia + adopción de guardados ajenos + conflicto 412 con banner.
- Biblioteca de iconos propios por navegador (no se sincroniza en modo servidor) — H2 #14.
- Azure y OCI sin iconos oficiales (313/572) — H2 #15.
- Etiquetas de conector centradas en el segmento más largo; pueden pisar un borde de grupo — H2 #11.
- Métricas por proceso (Prometheus agrega por `instance`); sin alertas ni envío a colector (decisión del operador). Las rutas de IA no llevan `code` en la línea de acceso (responden con `NextResponse.json` propio).
- La paleta ⌘K conserva su búsqueda propia (`palette-search`) y el menú contextual su fila (`context-menu-item`): unificarlos con `SearchField`/`MenuItem` cambiaría el DOM. `useCommands.ts` (~300 líneas) sigue siendo un solo hook.
- E2E: 1 spec de biblioteca puede fallar en paralelo por IndexedDB compartido (pasa aislado); ver `PLAN_MEJORAS.md` H1 #3 (aislar por worker sigue pendiente aunque el falso intermitente se corrigió).

## 7. Dónde está cada cosa (mapa rápido)

- Modelo y motor: `src/lib/domain`, `src/lib/engine` (layout, routing, colisiones, clipboard, diff, vistas, análisis).
- Reducer e historial: `src/lib/editor/reducer.ts`, `actions.ts` (`coalesceKey`), `uiState.ts` (paneles, menú, acento, find).
- Guardado: `src/lib/store/{saveCoordinator,draftJournal,draftSession,localRepository,httpRepository}.ts`; `useDiagramDocument.ts`.
- Lienzo: `src/components/editor/canvas/` (`Canvas.tsx` encuadre y cámara que se desliza, `ConnectorLayer.tsx`, `shapes/`, `Defs.tsx`); metadatos → marcas: `src/lib/editor/meta.ts`.
- Chrome: `src/components/editor/chrome/` (`TopBar` + `ExportMenu`/`MoreMenu`/`AccountMenu`/`menuProps.ts`, `ToolDock`, `InspectorPanel` + `inspector/`, `ServiceBrowser`, `IconPicker`, `CustomIcons`, `CommandPalette`, `FindBar`, `VersionPanel`, `InsightsPanel`, `Minimap`, `Modals`); componentes de sistema en `src/components/ui/`.
- Iconos propios: `src/lib/icons/{customIcons,iconLibrary}.ts`.
- Portada: `src/components/library/Library.tsx` (estado y composición) + `LibraryHeader`, `LibraryHero`, `LibraryToolbar` (exporta `FAVOURITES`/`NO_FOLDER`), `DiagramCard`, `TemplateGallery` (exporta `TemplatePreview`), `WorkspaceActions`, `CountUp`; vista previa real `src/lib/store/preview.ts`.
- App: `src/components/app/` (providers, tooltips, ripple, tema, `PageState` para 404/error).
- Victorias rápidas: `src/lib/editor/describe.ts` (descripción accesible), `src/lib/editor/usePresence.ts` (salidas), `src/lib/library/{prefs,dropImport}.ts` (orden/favoritos, soltar archivo), `repositoryUrl`/`stripMetadata` en `src/lib/editor/meta.ts`, `exportTheme`/`exportMeta` en `uiState.ts`.
- Servidor: `src/server/**`, rutas `src/app/api/**`; CLI y MCP en `bin/`. Colaboración: `src/server/collab/{events,presence,stream,bus,collaboration}.ts` (hub local, roster, SSE, transporte `LISTEN/NOTIFY`, coordinador por réplica). Roles: `src/server/diagrams/{repository,errors,schemas}.ts`, rutas `src/app/api/diagrams/[id]/members/**`, cliente `src/lib/store/httpRepository.ts` (`MembersApi`), solo lectura `src/lib/editor/readOnly.ts` + `readOnly` en `EditorProvider`, UI `ShareDialog.tsx` (`SharePeople`) y `Library.tsx`.
- Observabilidad: `src/server/observability/{context,log,metrics,request,tracing,startup}.ts`, `src/instrumentation.ts` (hooks de Next), `src/app/api/metrics/route.ts`, `readObservabilityEnv` en `src/server/env.ts`, helper de tests `src/server/testing/logs.ts`.
- Herramientas: `scripts/{audit-controls,audit-roles,style-snapshot,css-match-map,consolidate-css}.mjs`, `scripts/lib/tour.mjs`.
- Pruebas: `src/**/*.test.ts` (1155; 1212 con `TEST_DATABASE_URL`), `e2e/*.spec.ts` (136 funcionales + `visual.spec.ts` 24), líneas base en `e2e/__screenshots__/`.

## 8. Siguiente paso recomendado

Orden sugerido (del `PLAN_MEJORAS.md`):

1. **Confirmar H1 #2 fase 2** en un commit y `git push`; reconstruir la imagen Docker local.
2. **H1 cerrado del todo.** Seguir por `PLAN_MEJORAS.md` con H2: #10 presentación (M), #12 notas/texto/regiones (L, primer paso de F2), #20 plantillas propias (S), #14 iconos en servidor (M), #9 comentarios anclados (L), #11 conectores editables (L).

Antes de cualquier entrega: verificación completa (sección 3), capturas antes/después en ambos temas, entrada en `CHECKPOINTS.md`.
