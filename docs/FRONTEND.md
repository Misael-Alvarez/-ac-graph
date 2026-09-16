# Frontend de AC Graph — arquitectura, estado y flujo de datos

Fecha: 2026-09-16 · Verificado contra el árbol en `main` (commit `f74d1b4`). Los
`archivo:línea` apuntan a ese estado; si el código se mueve, `rg` con el nombre
del símbolo lo encuentra.

Este documento describe **cómo está construido el front**: qué componente vive
dónde, dónde se guarda cada estado, y —la pregunta que más cuesta responder
leyendo el código— **por dónde viaja cada dato: por contexto, por props
(pass-down) o por un store externo**. La sección 7 responde esa pregunta con
todas las cadenas de pass-down enumeradas, una por una.

---

## 0. Respuesta corta: ¿se hace pass-down?

Sí, en tres regímenes distintos, y conviene saber distinguirlos:

| Régimen                  | Qué es                                                                                                                                       | Dónde ocurre                                                                                                                                                                                                                         | Veredicto                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Contexto**             | Cinco `createContext` (config, auth, repositorio, editor, comentarios). Cualquier componente bajo el provider lee con un hook; no hay props. | Todo el shell y el 90 % del cromo del editor.                                                                                                                                                                                        | Es la vía por defecto. Un componente nuevo dentro del editor **no** debería recibir `ui`, `dispatch` ni `t` por props. |
| **Pass-down deliberado** | Props que bajan 2–3 niveles **a propósito** para que el subárbol no dependa de ningún contexto.                                              | `Canvas → DiagramScene → Shape/ConnectorLayer` (la escena se renderiza también en servidor y en export); `DiagramEditor → EditorShell → TopBar/StatusBar/VersionPanel` (el manejador del documento vive fuera del `EditorProvider`). | Correcto y documentado en el propio código (`shapeProps.ts:7-9`, `DiagramScene.tsx:54-65`). No convertir en contexto.  |
| **Pass-down incidental** | Props que bajan 2–3 niveles aunque el destino podría leerlas del contexto que ya lo envuelve.                                                | `t` y `locale` hacia `IconPicker → Popover → MineSection/UploadForm`; `accessVersion` por `ShareDialog → ShareContents → SharePeople`; `t` y `refresh` por `Library → LibraryHeader → WorkspaceActions`.                             | Funciona, pero es deuda. Está enumerado en §7.3 y §14 para decidir con datos.                                          |

Regla de oro que ya cumple el código y que hay que mantener: **la escena
(`DiagramScene` y todo lo que hay debajo) es pura**: recibe todo por props, no
llama a ningún hook, y por eso `renderToStaticMarkup` la puede dibujar en
`/api/embed` con exactamente el mismo código que la pantalla
(`src/lib/editor/renderSvg.ts:17-18`).

---

## 1. Stack y convenciones

- **Next 16.3.3 (App Router) · React 19.2.8 · TypeScript · Tailwind 4 +
  `src/app/globals.css` · Zod (tipos) · Immer (historial) · CodeMirror 6 (panel
  de código) · `idb` (IndexedDB)**. Versiones en `package.json`.
- Casi todo es **Client Component** (`'use client'`). Los únicos Server
  Components son `src/app/layout.tsx` y `src/app/not-found.tsx`. Bajo
  `components/` hay 16 archivos **sin directiva**, isomorfos a propósito: la
  escena del canvas (`DiagramScene`, `DiagramDocument`, `Defs`,
  `ConnectorLayer`, los 8 archivos de `shapes/`), los iconos (`ToolIcons`,
  `AlignIcons`, `Glyph`) y `ui/Kbd`.
- Las tres pantallas grandes se cargan con `next/dynamic(..., { ssr: false })`:
  `Library` (`src/app/page.tsx:6-8`), `DiagramEditor`
  (`src/app/d/[id]/page.tsx:7`), `SharedDiagram` (`src/app/share/page.tsx:8-11`).
  No hay SSR de la interfaz; sí lo hay del SVG en `/api/embed`.
- Dos reglas del README que estructuran el front:
  1. **La UI nunca toca I/O.** Todo pasa por `DiagramRepository`
     (`src/lib/store/types.ts:53-90`), elegido una sola vez en
     `RepositoryProvider`.
  2. **El motor nunca toca el navegador.** `src/lib/engine/` y la escena no
     usan `window`, `document` ni hooks.
- i18n: **no hay contexto de idioma**. Dentro del editor, `t` sale de
  `useEditor()`; fuera, de `useLocale()` (§12.1).
- Tema: **no hay contexto de tema**. Se lee de `localStorage` con
  `useSyncExternalStore` (§12.2).
- Anatomía visual compartida en `src/components/ui/*` (Chip, Row, Tile, Field,
  Section, GroupHeader, PanelHead, SearchField, Kbd): primitivas **sin
  contexto**, probadas byte a byte en `ui.test.ts`.

---

## 2. Mapa de carpetas (solo lo que es front)

```
src/app/
  layout.tsx            Server. <html class="dark"> + script inline de tema + <AppProviders>
  page.tsx              Client. /            → <Library/>          (dynamic, ssr:false)
  d/[id]/page.tsx       Client. /d/:id       → <DiagramEditor documentId/> (useParams)
  share/page.tsx        Client. /share?d=…   → <SharedDiagram/>    (useSearchParams)
  error.tsx             Client. <PageState kind="error" onRetry={reset}/>
  not-found.tsx         Server. <PageState kind="not-found"/>
  globals.css           Tokens, anatomía, animaciones. Único CSS global.

src/components/
  app/                  Shell: providers, gate de sesión, hooks globales
    AppProviders.tsx      Orden de providers + useGlobalRipple + useTooltips
    AppConfigProvider.tsx AppConfigContext  → useAppConfig()
    AuthProvider.tsx      AuthContext       → useUser()
    RepositoryProvider.tsx RepositoryContext → useRepository() y 4 hooks más
    SignInGate.tsx        Muestra children | spinner | tarjeta de login
    PageState.tsx         Pantalla 404 / error
    useDiagramDocument.ts Carga + guarda un diagrama (SaveCoordinator)
    useTheme.ts           Tema desde localStorage + matchMedia; <ThemeSync/>
    useRipple.ts, useTooltips.ts, useLiquidPointer.ts   efectos globales
  editor/
    DiagramEditor.tsx     Entrada de /d/:id. Autosave, EditorShell, banners
    EditorProvider.tsx    EditorContext → useEditor(). Dos reducers.
    hooks/                useCommands, useKeyboard, usePointerTools, useCollaboration
    canvas/               Canvas (interactivo) + escena pura + overlays
      shapes/             Un renderer por tipo de forma; contrato en shapeProps.ts
    chrome/               TopBar, menús, paneles, inspector, diálogos, minimapa…
    code/                 CodePanel + CodeEditor (CodeMirror)
    comments/             CommentsProvider → useComments(); panel y pines
    ai/                   AiDialog
  library/              Home: Library + cabecera, hero, toolbar, tarjetas, galería
  share/                SharedDiagram (lector del enlace compartido)
  ui/                   Primitivas sin contexto
  icons/                ToolIcons (74 iconos), AlignIcons, Glyph, ServiceSprite
  brand/                AcMark, AcGraphLogo

src/lib/ (parte que consume el front)
  editor/   reducer.ts (documento + historial), uiState.ts (interfaz + prefs),
            actions.ts, readOnly.ts, viewport.ts, shortcuts.ts, platform.ts,
            systemTheme.ts, usePresence.ts, usePreferences.ts, returnFocus.ts,
            export.ts, renderSvg.ts, renderSvgClient.ts
  store/    DiagramRepository (types.ts), LocalDiagramRepository (IndexedDB),
            HttpDiagramRepository (server), SaveCoordinator, DraftJournal, DraftSession
  collab/   client.ts: SSE + presencia (funciones, no clase)
  i18n/     messages.ts (649 claves es/en), useLocale.ts
  browserStore.ts   useStoredValue + notifyStoreChanged (localStorage reactivo)
  domain/   Zod: DiagramModel, Shape, Connector, View, DiagramMeta, User, Role…
```

---

## 3. Árbol de la aplicación (shell)

```
RootLayout (Server)                                   src/app/layout.tsx:47
└─ <html lang="es" class="dark …"> + <script> inline    :53-66  (aplica tema antes de hidratar)
   └─ <AppProviders>                                    src/components/app/AppProviders.tsx
      ├─ useGlobalRipple()  useTooltips()                 :15-16  (listeners a nivel document)
      └─ <AppConfigProvider>                              :19     GET /api/config → { mode, auth }
         ├─ <ThemeSync/>                                  :22     espeja tema/acento en <html>
         └─ <AuthProvider>                                :23     GET /api/auth/me (solo modo server)
            └─ <RepositoryProvider>                       :24     Local(IndexedDB) | Http(API)
               └─ <SignInGate>                            :25     children solo si 'local'|'authenticated'
                  ├─ /          → <Library/>
                  ├─ /d/[id]    → <DiagramEditor documentId/>
                  ├─ /share     → <Suspense><SharedDiagram/></Suspense>
                  ├─ error.tsx  → <PageState kind="error"/>
                  └─ not-found  → <PageState kind="not-found"/>
```

**Cómo llega el id del diagrama.** `src/app/d/[id]/page.tsx:10-13` lee
`useParams().id` y lo entrega como **prop** `documentId`. De ahí baja por props
a `EditorShell` → `useCollaboration(diagramId)` y `CommentsProvider[diagramId]`
(§7.2, cadena E1). Dos componentes lo re-leen por su cuenta con `useParams` en
vez de recibirlo: `VersionPanel.tsx:37` y `ShareDialog.tsx:105` (§14).

**Modo local vs servidor.** `AppConfigProvider` pide `/api/config`; si falla,
`{ mode: 'local' }`. `RepositoryProvider.tsx:58-61` construye
`LocalDiagramRepository` o `HttpDiagramRepository` según `mode`; `ready` solo se
enciende cuando la config ha llegado y (en local) la migración del autosave
antiguo ha terminado. **Todo lo que carga datos debe esperar a
`useRepositoryReady()`** (así lo hacen `useDiagramDocument.ts:90`,
`Library.tsx:76-79`, `CommentsProvider.tsx:87-90`).

**Gate de sesión.** `SignInGate.tsx:45` renderiza `children` solo con estado
`'local'` o `'authenticated'`; `'loading'` muestra el spinner; `'anonymous'`
muestra `PasswordForm` (proveedor local) o `ProviderPrompt` (OIDC). Las
sub-vistas del gate leen `useUser()`/`useLocale()` directamente; el único prop
de datos es `signupOpen` (`config.auth.signup`, `SignInGate.tsx:67`).

---

## 4. Los cinco contextos (y los stores que no lo son)

Hay exactamente cinco `createContext` en `src/` (excluyendo tests):

| Contexto            | Archivo                                   | Valor                                                                                                            | Hook(s)                                                                                                            | Por defecto                                                    | Montado en                                        |
| ------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------- |
| `AppConfigContext`  | `app/AppConfigProvider.tsx:12`            | `{ config: AppConfig; ready: boolean }`                                                                          | `useAppConfig()`                                                                                                   | `{ config: LOCAL_CONFIG, ready: false }` (usable sin provider) | `AppProviders.tsx:19`                             |
| `AuthContext`       | `app/AuthProvider.tsx:54`                 | `{ user; state: 'loading'\|'local'\|'authenticated'\|'anonymous'; rename; loginUrl; signIn; register; signOut }` | `useUser()` (lanza fuera del provider)                                                                             | `null`                                                         | `AppProviders.tsx:23`                             |
| `RepositoryContext` | `app/RepositoryProvider.tsx:20`           | `{ repository: DiagramRepository; ready: boolean; mode: 'local'\|'server' }`                                     | `useRepository()` (lanza), `useRepositoryReady()`, `useRepositoryMode()`, `useMembersApi()`, `useIconLibraryApi()` | `null`                                                         | `AppProviders.tsx:24`                             |
| `EditorContext`     | `editor/EditorProvider.tsx:64`            | 14 campos, §5.1                                                                                                  | `useEditor()` (lanza)                                                                                              | `null`                                                         | `DiagramEditor.tsx:446` (con `key={record.id}`)   |
| `CommentsContext`   | `editor/comments/CommentsProvider.tsx:32` | `{ threads; open; loading; failed; canModerate; create; reply; setResolved; remove; refresh }`                   | `useComments()` (lanza)                                                                                            | `null`                                                         | `DiagramEditor.tsx:239` (dentro de `EditorShell`) |

Consumidores de cada uno (para saber qué se rompe si cambia la forma):

- `useAppConfig`: `AuthProvider`, `RepositoryProvider`, `SignInGate`.
- `useUser`: `SignInGate` (×3), `EditorShell`, `ShareDialog/SharePeople`,
  `AccountMenu`, `useCollaboration`, `Library`, `CommentsPanel`.
- `useRepository*`: `useDiagramDocument`, `VersionPanel`, `Modals/TemplatesDialog`,
  `useCollaboration`, `CommentsProvider`, `useCommands`, `WorkspaceActions`,
  `Library`, `ShareDialog` (`useMembersApi`), `CustomIcons` (`useIconLibraryApi`).
- `useEditor`: 33 archivos, 44 llamadas (lista completa en §5.6).
- `useComments`: `CommentsPanel`, `CommentPins`.

**Stores externos que parecen contexto pero no lo son.** Se leen con
`useSyncExternalStore` sobre `localStorage` a través de
`src/lib/browserStore.ts`; cada consumidor se suscribe por su cuenta y el
escritor del mismo tab debe llamar a `notifyStoreChanged()`:

| Hook                                                         | Clave localStorage        | Quién lo lee                                                                                |
| ------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------- |
| `useStoredPreferences()` (`lib/editor/usePreferences.ts:15`) | `aion-studio-preferences` | `useTheme`, `useLocale` — único lector de la clave, por diseño (`usePreferences.ts:6-14`)   |
| `useTheme()` (`app/useTheme.ts:33`)                          | prefs + `matchMedia`      | `ThemeSync`, `Library`                                                                      |
| `useLocale()` (`lib/i18n/useLocale.ts:13`)                   | prefs `.locale`           | `PageState`, `SignInGate`, `SharedDiagram`, `DiagramEditor` (fuera del provider), `Library` |
| `useLibraryPrefs()` (`lib/library/prefs.ts:51`)              | `aion-studio-library`     | `Library`                                                                                   |
| `useStoredValue(LOCAL_USER_KEY)`                             | `aion-studio-user`        | `AuthProvider` (modo local)                                                                 |

---

## 5. Estado del editor

### 5.1 `EditorProvider` — el contexto

Props (`EditorProvider.tsx:72-82`): `initialModel: DiagramModel`,
`title = ''`, `readOnly = false`, `children`. Los tres primeros vienen de
`useDiagramDocument` en `DiagramEditor.tsx:446-451`; el `key={record.id}`
remonta el provider al cambiar de documento, que es como se "carga" un modelo
(la acción `load` existe pero no la despacha nadie en la app).

Valor del contexto (`EditorContextValue`, `EditorProvider.tsx:31-62`):

| Campo                 | Tipo                       | Cómo se calcula                                                                                       |
| --------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `doc`                 | `DocState`                 | `useReducer(docReducer, initialModel, initialDocState)` :83                                           |
| `ui`                  | `UiState`                  | `useReducer(uiReducer, initialUiState)` :84                                                           |
| `view`                | `DiagramModel`             | `focusSubtree(resolveView(doc.model, ui.activeViewId), ui.drillPath)` :153-158 — **lo que se dibuja** |
| `views`               | `View[]`                   | `viewsOf(doc.model)` :146                                                                             |
| `activeView`          | `View`                     | `getView(doc.model, ui.activeViewId)` :147                                                            |
| `dispatch`            | `(EditorAction) => void`   | `guardDispatch(rawDispatch, locked)` :87                                                              |
| `dispatchUi`          | `(UiAction) => void`       | dispatch crudo del reducer de UI :84                                                                  |
| `collisions`          | `Set<string>`              | `checkCollisions(doc.model)` :144                                                                     |
| `selectedShape`       | `Shape \| null`            | :175-179 — **sin consumidores** (§14)                                                                 |
| `canUndo` / `canRedo` | `boolean`                  | `!locked && canUndo(doc)` :198-199                                                                    |
| `readOnly`            | `boolean`                  | `locked = readOnly ∥ ui.presenting` :86                                                               |
| `title`               | `string`                   | el prop, tal cual :201                                                                                |
| `t`                   | `(key, values?) => string` | `translate(ui.locale, …)` memoizado :181-185                                                          |

Regla escrita en el propio tipo (:34-42): **lo que dibuja o exporta lee `view`;
lo que razona sobre la arquitectura (análisis, diff, IA) lee `doc.model`**. Una
vista es una lectura parcial y no puede servir para afirmar nada del conjunto.

Efectos del provider: lee preferencias tras montar y las replica en
`dispatchUi` (:91-112); persiste `toPreferences(ui)` en cada cambio de `ui`
(:114-120); sigue `prefers-color-scheme` (:124-128); espeja `dark`/`accent` en
`<html>` (:130-136); autolimpia el toast a 4 s (:138-142); repara
`activeViewId` y `drillPath` si el modelo deja de tenerlos (:162-173).

### 5.2 `DocState` y `EditorAction` — el documento y su historial

`src/lib/editor/reducer.ts:21-37`:

```ts
{ model: DiagramModel; past: HistoryEntry[]; future: HistoryEntry[];
  lastCreated: string[]; lastCloudSwitch: SwitchCloudResult | null;
  lastCreatedViewId: string | null; origin: 'local' | 'remote' }
```

- **Undo/redo con parches de Immer**, no con snapshots: `produceWithPatches`
  en cada acción (:444); `HISTORY_LIMIT = 200` (:12); una acción que no cambia
  nada no crea entrada (:447). Cualquier acción nueva vacía `future` (:476).
- **Coalescencia**: las acciones `Coalescable` (`actions.ts:16-18`) llevan
  `coalesceKey`; si coincide con la entrada anterior, se fusionan en un solo
  paso de deshacer (:462-472). Productores: nudges de teclado
  (`useKeyboard.ts:187`), campos numéricos del inspector (`stepKey`,
  `InspectorPanel.tsx:35`), codos y etiquetas de conector (`Canvas.tsx:663,843`).
- **`origin: 'remote'`**: solo lo produce `applyRemote` en
  `DiagramEditor.tsx:165` (un guardado ajeno adoptado). `Autosave` lo usa para
  **no** re-guardar lo que ya está persistido (`DiagramEditor.tsx:117`).
- `load` reinicia todo el estado (:413); `replaceModel` es **un** paso
  deshacible que conserva los ids de vista por nombre (:81-113). Lo despachan
  el panel de código, la IA, las plantillas, restaurar versión, abrir JSON y la
  colaboración.

Las 36 acciones (`src/lib/editor/actions.ts:28-109`), por grupo:

| Grupo        | `type`                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Modelo       | `load`, `replaceModel`                                                                                                     |
| Crear formas | `addBoundary`, `addGroup`, `addItem`, `addDecoration`                                                                      |
| Borrar       | `deleteShapes`                                                                                                             |
| Geometría    | `moveShapes`\*, `resizeShape`\*, `alignShapes`, `distributeShapes`, `reorderItem`, `autoLayout`                            |
| Propiedades  | `setShapeProps`\*, `setLocked`                                                                                             |
| Orden z      | `bringToFront`, `sendToBack`                                                                                               |
| Conectores   | `addConnector`, `deleteConnector`, `reverseConnector`, `setConnectorProps`\*, `setConnectorRoute`\*, `resetConnectorRoute` |
| Portapapeles | `paste`, `duplicateShapes`                                                                                                 |
| Vistas       | `addView`, `renameView`, `deleteView`, `setViewInclude`                                                                    |
| Nube         | `switchCloud`, `switchShapeCloud`                                                                                          |
| Iconos       | `addCustomIcon`                                                                                                            |
| Historial    | `undo`, `redo`                                                                                                             |

\* coalescables.

### 5.3 `UiState` y `UiAction` — la interfaz

`src/lib/editor/uiState.ts:32-97`, 33 campos. Agrupados:

- **Herramienta y selección**: `tool`, `selectedIds: Set<string>`,
  `selectedConnectorId`, `connectorSourceId`.
- **Cámara**: `viewport {x,y,zoom}`, `viewportSmooth`, `gridSnap`.
- **Tema y preferencias**: `theme: 'system'|'light'|'dark'`, `dark` (resuelto),
  `accent`, `brand`, `exportTheme`, `exportMeta`, `locale`.
- **Paneles**: `minimapOpen`, `paletteOpen`, `findOpen`, `codeOpen`,
  `versionsOpen`, `insightsOpen`, `commentsOpen`, `browserOpen`,
  `inspectorPinned`, `presenting`. Los cuatro paneles laterales (código,
  historial, análisis, comentarios) son mutuamente excluyentes (:313-351).
- **Vistas**: `activeViewId`, `drillPath`.
- **Comentarios**: `commentDraft`, `commentFocus`. **Diff**: `diffHighlight`.
- **Capas flotantes**: `modal`, `menu`, `contextMenu`, `toast`.

43 acciones (`uiState.ts:143-187`): `setTool` · `select`, `modifySelection`,
`toggleSelected`, `clearSelection`, `selectConnector`, `setConnectorSource` ·
`setViewport` · `setActiveView`, `drillInto`, `drillUpTo` · `toggleGridSnap` ·
`toggleDark`, `setTheme`, `setSystemDark`, `setAccent`, `setBrand`,
`setExportTheme`, `toggleExportMeta`, `setLocale` · `setPresenting` ·
`toggleMinimap`, `toggleCode`, `toggleVersions`, `toggleInsights`,
`toggleComments`, `toggleBrowser`, `setPaletteOpen`, `setFindOpen`,
`toggleInspectorPinned` · `openComments`, `setCommentDraft`, `setCommentFocus`
· `setDiffHighlight` · `setModal`, `setMenu`, `openContextMenu`,
`closeContextMenu` · `toast`.

**Preferencias persistidas** (`StoredPreferences`, :416-427): `theme, accent,
gridSnap, brand, exportTheme, exportMeta, locale, minimapOpen, codeOpen,
browserOpen` bajo `PREFERENCES_KEY = 'aion-studio-preferences'`. `presenting`
nunca se guarda.

### 5.4 Solo lectura

`src/lib/editor/readOnly.ts`: `guardDispatch(dispatch, locked)` devuelve el
mismo `dispatch` si no está bloqueado; bloqueado, deja pasar **solo** `load` y
`replaceModel` con `origin: 'remote'` (:10-12). Así un _viewer_ recibe los
guardados ajenos en su lienzo pero ninguna edición suya llega al reducer.
`locked` incluye `ui.presenting`: presentar bloquea el documento para quien
sea. Además `useCommands` marca `enabled: false` en los comandos de edición
(`useCommands.ts:57-71, 427-431`) y cada control lee `readOnly` para
deshabilitarse.

### 5.5 Los cuatro hooks del editor y de dónde toman sus datos

| Hook                                                                        | Firma                                                                          | Fuente de datos                                                                                                  | Quién lo llama                                                                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useKeyboard()`                                                             | sin argumentos                                                                 | **solo contexto**: `useEditor()` + `useCommands()`; registro de atajos `lib/editor/shortcuts.ts`                 | `EditorShell` (`DiagramEditor.tsx:155`)                                                                                                            |
| `useCommands()`                                                             | sin argumentos → `CommandSet` (46 comandos + `addService`, `addCustomService`) | **solo contexto**: `useEditor()`, `useRepository()`, `useIconLibraryApi()`                                       | 6 sitios: `useKeyboard`, `TopBar`, `PaletteContents`, `ServiceBrowser`, `IconLibraryManager`, `Canvas`. Cada uno reconstruye su propia lista (§14) |
| `usePointerTools(options)`                                                  | 14 opciones: modelo, viewport, callbacks                                       | **solo argumentos**, no llama a ningún contexto                                                                  | `Canvas.tsx:59-83`, que le pasa campos de su `useEditor()` y arrows sobre `dispatch`                                                               |
| `useCollaboration(diagramId, doc, onRemoteModel, onRemoteTitle, onAccess?)` | argumentos + contexto                                                          | argumentos desde `EditorShell`; `useRepositoryMode()`, `useRepository()`, `useEditor().ui.viewport`, `useUser()` | `EditorShell` (`DiagramEditor.tsx:196-202`)                                                                                                        |

Los menús (`ExportMenu`, `MoreMenu`, `AccountMenu`) **no** llaman a
`useCommands`: `TopBar` construye los cierres `pick/off/label/chord` y se los
pasa como `MenuProps` (`chrome/menuProps.ts:12-21`). Es pass-down de
callbacks a un nivel, con `TopBarMenu` un nivel más abajo recibiendo
`onClose`/`closing`/`onExited` (§7.2, cadena E5).

### 5.6 Quién lee qué del `EditorContext`

| Componente                                      | Campos leídos                                                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `EditorShell`                                   | `doc.model`, `ui.{presenting,browserOpen,findOpen,codeOpen,versionsOpen,insightsOpen,commentsOpen}`, `dispatch`, `dispatchUi`, `readOnly`, `t` |
| `Autosave`                                      | `doc.{model,origin}`, `readOnly`                                                                                                               |
| `Toast` / `CloudSwitchAnnouncer`                | `ui.toast` / `doc.lastCloudSwitch`, `dispatchUi`, `t`                                                                                          |
| `Canvas`                                        | `doc`, `ui`, `view`, `dispatch`, `dispatchUi`, `collisions`, `readOnly`, `t`                                                                   |
| `SelectionToolbar`, `ContextMenu`               | `ui`, `view`, `dispatch`, `dispatchUi`, `readOnly`, `t`                                                                                        |
| `Breadcrumb`                                    | `doc.model.shapes`, `ui.{drillPath,selectedIds,selectedConnectorId}`, `dispatchUi`, `t`                                                        |
| `EmptyState`                                    | `ui.tool`, `dispatchUi`, `t`                                                                                                                   |
| `TopBar`                                        | `ui.{menu,browserOpen,codeOpen,versionsOpen,insightsOpen,gridSnap,dark}`, `dispatchUi`, `canUndo`, `canRedo`, `readOnly`, `t`                  |
| `ExportMenu` / `MoreMenu` / `AccountMenu`       | `ui.{menu,exportTheme,exportMeta}` / `ui.{menu,minimapOpen,commentsOpen}` / `ui.{locale,menu,accent,theme,brand}`; `dispatchUi`, `t`           |
| `ToolDock`                                      | `ui.{tool,browserOpen}`, `dispatchUi`, `readOnly`, `t`                                                                                         |
| `StatusBar`                                     | `doc.model.{shapes,connectors}`, `ui.{tool,connectorSourceId}`, `readOnly`, `t`                                                                |
| `ViewBar`                                       | `doc.lastCreatedViewId`, `ui.selectedIds`, `views`, `activeView`, `dispatch`, `dispatchUi`, `t`                                                |
| `FindBar`                                       | `ui.viewport`, `view`, `dispatchUi`, `t`                                                                                                       |
| `ZoomControls` / `Minimap`                      | `view`, `ui.viewport` (+ `ui.{dark,minimapOpen}`), `dispatchUi`, `t`                                                                           |
| `InspectorPanel`                                | `ui.{selectedIds,selectedConnectorId}`, `view`, `dispatch`, `dispatchUi`, `readOnly`, `t`                                                      |
| `ShapeInspector`                                | `doc.model.customIcons`, `ui.{dark,locale,activeViewId,drillPath}`, `view`, `dispatch`, `dispatchUi`, `t`                                      |
| `ConnectorInspector`                            | `ui.{dark,activeViewId}`, `view`, `dispatch`, `dispatchUi`, `t`                                                                                |
| `InsightsPanel`                                 | `doc.model`, `ui.viewport`, `dispatchUi`, `t`                                                                                                  |
| `CodePanel`                                     | `doc.model`, `ui.locale`, `dispatch`, `dispatchUi`, `readOnly`, `t`                                                                            |
| `VersionPanel`                                  | `doc.model`, `dispatch`, `dispatchUi`, `readOnly`, `t`                                                                                         |
| `CommentsPanel`                                 | `doc`, `ui.{selectedIds,commentDraft,commentFocus,viewport}`, `view`, `dispatchUi`, `t`                                                        |
| `ServiceBrowser`                                | `doc.model.customIcons`, `ui.locale`, `dispatchUi`, `t`                                                                                        |
| `CommandPalette` / `PaletteContents`            | `ui.paletteOpen` / `ui.locale`, `dispatchUi`, `t`                                                                                              |
| `Modals` y diálogos                             | `ui.{modal,locale}`, `doc.model.customIcons`, `dispatch`, `dispatchUi`, `t`                                                                    |
| `AiDialog`                                      | `doc.model`, `ui.{modal,locale}`, `dispatch`, `dispatchUi`, `t`                                                                                |
| `ShareDialog` / `ShareContents` / `SharePeople` | `ui.modal` / `doc.model`, `ui.dark`, `view`, `dispatchUi`, `t` / `t`, `dispatchUi`                                                             |
| `Presentation`                                  | `doc.model`, `ui.{dark,viewport}`, `view`, `views`, `activeView`, `dispatchUi`, `title`, `t`                                                   |
| `PresenceStack` / `RemoteCursors`               | `t` / `ui.viewport`                                                                                                                            |
| `useCommands`                                   | `doc, ui, view, views, dispatch, dispatchUi, canUndo, canRedo, readOnly, t, title`                                                             |
| `useKeyboard`                                   | `ui, view, dispatch, dispatchUi, canUndo, canRedo, readOnly, t`                                                                                |
| `useCollaboration`                              | `ui.viewport`                                                                                                                                  |

Nadie lee `selectedShape`. `collisions` solo lo lee `Canvas`.

---

## 6. Ciclo de vida de un documento (persistencia)

```
/d/:id ──useParams──▶ DiagramEditor(documentId)
                        │ useDiagramDocument(documentId)      app/useDiagramDocument.ts:57
                        │   ├─ espera useRepositoryReady()
                        │   ├─ acquireDraftSession(sessionStorage, navigator.locks)   lease por pestaña
                        │   ├─ repository.get(id) → NoAccessError | null | DiagramRecord
                        │   ├─ new DraftJournal(localStorage, lease.id, record)        borrador sincrónico
                        │   └─ new SaveCoordinator(repository, record, journal, publish)
                        │         save(model): journal.write → debounce 1200 ms → repository.save(…, expectedUpdatedAt)
                        │         rename(title): flush inmediato · snapshot · restore · adoptRemote · acceptRemote
                        ▼
                  { record, status: 'saved'|'pending'|'saving'|'error'|'conflict', role,
                    recoveryConflict, recoveryUnavailable, remoteConflict, save, rename, … }
                        │
        ┌───────────────┴───────────────────────────────┐
        ▼                                               ▼
<EditorProvider key=id initialModel title readOnly>   <EditorShell documentId document={…} + 10 campos aplanados>
   <Autosave onChange={document_.save}/>                 ├─ useCollaboration(documentId, document_, …)
      useLayoutEffect: doc.model cambió                  ├─ TopBar[title,status,onRename]  StatusBar[status]
        && origin !== 'remote' && !readOnly              ├─ VersionPanel[onSnapshot,onRestore,revision]
        → onChange(doc.model)                            └─ banners: remoteConflict, accessRevokedBy, deletedBy,
                                                              recoveryUnavailable, status==='error', recoveryConflict
```

Puntos que conviene no romper:

- `Autosave` es un componente aparte para que solo él se re-renderice en cada
  edición, y `onChange` debe ser **referencialmente estable**: una arrow inline
  reiniciaría el debounce en cada render y el autosave nunca dispararía
  (`DiagramEditor.tsx:99-104`).
- `useDiagramDocument` tiene **un solo consumidor** (`DiagramEditor.tsx:410`).
  Su resultado llega a `EditorShell` **dos veces**: entero como `document` y
  aplanado en 10 props (`:456-465`). Es la duplicación más visible del front
  (§14).
- Conflictos: `SaveCoordinator` detecta `DiagramConflictError` (412 en servidor)
  y pasa a `status: 'conflict'` con `remoteConflict { theirs, mine }`; el banner
  de `EditorShell` ofrece descargar lo mío o adoptar lo suyo (`acceptRemote`).
  Nunca se fusiona en silencio.
- Al salir de la página (`pagehide`) se hace `flush()` y se libera el lease;
  una reapertura rápida del mismo id espera a que el escritor anterior termine
  (`departures`, `useDiagramDocument.ts:15`).

---

## 7. Flujo de datos: contexto vs pass-down

### 7.1 Regla por capas

| Capa                                                          | Vía                       | Motivo                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell (`app/*`)                                               | Contexto                  | Config, sesión y repositorio son transversales; `children` es el único prop que baja y lo hace por seis providers (cadena S1).                                                                                                                              |
| `DiagramEditor` → `EditorShell`                               | **Props (deliberado)**    | El manejador del documento (`useDiagramDocument`) vive **fuera** del `EditorProvider` para que el provider se remonte con `key` sin perder el guardado. Todo lo que el cromo necesita del documento (título, estado de guardado, versiones) baja por props. |
| Cromo del editor (`chrome/*`, `code/*`, `comments/*`, `ai/*`) | Contexto                  | 18 componentes del editor con **cero props de datos** (§7.5). Los pocos props que existen son medidas del DOM (`size`) o valores del documento que no están en el contexto (`status`, `revision`).                                                          |
| `Canvas` → escena                                             | **Props (deliberado)**    | La escena debe renderizarse con `renderToStaticMarkup` sin provider. `theme`, `model`, `interactionFor`, `connectorInteraction` bajan por props y **se omiten** en export/embed/share, que es cómo el archivo sale sin cromo (`shapeProps.ts:7-9`).         |
| Biblioteca (`library/*`)                                      | **Props desde `Library`** | `Library` es el único componente con hooks de contexto (más `WorkspaceActions`); el resto es presentacional y recibe todo por props. Un nivel en casi todo; dos o tres en `t`, `refresh`, `searchRef` y las plantillas.                                     |
| Primitivas `ui/*`                                             | Props                     | Genéricas y sin contexto por definición.                                                                                                                                                                                                                    |

### 7.2 Todas las cadenas de pass-down de profundidad ≥ 2

Formato: origen → `Componente[prop]` → … → uso final. **D** = deliberado
(el destino no debe/puede leer contexto); **I** = incidental (el destino está
bajo el mismo provider y podría leerlo).

**Shell**

| #   | Origen                              | Cadena                                                                                                                                                                                | Tipo                |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| S1  | Next router                         | `RootLayout[children]` → `AppProviders` → `AppConfigProvider` → `AuthProvider` → `RepositoryProvider` → `SignInGate[children]` (se renderiza condicionalmente en `SignInGate.tsx:45`) | D (patrón provider) |
| S2  | `PasswordForm` estado `fieldErrors` | `FieldError[messageKey]` → `Reveal[open]` (`SignInGate.tsx:340,366,408,496`)                                                                                                          | D (derivado local)  |

**Editor: documento → cromo**

| #   | Origen                                        | Cadena                                                                                                                                                                                                                                | Tipo                                  |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| E1  | `useParams().id`                              | `DiagramEditor[documentId]` → `EditorShell[documentId]` → `useCollaboration(diagramId)` y `CommentsProvider[diagramId]` → `repository.listThreads(diagramId)`                                                                         | D                                     |
| E2  | `useDiagramDocument()` entero                 | `EditorShell[document]` → `useCollaboration(…, doc)` (usa `adoptRemote`, `confirmedUpdatedAt`, `status`); `EditorShell` lee además `.applyAccess`, `.acceptRemote()`, `.role` (→ `CommentsProvider[canModerate]`), `.accessRevokedBy` | D                                     |
| E3  | `record.title`                                | `EditorShell[title]` → `TopBar[title]` → `<input value>` (`TopBar.tsx:123`). `title` también está en el contexto (`EditorProvider.tsx:201`): `TopBar` lee el prop; `Presentation` y `useCommands` leen el contexto                    | D/I (duplicado)                       |
| E4  | `document_.status`                            | `EditorShell[status]` → `TopBar[status]` **y** `StatusBar[status]`                                                                                                                                                                    | D (no está en contexto)               |
| E5  | `document_.rename`                            | arrow en `DiagramEditor.tsx:458` → `EditorShell[onRename]` → `TopBar[onRename]` → `<input onChange>`; y envuelto otra vez como `applyRemoteTitle` → `useCollaboration`                                                                | D                                     |
| E6  | `document_.snapshot/restore/record.updatedAt` | `EditorShell[onSnapshot,onRestore,revision]` → `VersionPanel`                                                                                                                                                                         | D                                     |
| E7  | `useCollaboration()` en `EditorShell`         | `TopBar[collab]` → `PresenceStack[collab]` (`TopBar.tsx:149`). `TopBar` **no lee ningún campo** de `collab`                                                                                                                           | I (pasarela pura)                     |
| E8  | `collab.accessVersion`                        | `ShareDialog[accessVersion]` → `ShareContents[accessVersion]` → `SharePeople[accessVersion]` → dep de un efecto (`ShareDialog.tsx:83,380,128`). Profundidad 3; `ShareContents` no lo lee                                              | I (pasarela pura ×2)                  |
| E9  | `useCanvasSize()` en `EditorShell`            | `ZoomControls[size]`, `Minimap[size]`, `InsightsPanel[size]`, `CommentsPanel[size]` (abanico a 1 nivel). Otros cuatro sitios re-miden `.canvas-surface` con `querySelector` en vez de recibirlo                                       | I                                     |
| E10 | cierres de menú en `TopBar` (:68-103)         | `ExportMenu`/`MoreMenu`/`AccountMenu[menu,onToggle,onClose,pick,chord,off,label]` → `TopBarMenu[onClose, closing=menu.closing, onExited=menu.onExited]` y `MenuItem[onSelect,disabled,shortcut]`                                      | D (los menús no llaman `useCommands`) |
| E11 | `Modals` estado `close`/presence              | `TemplatesDialog`/`MarkdownDialog`/`IconsDialog[onClose,closing,onExited]` → `Dialog[…]`                                                                                                                                              | D (animación de salida)               |

**Editor: inspector e iconos**

| #   | Origen                                                                       | Cadena                                                                                                                                                   | Tipo                  |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| E12 | ctx `view` en `InspectorPanel`                                               | `ShapeInspector[shape]` → `ShapeHero[shape]` (`ShapeInspector.tsx:118`). `ShapeHero` es puro: sin hooks                                                  | D                     |
| E13 | ctx `t` en `ShapeInspector`                                                  | `IconPicker[t]` (`ShapeInspector.tsx:170`) → `Popover[t]` → `UploadForm[t]` y `MineSection[t]` (`IconPicker.tsx:172,378,393`). Profundidad 3             | **I**                 |
| E14 | ctx `ui.locale` en `ShapeInspector`                                          | `IconPicker[locale]` → `Popover[locale]`. `IconPicker` **solo lo reenvía**                                                                               | **I**                 |
| E15 | ctx `doc.model.customIcons`                                                  | `IconPicker[customIcons]` → `Popover[customIcons]`; y → `ShapeHero[customIcons]`                                                                         | I                     |
| E16 | `iconKey` derivado en `ShapeInspector`                                       | `IconPicker[value]` → `Popover[value]` → `MineSection[value]`. Profundidad 3                                                                             | D (valor del campo)   |
| E17 | `useIconLibrary()` en `IconsDialog`                                          | `IconLibraryManager[library]` (lee `.icons .save .remove .shared`)                                                                                       | D                     |
| E18 | ctx `t` en `CommentsPanel`, `IconLibraryManager`, `ServiceBrowser`, `Canvas` | → `Composer[t]`, `Thread[t]`, `UploadForm[t]`, `MineSection[t]`, `CommentPins[t]`, `ConnectorHandles[t]` (1 nivel cada uno; todos bajo `EditorProvider`) | **I**                 |
| E19 | ctx `ui.locale`/`readOnly` en `CodePanel`                                    | `CodeEditor[locale, readOnly]` (1 nivel; `CodeEditor` no llama contexto y envuelve CodeMirror)                                                           | D (aislar CodeMirror) |

**Canvas → escena (el pass-down que sostiene el render en servidor)**

| #   | Origen                                                                                                                                            | Cadena                                                                                                                                                                                                                                                     | Tipo  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| C1  | `canvasTheme(ui.dark)` en `Canvas.tsx:51`                                                                                                         | `DiagramScene[theme]` → cada `*Shape[theme]` y `ConnectorLayer[theme]` (`DiagramScene.tsx:121,147`)                                                                                                                                                        | **D** |
| C2  | `tools.previewModel` → `culledModel`                                                                                                              | `DiagramScene[model]` → `Shape[shape]` (por elemento), `Shape[lookup]` (cierre sobre `model.shapes`), `ConnectorLayer[connectors=model.connectors]`                                                                                                        | **D** |
| C3  | `interactionFor` (`Canvas.tsx:453-504`, cierra sobre `ui.selectedIds`, `collisions`, `ui.connectorSourceId`, `dispatchUi` y los handlers locales) | `DiagramScene[interactionFor]` → llamado por forma → `Shape[interaction]` → `handlersFor(id, interaction)` esparce `onPointerDown/onClick/onDoubleClick/onContextMenu` sobre el `<rect>`/`<path>` de golpe. **Profundidad 3, la mayor del front**          | **D** |
| C4  | objeto `connectorInteraction` (`Canvas.tsx:594-683`)                                                                                              | `DiagramScene[connectorInteraction]` → `{...spread}` en `ConnectorLayer` (8 props: `selectedId`, 6 handlers, `labelPositionName`). `ConnectorLayer` deriva `interactive = Boolean(onContextMenu ∥ onClick)` (:55) y sin ello no dibuja hit-paths ni clases | **D** |
| C5  | `(count) => t('canvas.services', {count})`                                                                                                        | `DiagramScene[summaryLabel]` → **string** ya traducido → `GroupShape[summary]` (`DiagramScene.tsx:123`). Nada bajo la escena recibe `t` (`shapeProps.ts:16-21`)                                                                                            | **D** |
| C6  | `DiagramDocument[dark, model]` (desde `renderSvg`/`exportOptions()`)                                                                              | `canvasTheme(dark)` → `DiagramScene[theme, model]` → formas / `ConnectorLayer`, **sin** `interactionFor`, `collapsed`, `summaryLabel`, `connectorInteraction` (`DiagramDocument.tsx:68`)                                                                   | **D** |
| C7  | `SharedDiagram` estado `model`, `dark` de la URL                                                                                                  | `DiagramScene[model, theme]` igual que C6 (`SharedDiagram.tsx:157`)                                                                                                                                                                                        | **D** |

Obsérvese que `ShapeInteraction.selected/colliding/isConnectorSource` se
calculan (`Canvas.tsx:455-457`) pero **ninguna forma los lee**: los contornos de
selección, colisión y origen de conector se dibujan en el overlay de `Canvas`
(`:727-813`), fuera de la escena, "deliberately outside DiagramScene so exports
and embeds cannot pick it up" (`Canvas.tsx:702-703`).

**Biblioteca**

| #   | Origen                                                   | Cadena                                                                                                                                                                                                                                                                             | Tipo                                                                                      |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| L1  | `useLocale().t` en `Library`                             | `LibraryHeader[t]` → `WorkspaceActions[t]`; `TemplateGallery[t]` → `TemplateFace[t]` → `TemplateMeta[t]` (**prof. 3**); `TemplateGallery[t]` → `BlankFace[t]`; `NewDiagramDialog[t]` → `TemplateFace[t]` → `TemplateMeta[t]` (**prof. 3**); `NewDiagramDialog[t]` → `BlankFace[t]` | **I** (`useLocale` está disponible en cualquier sitio)                                    |
| L2  | `Library.refresh`                                        | `LibraryHeader[onRefresh]` → `WorkspaceActions[onChanged]`. `LibraryHeader` **no lo lee**                                                                                                                                                                                          | I (pasarela pura). Nótese que `WorkspaceActions` sí llama `useRepository()` por su cuenta |
| L3  | `useRef` en `Library`                                    | `LibraryToolbar[searchRef]` → `SearchField[inputRef]`. `LibraryToolbar` no lo lee                                                                                                                                                                                                  | D (ref hacia una primitiva)                                                               |
| L4  | estado `query`/`setQuery`                                | `LibraryToolbar[query,onQuery]` → `SearchField[value,onChange]`                                                                                                                                                                                                                    | D (primitiva controlada)                                                                  |
| L5  | `previews[i]` / `yours[i]` derivados                     | `TemplateGallery`/`NewDiagramDialog[previews,yours]` → `TemplateFace[src,title,hint,model]` → `TemplateMeta[model]` (**prof. 3**)                                                                                                                                                  | D                                                                                         |
| L6  | derivados `total`, `starredCount`, `folders[i][1]`       | `LibraryToolbar[…]` → `Chip[count]`                                                                                                                                                                                                                                                | D                                                                                         |
| L7  | `yours.length` / `previews.length`                       | `NewDiagramDialog` → `GroupHeader[count]`                                                                                                                                                                                                                                          | D                                                                                         |
| L8  | `useTheme().dark/toggle`, `useUser().user/state/signOut` | `LibraryHeader[dark, authState, user, displayName, onToggleTheme, onSignOut]` (1 nivel) — el único sitio donde el tema baja por props                                                                                                                                              | I (1 nivel)                                                                               |

### 7.3 Componentes pasarela (reciben un prop y solo lo reenvían)

| Componente                                           | Prop que no lee                                                                                                                       | Lo reenvía a                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `EditorShell`                                        | `documentId`, `onSnapshot`, `onRestore`, `revision`, `status` (lo lee una vez para un banner), `title` (lo lee una vez para comparar) | `CommentsProvider`/`useCollaboration`, `VersionPanel`, `TopBar`, `StatusBar` |
| `TopBar`                                             | `collab`                                                                                                                              | `PresenceStack`                                                              |
| `ShareDialog` → `ShareContents`                      | `accessVersion` (dos saltos sin leerlo)                                                                                               | `SharePeople`                                                                |
| `IconPicker`                                         | `locale`                                                                                                                              | `Popover`                                                                    |
| `IconsDialog`                                        | `library` (lee solo `.shared`)                                                                                                        | `IconLibraryManager`                                                         |
| `ExportMenu` / `MoreMenu` / `AccountMenu`            | `onClose`, `menu.closing`, `menu.onExited`                                                                                            | `TopBarMenu`                                                                 |
| `TemplatesDialog` / `MarkdownDialog` / `IconsDialog` | `closing`, `onExited`                                                                                                                 | `Dialog`                                                                     |
| `LibraryHeader`                                      | `onRefresh`                                                                                                                           | `WorkspaceActions[onChanged]`                                                |
| `LibraryToolbar`                                     | `searchRef`                                                                                                                           | `SearchField[inputRef]`                                                      |
| `TemplateFace`                                       | `t`, `model`                                                                                                                          | `TemplateMeta`                                                               |

### 7.4 Componentes y hooks **puros** (props solamente, sin hooks de contexto)

Renderizables en servidor (probado por `renderToStaticMarkup` en
`renderSvg.ts:18` y `export.test.ts`):
`DiagramDocument` (+ `BrandFooter`), `DiagramScene`, `Defs`, `ConnectorLayer`,
`shapes/RegionShape`, `BoundaryShape`, `GroupShape`, `ContainerShape`,
`ItemShape`, `NoteShape`, `TextShape`, `RichText`, `icons/Glyph`.

Solo cliente pero sin contexto (props + DOM/refs):
`ConnectorHandles` (`useId`, `useRef`, `querySelector`), `CodeEditor`,
`ShapeHero`, `inspector/fields.tsx` (`ChoiceField`, `FillPresets`, `FillField`),
`IconPicker` y `Popover`\*, `CustomIcons` (`CustomGlyph`, `MineSection`,
`UploadForm`), `Composer`, `Thread`, `TopBarMenu`, `MenuItem`, `Dialog`,
`CopyField`, `usePointerTools`, todo `ui/*`, todo `library/*` salvo `Library` y
`WorkspaceActions`, `AcMark`/`AcGraphLogo`, todos los iconos.

\* `Popover` llama `useIconLibrary()`, que a su vez llama `useIconLibraryApi()`
(contexto de repositorio), así que es puro respecto al `EditorContext` pero no
respecto al `RepositoryContext`.

### 7.5 Componentes de **contexto puro** (cero props de datos)

`Toast`, `CloudSwitchAnnouncer`, `Canvas`, `SelectionToolbar`, `ContextMenu`,
`Breadcrumb`, `EmptyState`, `ServiceBrowser`, `Presentation`, `ViewBar`,
`FindBar`, `ToolDock`, `InspectorPanel`, `CodePanel`, `CommandPalette`,
`PaletteContents`, `Modals`, `AiDialog`, `Library`, `SharedDiagram`,
`SignInGate` (solo `children`), `ProviderPrompt`, `LanguageSwitch`,
`BuildStamp`. Casi puros: `ShareDialog` (un número opcional), `StatusBar` (solo
`status`), `ZoomControls`/`Minimap`/`InsightsPanel`/`CommentsPanel` (solo
`size`), `VersionPanel` (tres props del documento).

### 7.6 Guía de decisión al añadir un componente

1. **¿Está bajo `EditorProvider` y necesita `ui`, `doc`, `view`, `dispatch`,
   `readOnly` o `t`?** Llama a `useEditor()`. No lo recibas por props.
2. **¿Necesita algo del documento que no está en el contexto (`status`,
   `save`, `snapshot`, `revision`, `role`)?** Recíbelo por props desde
   `EditorShell`, como hacen `TopBar`, `StatusBar` y `VersionPanel`. No metas
   el `DiagramDocument` en el `EditorContext`: el provider se remonta con
   `key` y el guardado tiene que sobrevivirle.
3. **¿Se dibuja dentro de `DiagramScene`?** Props solamente. Nada de hooks,
   nada de `t` (pásale strings ya traducidos, como `summary`), nada de
   `window`. Si necesita interacción, extiende `ShapeInteraction` y pásala
   por `interactionFor`. Si es cromo (contornos, asas, guías), va al overlay
   de `Canvas`, no a la escena.
4. **¿Es una primitiva reutilizable (`ui/*`)?** Sin contexto, sin `t`: recibe
   strings y callbacks; añade su caso a `ui.test.ts`.
5. **¿Está en la biblioteca?** Recibe datos de `Library` por props; si
   necesita el repositorio directamente (como `WorkspaceActions`), llama
   `useRepository()` y no lo pidas por props.
6. **¿Necesita el id del diagrama?** Recíbelo de `EditorShell` (`documentId`),
   no lo vuelvas a leer con `useParams`.
7. **¿Necesita el idioma fuera del editor?** `useLocale()`. Dentro,
   `useEditor().t`. No hay contexto de idioma ni de tema y no hace falta
   crearlo: son stores externos (§4).

---

## 8. Canvas: del evento DOM al reducer

`Canvas` (`canvas/Canvas.tsx`, 885 líneas) no recibe props. Lee
`useEditor()` (:43) y `useCommands()` (:46), y delega toda la mecánica de
gestos en `usePointerTools` (:59-83), un hook sin contexto que recibe el
modelo, la cámara y 7 callbacks que envuelven `dispatch`/`dispatchUi`.

| Gesto                                    | Evento DOM                                                                                     | Camino                                                                                                | Acción final                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Seleccionar forma                        | `<rect {...handlersFor}>` → `interaction.onPointerDown`                                        | `Canvas.onShapePointerDown` (:366-385)                                                                | `dispatchUi select`/`toggleSelected`, luego `tools.startDrag`                                                                                                |
| Arrastrar / duplicar con Alt             | `pointermove` en `window` (rAF) → `applyMove`                                                  | `previewModel` (`previewDrag`/`previewDuplicate`) se pinta como `model`; `guides` como `.align-guide` | `pointerup` → `onMoveShapes` → `dispatch moveShapes {viewId}` o `onDuplicateShapes` → `dispatch paste` + `select` de lo creado (`selectNextCreated`, :89-97) |
| Redimensionar                            | `<rect.resize-handle onPointerDown>` (:859-870), solo con una forma no-contenedor desbloqueada | `tools.startResize` → `previewResize`                                                                 | `onResizeShape` → `dispatch resizeShape`                                                                                                                     |
| Conectar                                 | dos clics con la herramienta `connector` (`onShapeClick` :397-406)                             | `dispatchUi setConnectorSource` en el primero                                                         | `dispatch addConnector` en el segundo (rechaza decorativos en el reducer)                                                                                    |
| Lasso                                    | `<svg onPointerDown>` sin forma debajo (:345-349)                                              | `tools.startLasso`; `lassoBox` como `.lasso`                                                          | `onLassoSelect(ids, 'replace'\|'add'\|'subtract')` → `dispatchUi modifySelection`                                                                            |
| Pan                                      | botón central, `Space` mantenido, herramienta `pan`, o presentando                             | `tools.startPan` → `applyMove` llama `onViewportChange` en vivo                                       | `dispatchUi setViewport`                                                                                                                                     |
| Zoom / scroll                            | listener nativo no-pasivo en `hostRef` (:224-246)                                              | `zoomAt` con Ctrl/Meta, pan con rueda                                                                 | `dispatchUi setViewport`                                                                                                                                     |
| Codo de conector                         | doble clic en el conector inserta; arrastre/teclado en `ConnectorHandles`                      | `tools.startBend` / `onChange(waypoints, coalesceKey)`                                                | `dispatch setConnectorRoute`                                                                                                                                 |
| Etiqueta de conector                     | `onLabelPointerDown` / `onLabelKeyDown` vía `connectorInteraction`                             | `tools.startLabel`                                                                                    | `dispatch setConnectorProps {labelAt}`                                                                                                                       |
| Colocar boundary/grupo/región/nota/texto | `onBackgroundPointerDown` con herramienta activa (:307-344)                                    | `placed.current = true` traga el clic siguiente                                                       | `dispatch addBoundary/addGroup/addDecoration` + `setTool select` + `select`                                                                                  |
| Soltar desde el navegador de servicios   | `<div onDrop>` (:422-451) con `text/plain` = clave                                             | icono custom → `commands.addCustomService(icon, {x,y})`                                               | catálogo → `dispatch addGroup {service}`                                                                                                                     |
| Menú contextual                          | forma / conector / lienzo vacío                                                                | `dispatchUi openContextMenu {x,y,canvasX,canvasY,shapeId?,connectorId?}`                              | `ContextMenu` se monta **fuera** del canvas (`DiagramEditor.tsx:349`) por el stacking context                                                                |
| Doble clic en forma                      | `interactionFor().onDoubleClick`                                                               | `drillInto` si `E.canDrillInto`, si no `select` + foco al inspector                                   | `dispatchUi`                                                                                                                                                 |

La cámara se anima localmente (`glide`, :120-146) y `shown` es la cámara
pintada; `culledModel` (:257-262) recorta lo que está fuera del viewport.

---

## 9. El mismo escenario en pantalla, en export y en servidor

| Salida                             | Función                                                                            | Cómo renderiza                                                              | Quién la llama                                                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/embed` (SVG)                 | `diagramToSvgString(options)` (`lib/editor/renderSvg.ts:16`)                       | `renderToStaticMarkup(createElement(DiagramDocument, options))`             | `src/app/api/embed/route.ts:35-39` con `{ model, dark, brand: 'none' }`                                                                                                           |
| Export SVG/PNG/PDF/PPTX            | `diagramToSvgStringClient(options)` (`renderSvgClient.ts:18`)                      | `createRoot` + `flushSync` en un `<div>` fuera de pantalla, `XMLSerializer` | `lib/editor/export.ts` (`downloadSvg`, `rasterise`) ← comandos `export*` de `useCommands` con `exportOptions()` = `{ model: projectView(view), dark, brand, title, description }` |
| Miniaturas de tarjetas y versiones | `renderPreview` (`lib/store/preview.ts:30`), `renderThumbnail` (`thumbnail.ts:13`) | **SVG a mano**, deliberadamente no el renderer real                         | `Library`, `useDiagramPreviews`, `VersionPanel`                                                                                                                                   |
| Enlace compartido                  | `SharedDiagram`                                                                    | `<Defs/>` + `<DiagramScene model theme/>` con su propia cámara local        | `/share?d=…`                                                                                                                                                                      |

`DiagramDocument` (`canvas/DiagramDocument.tsx:10-21`) es el `<svg>` completo:
`viewBox`, `<title>`, `<desc>`, `<Defs>`, fondo, `<DiagramScene>` y el pie de
marca. No lleva `'use client'`, no tiene hooks, y si algún descendiente llamara
a `useEditor()` el embed lanzaría (`EditorProvider.tsx:68`), lo que es la
garantía práctica de pureza de la escena.

---

## 10. Biblioteca (home)

`Library` (`library/Library.tsx:37`) no recibe props. Es el único componente
de la home con hooks de contexto: `useRepository`, `useMembersApi`,
`useRepositoryReady`, `useUser`, `useTheme`, `useLocale`, `useLibraryPrefs`,
`useRouter`, más `usePresence` ×2, `useDiagramPreviews` ×2 y `useActiveSection`.

Estado propio: `all` (lista completa), `loading`, `query`, `folder`,
`picking`, `deleting`, `entering`, `dragDepth`, `notice`, `searchRef`.
Derivados: `items`/`templates` (por `meta.template`), `visible` (filtro +
`sortDiagrams`), `folders`, `starred`, `latest`, `previews` de plantillas.

```
<div.library onDrop=…>
├─ <LibraryHeader t dark section authState user displayName onHome onRefresh onToggleTheme onSignOut onNew/>
│    └─ <WorkspaceActions onChanged={onRefresh} t={t}/>        ← llama useRepository() por su cuenta
├─ <LibraryHero t loading showcase recent onNew onBrowseTemplates onPick onOpen/>
├─ <main>
│  ├─ <LibraryToolbar t query onQuery searchRef visibleCount total sort onSort folders folder onFolder starredCount/>
│  │    ├─ <SearchField value onChange inputRef trailing/>      ← ui/
│  │    └─ <ChipRow><Chip count/>…</ChipRow>                    ← ui/
│  ├─ skeleton | vacío | sin resultados | <ul> visible.map → <DiagramCard t item index starred preview observe onOpen onToggleStar onDuplicate onRemove/>
│  └─ <TemplateGallery t previews yours entering onPick onEdit onRemove/>
│       └─ <TemplateFace t src title hint model/> → <TemplateMeta t model/>
├─ <footer> buildStamp(locale)
├─ {confirm.shown} <ConfirmDialog t closing onExited message confirmLabel onCancel onConfirm/>
└─ {pick.shown}    <NewDiagramDialog t previews yours closing onExited onClose onPick/>
```

| Acción                        | Disparador                                                                                           | Efecto                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Crear                         | `onNew` (cabecera, hero, vacío) → `NewDiagramDialog` → `onPick`; o `onPick` directo del hero/galería | `repository.create({title, model})` → `router.push('/d/:id')`                                                                      |
| Abrir                         | tarjeta, hero, editar plantilla                                                                      | `router.push('/d/:id')`                                                                                                            |
| Duplicar                      | `DiagramCard[onDuplicate]`                                                                           | `repository.duplicate(id, { title: t('library.copyTitle') })` → `refresh` (el título se traduce aquí: el store no sabe de idiomas) |
| Borrar / abandonar            | `DiagramCard`/`TemplateGallery[onRemove]` → `ConfirmDialog`                                          | si `role !== 'owner'` y hay `membersApi`: `removeMember(id, user.id)`; si no `repository.delete(id)` → `refresh`                   |
| Estrella                      | `DiagramCard[onToggleStar]`                                                                          | `toggleFavourite(id)` en `localStorage`; si se vacía Favoritos, vuelve a "Todos"                                                   |
| Importar (arrastrar)          | `onDrop` en la raíz (:168-192)                                                                       | `readDroppedFile(name, text, locale)`: workspace → `importWorkspace`; diagrama → `create`                                          |
| Importar / exportar workspace | `WorkspaceActions`                                                                                   | `repository.exportWorkspace()` / `importWorkspace()` → `onChanged` = `refresh`                                                     |
| Tema / salir                  | `LibraryHeader`                                                                                      | `useTheme().toggle` / `useUser().signOut`                                                                                          |
| ⌘K                            | `keydown` global (:241-251)                                                                          | enfoca `searchRef` salvo con un diálogo abierto                                                                                    |

No hay flujo de **renombrar** en la biblioteca (`updateMeta` no se llama aquí;
se renombra desde el `TopBar` del editor).

Las miniaturas de las tarjetas se cargan de forma perezosa:
`useDiagramPreviews(repository, items, dark, { upfront: [latest.id] })` observa
cada `<li>` con un `IntersectionObserver` compartido y llama `repository.get`
con concurrencia 4 y caché de 96 (`useDiagramPreviews.ts:17-19`).

---

## 11. Comentarios, colaboración y presencia

**Comentarios** viven **al lado** del modelo, no dentro: `CommentsProvider`
(`comments/CommentsProvider.tsx:51-62`) recibe `diagramId`, `version` (contador
que sube con cada evento SSE de comentario) y `canModerate` (`role === 'owner'`),
llama `useRepository()`/`useRepositoryReady()` y expone `useComments()`. Un
comentario no pasa por `docReducer`: no se deshace ni cambia la revisión.
`CommentPins` se renderiza **dentro** del `<svg>` de `Canvas` (`Canvas.tsx:690-699`)
con `model={view}`, `zoom`, `draft`, `t` y `onOpen` por props, y lee
`useComments().open` por su cuenta.

**Colaboración** (`hooks/useCollaboration.ts`): `enabled = mode === 'server'`.
Abre un `EventSource` a `/api/diagrams/:id/events` mediante
`subscribeToDiagram` (`lib/collab/client.ts:106`, funciones, no clase) y
traduce cada evento:

| Evento SSE | Qué hace el hook                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saved`    | `repository.get(id)` → `doc.adoptRemote(record)` → `onRemoteModel` → `dispatch replaceModel {origin:'remote'}` + `clearSelection`; `lastRemoteSave` → toast |
| `presence` | `users: PresenceUser[]` → `TopBar[collab]` → `PresenceStack`; `RemoteCursors[users]`                                                                        |
| `meta`     | `onRemoteTitle(title)` → `onRename` si difiere                                                                                                              |
| `access`   | `onAccess` → `document_.applyAccess(role, by)` si soy yo; `accessVersion++` → `ShareDialog` recarga miembros                                                |
| `comment`  | `commentsVersion++` → `CommentsProvider` refresca; `lastRemoteComment` → toast                                                                              |
| `deleted`  | `deletedBy` → banner; se cierra la suscripción                                                                                                              |

La presencia propia sale con `sendPresence` (POST, `keepalive`): el cursor
convertido a coordenadas de lienzo con `toCanvas(viewport, …)` a 80 ms de
throttle, y `editing` cuando `doc.status` es `pending`/`saving`.

---

## 12. Transversales

### 12.1 i18n

`src/lib/i18n/messages.ts`: `LOCALES = ['es','en']`, 649 claves, paridad
forzada por tipos (`es: Record<MessageKey, string>`), `translate(locale, key,
values?)` con fallback a `en` y luego a la clave. El idioma llega por **dos
caminos y ningún contexto**:

- Dentro del editor: `ui.locale` → `t` en `useEditor()`.
- Fuera (`PageState`, `SignInGate`, `Library`, `SharedDiagram`, y el propio
  `DiagramEditor` antes de montar el provider): `useLocale()` sobre las
  preferencias en `localStorage`.

Ambos leen y escriben la misma clave `aion-studio-preferences`. El tipo
`Translate` está redeclarado localmente en 9 archivos en vez de importarse
(§14).

### 12.2 Tema

Fuente de verdad: `prefs.theme` (`'system'|'light'|'dark'`) y `prefs.accent`
en `localStorage`. Se aplica en tres momentos:

1. **Antes de hidratar**: script inline en `layout.tsx:62-66` quita `.dark` y
   pone `data-accent` para que no haya destello.
2. **Fuera del editor**: `ThemeSync` (`useTheme.ts:78-81`) sigue prefs +
   `matchMedia` y espeja `dark`/`accent` en `<html>`. `Library` llama
   `useTheme()` y baja `dark`/`toggle` por props a `LibraryHeader`.
3. **Dentro del editor**: `EditorProvider` guarda **una segunda copia** en
   `ui.theme`/`ui.dark`, la persiste en la misma clave y también toca `<html>`
   (`EditorProvider.tsx:91-93, 114-136`). Los componentes del editor leen
   `ui.dark`; `AccountMenu` despacha `setTheme`. El provider escribe la clave
   **sin** llamar a `notifyStoreChanged()`, así que `ThemeSync` se entera en su
   siguiente render o por el evento `storage` de otra pestaña.

### 12.3 Atajos

Un solo registro: `src/lib/editor/shortcuts.ts` — `SHORTCUT_GROUPS` (5 grupos,
46 bindings `{ id, keys, labelKey, scope: 'global'|'canvas'|'tool' }`),
`shortcutFor(id)`, `chordOf(event)`, `bindingFor(chord)`. `useKeyboard` lo
ejecuta, `useCommands` y `TopBar` lo imprimen (`spellChord` en `platform.ts`),
`Modals` dibuja la hoja `?`. Un atajo se declara una vez y no puede divergir.

### 12.4 Animaciones de salida: `usePresence` / `exitProps`

`src/lib/editor/usePresence.ts:32`: `usePresence(value)` → `{ shown, closing,
onExited, key }`. Mientras `value` es falsy pero algo se estaba mostrando,
`shown` sigue siendo el valor anterior y `closing = true`; `exitProps(closing,
onExited)` pone `data-closing` y llama `onExited` al terminar una animación
cuyo nombre acaba en `-out`, con fallback de 260 ms. 12 archivos lo usan
(`Toast`, menús, modales, `ShareDialog`, `IconPicker`, `ContextMenu`,
`AiDialog`, `SignInGate`, diálogos de la biblioteca). Los diálogos de `Library`
no usan `key` para remontar el contenido (§14).

### 12.5 Efectos globales

- `useGlobalRipple` (`app/useRipple.ts`): tinta en `pointerdown` sobre los
  selectores de `TAKES_INK`, salvo dentro de `.library` y con
  `prefers-reduced-motion`.
- `useTooltips` (`app/useTooltips.ts`): un solo `div.tooltip` para toda la
  app; mueve `title` a `data-tooltip`.
- `useLiquidPointer` (`app/useLiquidPointer.ts`): escribe `--gx/--gy` en el
  elemento para el brillo que sigue al puntero; lo usan 9 superficies
  flotantes vía `onPointerMove`.
- `useReturnFocusToCanvas` (`lib/editor/returnFocus.ts`): al desmontar un
  panel, devuelve el foco al `<svg>` si el elemento activo desapareció.

---

## 13. Dónde se prueba cada capa

| Capa                                               | Prueba                                                                 | Comando                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------- |
| Reducers, viewport, atajos, presencia, i18n, store | `src/lib/**/*.test.ts` (Vitest, happy-dom, fake-indexeddb)             | `npm test`                              |
| Primitivas `ui/*`                                  | `src/components/ui/ui.test.ts` compara `innerHTML` byte a byte         | `npm test`                              |
| Escena en servidor                                 | `src/lib/editor/export.test.ts` (sin cromo en el SVG), `views.test.ts` | `npm test`                              |
| Pines de comentarios                               | `src/components/editor/comments/CommentPins.test.ts`                   | `npm test`                              |
| Flujos completos                                   | `e2e/*.spec.ts` (Playwright, proyecto `functional`)                    | `npm run test:e2e:critical`             |
| Píxeles                                            | proyecto `visual`                                                      | `npm run test:visual`                   |
| Controles y roles                                  | `scripts/audit-controls.mjs`, `audit-roles.mjs`                        | `npm run audit:controls`, `audit:roles` |
| Tipos                                              | `next typegen && tsc --noEmit`                                         | `npm run typecheck`                     |

No hay tests unitarios de componentes en `components/library/` ni de la mayor
parte de `components/editor/chrome/`; su cobertura es E2E.

---

## 14. Observaciones (hechos verificados, no recomendaciones)

Todo lo siguiente está en el código hoy. Se lista para que una decisión
posterior se tome con datos, no para prescribir el cambio.

1. `EditorContext.selectedShape` (`EditorProvider.tsx:51,175-179`) no tiene
   consumidores; `InspectorPanel.tsx:19-20` recalcula lo mismo desde `view`.
2. `EditorShell` recibe el `DiagramDocument` entero **y** 10 de sus campos
   aplanados (`DiagramEditor.tsx:455-465`). `onRename` es una arrow nueva en
   cada render.
3. `VersionPanel.tsx:37` y `ShareDialog.tsx:105` re-leen el id con
   `useParams` aunque `EditorShell` ya tiene `documentId`.
4. `useCommands()` se instancia en 6 sitios y cada uno memoiza su propia lista
   de 46 comandos con ~24 dependencias.
5. `t` se pasa como prop a `IconPicker → Popover → MineSection/UploadForm`,
   `Composer`, `Thread`, `CommentPins`, `ConnectorHandles`, y `locale` a
   `IconPicker → Popover`, estando todos bajo `EditorProvider` (E13, E14, E18).
   En la biblioteca, `t` baja tres niveles hasta `TemplateMeta` (L1).
6. El tipo `Translate` está redeclarado en 9 archivos
   (`rg "type Translate\s*=" src/components`).
7. El tema tiene dos copias vivas (`ThemeSync` y `ui.theme/ui.dark`) que
   escriben la misma clave y la misma clase; `EditorProvider` no llama
   `notifyStoreChanged()` al persistir (§12.2).
8. `ZoomControls.tsx:57-66` duplica la lógica de "ajustar a la vista" del
   comando `zoomFit` (`useCommands.ts:95-102, 231-237`).
9. La medida de `.canvas-surface` se toma en `useCanvasSize` y se baja como
   `size` a cuatro paneles, mientras `useCommands`, `FindBar`, `Presentation` y
   `useCollaboration` la re-miden con `querySelector`.
10. `AiDialog` ejecuta todos sus hooks aunque esté cerrado (el `return null`
    está después de ellos, `AiDialog.tsx:108`), así que su efecto de montaje
    corre al abrir el editor, no al abrir el diálogo.
11. `usePresence().key` no se usa como `key` en los diálogos de `Library.tsx`.
12. `ShapeInteraction.selected/colliding/isConnectorSource` se calculan pero
    ninguna forma los lee (el overlay de `Canvas` dibuja esos estados).
13. `src/lib/editor/index.ts` solo re-exporta `types.ts`; `EditorState` y
    `ContextMenuState` en ese archivo no son las formas que usa `uiReducer`
    (`UiState`, `ContextMenuTarget`). Todo lo demás se importa por ruta
    profunda.
14. El `Translate`-por-props y el `size`-por-props conviven con 18
    componentes de contexto puro en el mismo árbol: el patrón dominante es
    contexto; el pass-down incidental es la excepción, no la norma.

---

## 15. Cómo mantener este documento

- Los cinco contextos: `rg -n "createContext" src --glob '!*.test.*'`.
- Quién lee el contexto del editor: `rg -c "useEditor\(\)" src/components`.
- Cadenas de `t` por props: `rg -n "t=\{t\}" src/components`.
- Componentes sin `'use client'` bajo `components/` (los isomorfos: escena,
  formas, iconos y `Kbd`; debe seguir dando 16 archivos):
  `rg --files-without-match "'use client'" src/components --glob '*.tsx'`.
- Después de mover código, actualizar los `archivo:línea` de las secciones 5,
  6 y 7; el resto referencia símbolos y sobrevive a los movimientos.
