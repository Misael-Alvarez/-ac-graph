# Contexto de trabajo — cómo retomar AC Graph

Última actualización: 2026-09-09 (cierre de H1 del plan de mejoras).

Este documento existe para que una sesión nueva — una persona o un agente — pueda continuar exactamente donde se dejó sin redescubrir el entorno. Lo que aquí se dice se verificó en la máquina de desarrollo; lo que no se pudo verificar se marca como tal.

---

## 1. Qué es y dónde está

- **Producto:** AC Graph, editor de arquitecturas cloud para AION Cloud. Next 16.3.3 · React 19.2.8 · TypeScript · Zod · Immer · PostgreSQL opcional · OIDC (Authentik) opcional.
- **Repositorio:** `/Users/misaelalvarezcamarillo/Desktop/diagram-editor`, rama `main`, 5 commits por delante de `origin/main` (base `e28174b`).
- **Estado del árbol:** ~172 archivos modificados o nuevos **sin commit**. Todo el trabajo de las entregas registradas en `CHECKPOINTS.md` desde CP0 vive en el árbol de trabajo. El usuario no ha pedido commits; se ha ofrecido agruparlos por tema (Docker/CI · servidor · diseño · deshacer · iconos propios · Aurora · herramientas de estilo).
- **Idioma de trabajo con el usuario:** español. Código y comentarios en inglés.

## 2. Documentos y su papel

| Documento                                          | Para qué                                                                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/PLAN_MAESTRO.md`                             | Plan de fases F0–F9 (visión completa). Estado real por fase en `CHECKPOINTS.md`.                                                                                |
| `docs/CHECKPOINTS.md`                              | Registro de cada entrega: qué, cómo se verificó, límites. **Fuente de verdad del avance.**                                                                      |
| `docs/PLAN_MEJORAS.md`                             | Plan detallado en tres horizontes (H1 consolidar · H2 producto de equipo · H3 plataforma) con backlog por área, victorias rápidas, métricas. Marca ✅ lo hecho. |
| `docs/PLAN_DISENO.md`                              | Anatomía "Aurora": una sola anatomía de panel/fila/celda/campo para todas las superficies.                                                                      |
| `docs/AUTHENTIK.md`, `docs/DOCKER.md`, `README.md` | Operación: modo servidor, provider OIDC, contenedores.                                                                                                          |
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

# E2E funcionales (136), visuales (24) y auditoría de controles (69)
E2E_BASE_URL=http://127.0.0.1:3100 npm run test:e2e
E2E_BASE_URL=http://127.0.0.1:3100 npm run test:visual          # compara con e2e/__screenshots__
E2E_BASE_URL=http://127.0.0.1:3100 npm run test:visual:update   # acepta nuevas líneas base (decisión humana)
npm run audit:controls -- http://127.0.0.1:3100

# Cambios de CSS: exactitud propiedad a propiedad
npm run styles:snapshot -- /tmp/antes.json        # con el build anterior sirviendo en 3100
# … cambiar CSS, npm run build, reiniciar 3100 …
npm run styles:snapshot -- /tmp/despues.json
npm run styles:compare -- /tmp/antes.json /tmp/despues.json   # debe dar 0

# Docker (proyecto acgraph-foundation; no tocar contenedores consultoria-*)
docker compose -p acgraph-foundation build app
ANTHROPIC_API_KEY= docker compose -p acgraph-foundation up -d --no-build --wait --wait-timeout 90 app
# Modo servidor: -f compose.yaml -f compose.server.yaml con DATABASE_URL, OIDC_ISSUER, OIDC_CLIENT_ID, APP_URL
```

- Con dos workers de Playwright y servidor externo la máquina va bien; con `webServer` automático y 5 workers se cuelga.
- Firefox de Playwright está instalado (`playwright install firefox`); el navegador por defecto del usuario es Firefox. Los bugs reportados por el usuario conviene reproducirlos ahí además de en Chromium.
- Capturas de verificación en `/var/folders/wy/kf7vlr0s0013stp8jdglkst80000gn/T/opencode/shots/` (temporal; regenerables).

## 4. Estado del contenedor

`acgraph-foundation-app-1` en **modo local** en http://127.0.0.1:3080 con la imagen del cierre de H1 (`/api/config` → `{"mode":"local"}`). El pie de la portada y el menú de cuenta muestran el **sello de compilación** (`NEXT_PUBLIC_BUILD_STAMP`): si la hora no coincide con el último build, el navegador sirve caché (`Cmd+Shift+R`). Volumen `postgres-data` conserva usuarios/sesiones semilla (Ana Torres, Luis Pérez; ids en `/var/folders/wy/kf7vlr0s0013stp8jdglkst80000gn/T/opencode/sessions.json`, temporal).

## 5. Decisiones que no hay que rediscutir

- **Barra de herramientas a la izquierda, vertical.** Se probó abajo al centro y el usuario la rechazó. No moverla.
- **Todo control cambia algo observable.** Nada de adorno; cada control nuevo entra en `scripts/audit-controls.mjs`.
- **Metadatos visibles en el lienzo:** cada campo del inspector tiene su marca (chips en servicios, etiquetas y trazo en conectores). Si se añade un campo, se añade su marca.
- **Deshacer:** ráfagas coalescidas (`coalesceKey`), Cmd+Z desde campos cae al dibujo, historial vacío avisa. No romperlo.
- **Iconos propios** viven en el navegador y se **embeben en el documento** al usarse (`model.customIcons`), para que enlaces y exportaciones los lleven.
- **CSS:** un solo `globals.css` en orden de cascada; cada selector una vez salvo los _cascade-pinned_ (comentados). **No añadir capas de sobrescritura al final**; cambiar la regla donde está y verificar con `styles:compare`.
- **Tokens:** `tokens.ts` ↔ `globals.css` en paridad (test). Acento por tono (`data-accent`): violeta AION, índigo, grafito, océano, rosa.
- **Tipografía:** Geist / Geist Mono autoalojadas. Paleta pizarra-azul (`#0b1020 / #121a2e / #1a2440`).
- **Movimiento:** lo que abre el teclado no se anima (paleta ⌘K); popovers crecen desde su disparador; tooltips propios (instantáneos entre vecinos, nunca repiten la etiqueta visible); todo sobre transform/opacity; apagado con `prefers-reduced-motion`; materiales respetan `prefers-reduced-transparency` y `prefers-contrast`.
- **Authentik:** el provider `ac-graph` **no existe** aún; el usuario pidió no configurarlo por ahora. Cuando toque: `docs/AUTHENTIK.md` (redirect `${APP_URL}/api/auth/callback`, PKCE, RS256, `NODE_EXTRA_CA_CERTS` + `extra_hosts` para `auth.localhost`).

## 6. Límites conocidos (no son bugs pendientes; son alcance)

- Presencia y eventos por proceso (falta bus LISTEN/NOTIFY o Redis para réplicas) — H1 #6.
- Un solo workspace, sin roles (`ownerId` informativo) — H1 #7.
- Sin CRDT: colaboración = presencia + adopción de guardados ajenos + conflicto 412 con banner.
- Biblioteca de iconos propios por navegador (no se sincroniza en modo servidor) — H2 #14.
- Azure y OCI sin iconos oficiales (313/572) — H2 #15.
- Etiquetas de conector centradas en el segmento más largo; pueden pisar un borde de grupo — H2 #11.
- Sin observabilidad (logs estructurados, métricas, trazas) — H1 #5.
- La homologación visual vive en CSS + `PanelHead`; faltan `Row/Tile/Field` como componentes — H1 #2 fase 2.
- E2E: 1 spec de biblioteca puede fallar en paralelo por IndexedDB compartido (pasa aislado); ver `PLAN_MEJORAS.md` H1 #3 (aislar por worker sigue pendiente aunque el falso intermitente se corrigió).

## 7. Dónde está cada cosa (mapa rápido)

- Modelo y motor: `src/lib/domain`, `src/lib/engine` (layout, routing, colisiones, clipboard, diff, vistas, análisis).
- Reducer e historial: `src/lib/editor/reducer.ts`, `actions.ts` (`coalesceKey`), `uiState.ts` (paneles, menú, acento, find).
- Guardado: `src/lib/store/{saveCoordinator,draftJournal,draftSession,localRepository,httpRepository}.ts`; `useDiagramDocument.ts`.
- Lienzo: `src/components/editor/canvas/` (`Canvas.tsx` encuadre y cámara que se desliza, `ConnectorLayer.tsx`, `shapes/`, `Defs.tsx`); metadatos → marcas: `src/lib/editor/meta.ts`.
- Chrome: `src/components/editor/chrome/` (`TopBar`, `ToolDock`, `InspectorPanel` + `inspector/`, `ServiceBrowser`, `IconPicker`, `CustomIcons`, `CommandPalette`, `FindBar`, `VersionPanel`, `InsightsPanel`, `Minimap`, `Modals`); componentes de sistema en `src/components/ui/`.
- Iconos propios: `src/lib/icons/{customIcons,iconLibrary}.ts`.
- Portada: `src/components/library/Library.tsx` (+ `CountUp`), vista previa real `src/lib/store/preview.ts`.
- App: `src/components/app/` (providers, tooltips, ripple, tema, `PageState` para 404/error).
- Servidor: `src/server/**`, rutas `src/app/api/**`; CLI y MCP en `bin/`.
- Herramientas: `scripts/{audit-controls,style-snapshot,css-match-map,consolidate-css}.mjs`, `scripts/lib/tour.mjs`.
- Pruebas: `src/**/*.test.ts` (1042), `e2e/*.spec.ts` (136 funcionales + `visual.spec.ts` 24), líneas base en `e2e/__screenshots__/`.

## 8. Siguiente paso recomendado

Orden sugerido (del `PLAN_MEJORAS.md`):

1. **Commits agrupados** del árbol de trabajo (previa confirmación del usuario): es la única deuda operativa seria.
2. H1 #5 **observabilidad mínima** (logs JSON con `requestId`, `/api/metrics`, OTel opcional) — M.
3. H1 #6 **bus LISTEN/NOTIFY** para presencia multi-réplica — M; después H1 #7 **roles por diagrama** — L.
4. Victorias rápidas restantes: enlaces clicables en el chip de repositorio, exportar con/sin metadatos y tema de exportación, ordenar/favoritos en la biblioteca, arrastrar archivo a la portada, salidas animadas con `@starting-style`, descripción accesible, virtualizar listas.
5. H1 #2 fase 2: `Row/Tile/Field` como componentes y migrar las seis superficies; luego partir `TopBar.tsx` (542) y `Library.tsx` (532).

Antes de cualquier entrega: verificación completa (sección 3), capturas antes/después en ambos temas, entrada en `CHECKPOINTS.md`.
