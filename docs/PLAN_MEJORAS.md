# Plan de mejoras de AC Graph — funcional y visual

Fecha: 2026-09-09 · Base analizada: estado del repositorio tras las entregas "Aurora IV" (ver `docs/CHECKPOINTS.md`).

## Estado (checkpoint 2026-09-09, cierre de H1)

| Horizonte                   | Estado              | Detalle                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1 · Consolidar**         | **8 de 8 cerrados** | ✅ #1 consolidación CSS (fase 1, exacta) · ✅ #2 componentes (`PanelHead`, `Row/Tile/Field/Chip/GroupHeader/SearchField/Kbd`, seis superficies, `TopBar`/`Library` partidos) · ✅ #3 E2E estables + auditoría en CI · ✅ #4 regresión visual (24 estados) · ✅ #5 observabilidad (logs JSON, `/api/metrics`, OTel opcional) · ✅ #6 bus multi-réplica (`LISTEN/NOTIFY`) · ✅ #7 roles por diagrama · ✅ #8 páginas de error/404 (esqueletos pendientes) |
| **H2 · Producto de equipo** | 5 de 12             | ✅ #13 ⌘F (adelantado) · ✅ #10 presentación · ✅ #12 notas, texto y regiones · ✅ #20 plantillas propias · ✅ #14 iconos en servidor · resto pendiente.                                                                                                                                                                                                                                                                                                |
| **H3 · Plataforma**         | pendiente           | —                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Victorias rápidas**       | 10 de 10            | Cerradas el 2026-09-10 (la #10 por medición: no hay nada que virtualizar).                                                                                                                                                                                                                                                                                                                                                                              |

Cómo retomar: `docs/CONTEXTO.md` (entorno, comandos, decisiones, límites, siguiente paso). Registro detallado de cada entrega: `docs/CHECKPOINTS.md`.

Este documento parte de una lectura completa del código, no de la lista de deseos. Cada propuesta dice **qué**, **por qué**, **dónde** (archivos), **cómo se verifica** y **cuánto cuesta** (S ≤ 1 día · M 2–4 días · L 1–2 semanas · XL > 2 semanas). Complementa a `PLAN_MAESTRO.md` (fases F0–F9) y a `PLAN_DISENO.md` (anatomía Aurora): aquí está el detalle accionable de lo que sigue.

---

## 1. Diagnóstico

### 1.1 Lo que ya es sólido

| Área           | Estado                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Modelo y motor | `src/lib/engine` (layout, routing, colisiones, clipboard, diff, vistas, análisis) con 400+ unitarias; reducer Immer con historial por parches y coalescencia de ráfagas.                               |
| Persistencia   | Coordinador de guardado, journal de borradores, Web Locks, IndexedDB transaccional y repositorio HTTP; recuperación y conflicto 412 verificados en E2E.                                                |
| Lenguaje       | DSL YAML con ida y vuelta (`src/lib/dsl`), Mermaid de salida, importadores Terraform / Kubernetes / OpenAPI / Markdown, exportación PNG/SVG/PDF/MD/Mermaid/YAML/JSON.                                  |
| Calidad        | 1041 unitarias, 135 E2E, auditoría funcional `scripts/audit-controls.mjs` (68 controles), paridad tokens↔CSS y contraste AA en tests, imagen Docker reproducible.                                      |
| Plataforma     | Modo servidor (PostgreSQL + OIDC), presencia y eventos SSE, CLI `ac-graph check` para CI y servidor **MCP** con 8 herramientas (leer, analizar, impacto, buscar, diff, escribir, estándares, mermaid). |
| Metadatos      | Cada campo del inspector tiene su marca en el lienzo (chips, etiquetas de conector, trazo por tipo).                                                                                                   |
| Visual         | Geist, paleta pizarra-azul, cristal, una anatomía (Aurora), cinco tonos, tooltips propios, cámara que se desliza, encuadre al abrir.                                                                   |

### 1.2 Deuda y riesgos que condicionan todo lo demás

| Riesgo                                                                                                                 | Evidencia                                                                                                               | Consecuencia si no se ataca                                                                 |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **CSS en capas de sobrescritura** (Nova → Nova VI → Aurora → Aurora IV): 8.935 líneas, 9 capas que dependen del orden. | `src/app/globals.css`; la homologación vive en selectores sobre clases viejas.                                          | Cada cambio visual cuesta más y rompe algo lejano; imposible razonar un componente aislado. |
| ~~**Componentes monolíticos**~~ (resuelto en H1 #2)                                                                    | `TopBar.tsx` 279, `Library.tsx` 352, inspector partido; `ui/` con pruebas de render.                                    | Queda: `useCommands.ts` (~300) sigue siendo un solo hook.                                   |
| ~~**Sin componentes de sistema**~~ (resuelto en H1 #2)                                                                 | `Panel`/`PanelHead`, `Row`, `Tile`, `Field`, `Chip`, `GroupHeader`, `SearchField`, `Kbd` en `src/components/ui/`.       | Queda: la paleta conserva su búsqueda propia; el menú contextual su fila propia.            |
| **E2E con estado compartido**                                                                                          | Un spec de biblioteca falla de forma intermitente con 2 workers (IndexedDB compartido).                                 | Ruido en CI, pérdida de confianza en la suite.                                              |
| ~~**Servidor sin roles**~~ (resuelto en H1 #7)                                                                         | Roles por diagrama y bus entre réplicas.                                                                                | Queda: un solo workspace, sin equipos (H3 #23).                                             |
| **Lienzo de familia única**                                                                                            | Frontera › grupo › contenedor › servicio, más la decoración de #12 (región, nota, texto); sin nodos libres ni imágenes. | Cubre arquitectura cloud anotada, no diagramas generales (F2/F6 del plan maestro).          |
| ~~**Sin observabilidad**~~ (resuelto en H1 #5)                                                                         | Logs JSON por petición, `/api/metrics`, trazas opcionales.                                                              | Queda: alertas y envío a un colector son del operador.                                      |
| **Iconos Azure/OCI no oficiales**                                                                                      | `vendor/icons/LEEME.md`.                                                                                                | Percepción de calidad desigual entre nubes.                                                 |

### 1.3 Método

- **Prioridad** = impacto en el usuario × frecuencia de uso ÷ esfuerzo, con veto por riesgo de regresión.
- **Definición de hecho**: unitarias + E2E + auditoría funcional en verde; captura antes/después en ambos temas; entrada en `CHECKPOINTS.md`.
- **Nada de adorno**: todo control nuevo entra en `scripts/audit-controls.mjs` con su cambio observable.

---

## 2. Horizontes

### H1 — Consolidar (2–3 semanas): que lo hecho sea sostenible

| #   | Mejora                                                  | Tipo           | Esfuerzo | Detalle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------- | -------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Consolidar el CSS en un sistema de diseño** ✅ fase 1 | Visual/deuda   | L        | Reducir `globals.css` a: tokens (`:root`, `.dark`, tonos) · primitivas (`Panel`, `Row`, `Tile`, `Field`, `Chip`, `Button`, `Kbd`, `Menu`, `Dialog`) · pantallas. Eliminar las nueve capas de sobrescritura reescribiendo cada bloque en su primitiva. Meta: < 4.500 líneas, cero `!important`, cero dependencias de orden entre capas. Verificación: capturas de referencia por pantalla antes/después con diff visual (ver #4).                                                                                                          |
| 2   | **Extraer componentes de sistema en React** ✅          | Deuda          | M        | Hecho en dos fases. Fase 1: `PanelHead`, inspector partido. Fase 2 (2026-09-10): `src/components/ui/{Kbd,SearchField,Chip,GroupHeader,Tile,Row,Field,Section}.tsx` con pruebas de render que fijan el HTML exacto; explorador, paleta, selector, historial, análisis, menús, atajos, dock, biblioteca e inspector migrados; `TopBar.tsx` 600→279 (`ExportMenu`, `MoreMenu`, `AccountMenu`) y `Library.tsx` 702→352 (`LibraryHeader`, `LibraryHero`, `LibraryToolbar`, `DiagramCard`, `TemplateGallery`). `styles:compare`: 0 diferencias. |
| 3   | **Estabilizar E2E** ✅                                  | Calidad        | S        | Un `storageState`/prefijo de base IndexedDB por worker (`test.info().parallelIndex`) y `resetWorkspace` que borre solo la suya. Añadir `scripts/audit-controls.mjs` al workflow de CI como job separado.                                                                                                                                                                                                                                                                                                                                  |
| 4   | **Regresión visual** ✅                                 | Calidad/visual | M        | Playwright `toHaveScreenshot` para 12 estados (portada, editor, inspector servicio/conector, explorador, paleta, selector, historial, análisis, diálogo compartir, atajos, menú cuenta) × 2 temas, umbral 0.2 %. Es lo que permite el punto 1 sin miedo.                                                                                                                                                                                                                                                                                  |
| 5   | **Observabilidad mínima** ✅                            | Operación      | M        | Hecho (`src/server/observability/`): `observe()` envuelve toda ruta con `requestId` (respetado desde el proxy, devuelto en `x-request-id`), línea de acceso JSON con `userId`/`diagramId`/`code`, métricas Prometheus en `/api/metrics` (latencia e histograma por plantilla de ruta, estados, 412, guardados, sesiones, SSE, transacciones, proceso; `METRICS_TOKEN` opcional) y trazas OTel solo con `OTEL_EXPORTER_OTLP_ENDPOINT`. Ver `CHECKPOINTS.md`.                                                                               |
| 6   | **Presencia multi-réplica** ✅                          | Plataforma     | M        | Hecho (`src/server/collab/{bus,collaboration}.ts`): `PgBus` con `LISTEN acgraph_collab` en conexión dedicada con reconexión y `NOTIFY` por el pool; `MemoryBus` sin base; presencia como estado absoluto por sesión con roster fusionado por réplica y TTL; eco propio ignorado por `origin`; métricas `acgraph_collab_bus_*`. Verificado con dos `npm start` sobre una misma base. Ver `CHECKPOINTS.md`.                                                                                                                                 |
| 7   | **Roles por diagrama** ✅                               | Plataforma     | L        | Hecho: `diagram_members` con backfill, repositorio con autorización en cada lectura/escritura (rol leído con el bloqueo de fila), rutas `members` (invitar por correo, cambiar rol, quitar, salir), `presence`/`events` solo para miembros, evento `access` en vivo, editor de solo lectura completo, sección «Personas» en Compartir, chip de rol y «Salir» en la biblioteca, `npm run audit:roles`. Ver `CHECKPOINTS.md`.                                                                                                               |
| 8   | **Errores y estados vacíos homologados** ✅ páginas     | Visual/UX      | S        | `error.tsx` y `not-found.tsx` en `src/app` con la anatomía Aurora; esqueletos en historial y análisis mientras cargan; estados vacíos con acción en cada panel.                                                                                                                                                                                                                                                                                                                                                                           |

### H2 — Producto de equipo (4–6 semanas): lo que hace que alguien lo elija

| #   | Mejora                                                          | Tipo              | Esfuerzo   | Detalle                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------- | ----------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | **Comentarios anclados**                                        | Colaboración      | L          | Comentarios en forma o conector (`model` no: tabla `comments` en servidor, IndexedDB en local), hilos, resolver, menciones `@nombre` con notificación por SSE; burbuja con contador en el lienzo; panel "Comentarios" con la anatomía de historial.                                                                                                                                                                                                         |
| 10  | **Presentación** ✅                                             | Visual/UX         | M          | Hecho (2026-09-10): `ui.presenting`, F5 / «Más › Presentar» / paleta; el chrome no se monta; lienzo a pantalla completa de la ventana sobre el tema; ← → PageUp/Down Inicio/Fin recorren las vistas con la cámara deslizándose y la devuelven al salir; título, vista, paginador, leyenda de tonos y tipos de llamada (`legendFor`); solo lectura mientras dura; `exportPdfViews` con `rastersToPdf` (una página por vista). Sin `requestFullscreen`.       |
| 11  | **Conectores editables**                                        | Editor            | L          | Puntos de paso arrastrables (`waypoints` ya existen en el modelo), reruteo automático al soltar, etiquetas desplazables a lo largo del trazo, elección de codo (ortogonal/curvo), grosor y color por conector. Quita el solape de etiquetas con bordes de grupo.                                                                                                                                                                                            |
| 12  | **Notas, texto y regiones** ✅                                  | Editor            | L          | Hecho (2026-09-10): `region`/`note`/`text` en `Shape.type` con `isDecorative`; markdown ligero ajustado por líneas sin `foreignObject` (`richText.ts`); herramientas R/N/T, menú contextual, inspector con Papel/Tinte/Tinta; sin colisión, sin rutas, sin conectores, `autoLayout` las ignora; DSL `notes:` (kind/text/at/size/fill, `nodes` opcional, vistas), Markdown y `<desc>`; la IA conserva las notas; esquema 4 con rechazo de versiones futuras. |
| 13  | **Buscar en el lienzo**                                         | UX                | S          | ⌘F: caja flotante que filtra formas por título/subtítulo/meta, resalta coincidencias, `Enter` centra la siguiente con la cámara que se desliza.                                                                                                                                                                                                                                                                                                             |
| 14  | **Biblioteca de iconos en servidor** ✅                         | Plataforma        | M          | Hecho (2026-09-10): tabla `icons` (migración 8) compartida por el workspace con `created_by`; `GET/POST /api/icons`, `DELETE /api/icons/[key]`; deduplicación por hash del dibujo (responde con el existente); cuota 200 iconos / 16 MB (`409 library_full`); el mismo `useIconLibrary()` con `localStorage` en local y API + espejo en servidor; copy «Iconos del workspace»; `audit:roles` 31/31.                                                         |
| 15  | **Iconos oficiales Azure y OCI**                                | Visual            | M          | Vendorizar los packs oficiales (licencias permiten uso en diagramas), mapear claves en `scripts/refreshIcons.mjs`, regenerar `svgIconDefs.ts`. Sube la paridad de 313/572 a ~520/572.                                                                                                                                                                                                                                                                       |
| 16  | **Importadores: CloudFormation, Docker Compose, Pulumi (JSON)** | Interoperabilidad | M cada uno | Mismo contrato que `src/lib/import/terraform.ts` (detectar → grafo → modelo), con fixtures reales y pruebas de round-trip por Mermaid.                                                                                                                                                                                                                                                                                                                      |
| 17  | **Exportación draw.io y PPTX**                                  | Interoperabilidad | M / L      | `.drawio` (mxGraph XML) desde el modelo con iconos incrustados; PPTX con `pptxgenjs` una diapositiva por vista. Ambas entran en el menú Exportar con su descripción.                                                                                                                                                                                                                                                                                        |
| 18  | **IA que edita, no solo genera**                                | IA                | L          | Comando "Pídele a la IA" en la paleta y menú contextual: instrucciones en lenguaje natural sobre la selección ("añade una caché entre API y base de datos", "marca todo como prod"). La IA devuelve un parche de acciones del reducer (no un modelo entero) → un paso de deshacer. Streaming de la respuesta; presupuesto por sesión visible.                                                                                                               |
| 19  | **Revisión asistida por estándares**                            | IA/Análisis       | M          | La IA explica cada hallazgo de `src/lib/rules` con remedio concreto y ofrece aplicarlo (parche). El informe se exporta a Markdown/PDF con el diagrama incrustado.                                                                                                                                                                                                                                                                                           |
| 20  | **Plantillas propias** ✅                                       | Biblioteca        | S          | Hecho (2026-09-10): `template` en el registro de diagrama (migración 7); «Guardar como plantilla» en Más y ⌘K crea una copia marcada; la portada la dibuja con `renderPreview` tras «Lienzo en blanco» con Editar/Eliminar y no la cuenta como diagrama; el diálogo del editor la lista bajo «Tuyas»; compartir = invitar (H1 #7).                                                                                                                          |

### H3 — Plataforma (6–10 semanas): escala y ecosistema

| #   | Mejora                                     | Tipo              | Esfuerzo | Detalle                                                                                                                                                                                    |
| --- | ------------------------------------------ | ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 21  | **Edición simultánea (CRDT)**              | Colaboración      | XL       | Yjs sobre el modelo con ids estables (ya existen); presencia de cursores por forma; conflicto 412 desaparece. Requiere #6 y el bus.                                                        |
| 22  | **Offline real (PWA)**                     | Plataforma        | M        | Manifest, service worker con precache del shell, cola de sincronización sobre el journal existente, indicador "sin conexión" en la barra de estado (el `SaveStatus` ya distingue estados). |
| 23  | **Multi-workspace y facturación opcional** | Producto          | L        | Workspaces con miembros y roles (extiende #7), cuotas (diagramas, iconos, IA), páginas de administración.                                                                                  |
| 24  | **Escaneo de cuenta cloud (solo lectura)** | Interoperabilidad | XL       | Conector AWS (Resource Groups Tagging + Config) que genera un modelo inicial; después Azure/GCP. Requiere credenciales gestionadas en servidor y consentimiento explícito.                 |
| 25  | **Diagramas generales (F6)**               | Editor            | XL       | Familias secuencia/flujo/ER como adaptadores sobre el mismo motor de vistas, no como símbolos sueltos (regla del plan maestro).                                                            |

---

## 3. Backlog detallado por área

### 3.1 Lienzo y edición

| Mejora                                                        | Por qué                              | Dónde                                                                                      | Aceptación                   | Esf. |
| ------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------- | ---- |
| Selección por lazo con `Shift` aditivo y `Alt` sustractivo    | Hoy el lazo reemplaza siempre        | `usePointerTools.ts`, `Canvas.tsx`                                                         | E2E: lazo + Shift suma       | S    |
| Duplicar con `Alt`+arrastre                                   | Convención universal                 | `usePointerTools.ts`                                                                       | E2E                          | S    |
| Alinear a guías inteligentes también al redimensionar         | Solo al mover hoy                    | `computeAlignGuides`                                                                       | Unitaria                     | S    |
| Bloquear formas (`lock`)                                      | Evitar mover fronteras por accidente | esquema `Shape.locked`, inspector, reducer                                                 | Unitaria + E2E               | S    |
| Agrupar/desagrupar selecciones libres                         | Sin ello todo es frontera/grupo fijo | motor + reducer                                                                            | Unitarias de layout          | M    |
| Tamaño de servicio variable (1 ó 2 filas)                     | Chips + nota no caben en 92 px       | `constants.ts`, `relayoutGroup`, `ItemShape`                                               | Unitaria de layout; capturas | M    |
| Etiquetas de conector arrastrables                            | Se pisan con bordes                  | `ConnectorLayer`, modelo `label.offset`                                                    | E2E                          | M    |
| Conector con múltiples segmentos editables                    | Rutas manuales                       | `waypoints`, herramienta de puntos                                                         | E2E                          | L    |
| Atajos de teclado configurables                               | Poder profesional                    | `shortcuts.ts` con capa de usuario en preferencias, hoja de atajos editable                | Unitarias de duplicados      | M    |
| Navegación por teclado entre formas (`Tab`/flechas con `Alt`) | Accesibilidad                        | `useKeyboard.ts`                                                                           | E2E con lector               | M    |
| Historial visible (lista de pasos)                            | Hoy solo ⌘Z                          | panel en historial: "cambios de esta sesión" desde `past` con etiquetas por tipo de acción | E2E                          | M    |

### 3.2 Datos, modelo y semántica

| Mejora                                                                          | Por qué                                           | Dónde                                                                             | Esf. |
| ------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- | ---- |
| Campos personalizados por workspace (`meta.custom`)                             | Cada equipo tiene sus claves (coste, SLA, región) | esquema, inspector (sección "Tu equipo"), chips, DSL, análisis                    | M    |
| Enlaces clicables (repositorio, runbook, dashboard)                             | El chip de repo debería abrir el repo             | `meta.links[]`, chip con icono de enlace, en exportación SVG como `<a>`           | S    |
| Región/zona y escalado en servicios                                             | Preguntas típicas de revisión                     | esquema + chips                                                                   | S    |
| Coste estimado por servicio y total por vista                                   | Revisión financiera                               | `meta.costMonthly`, suma en la barra de estado y en análisis                      | M    |
| Estados de despliegue (planned/active/deprecated ya existen) → líneas de tiempo | Ver evolución                                     | vista "roadmap" derivada del lifecycle                                            | M    |
| Reglas con UI de autoría                                                        | Hoy solo YAML                                     | panel "Estándares": lista, activar/desactivar, severidad, crear desde un hallazgo | M    |
| Informe de análisis exportable                                                  | Compartir con arquitectura                        | Markdown/PDF con hallazgos y diagrama                                             | S    |

### 3.3 Colaboración y servidor

| Mejora                                                     | Dónde                                                            | Esf. |
| ---------------------------------------------------------- | ---------------------------------------------------------------- | ---- |
| Bus LISTEN/NOTIFY (H1 #6)                                  | `src/server/collab/*`                                            | M    |
| Roles por diagrama (H1 #7)                                 | `src/server/diagrams/*`, `ShareDialog`                           | L    |
| Enlaces compartidos con caducidad y contraseña             | `src/lib/share/links.ts`, tabla `share_links`                    | M    |
| Revocación de sesión desde Authentik (back-channel logout) | `src/server/auth/*`                                              | M    |
| Registro de actividad (quién cambió qué)                   | tabla `activity`, panel "Actividad" con la anatomía de historial | M    |
| Comentarios anclados (H2 #9)                               | nuevo módulo                                                     | L    |
| Notificaciones (menciones, cambios en diagramas seguidos)  | SSE + bandeja en la cabecera                                     | M    |

### 3.4 Importación y exportación

| Mejora                                                | Esf. | Nota                                          |
| ----------------------------------------------------- | ---- | --------------------------------------------- |
| CloudFormation / CDK synth                            | M    | Reutiliza el mapeo de recursos de Terraform   |
| Docker Compose                                        | S    | Servicios → grupos; `depends_on` → conectores |
| Pulumi (estado JSON)                                  | M    |                                               |
| Structurizr DSL (C4)                                  | L    | Encaja con vistas/niveles (drill)             |
| Mermaid de entrada                                    | M    | Solo hay salida hoy                           |
| draw.io de salida                                     | M    | Muy pedido en empresas                        |
| PPTX                                                  | L    | Una diapositiva por vista                     |
| PDF multipágina y con marcadores                      | S    | Base ya en `src/lib/editor/pdf.ts`            |
| Exportar sin metadatos (limpio) o con leyenda         | S    | Opción en el menú Exportar                    |
| Tema de exportación independiente (papel/oscuro/mono) | S    | `canvasTheme` ya está parametrizado           |

### 3.5 Biblioteca y portada

| Mejora                                                                                              | Esf. |
| --------------------------------------------------------------------------------------------------- | ---- |
| Ordenar (reciente, nombre, tamaño) y vista lista/rejilla                                            | S    |
| Favoritos y archivo                                                                                 | S    |
| Carpetas anidadas con arrastrar y soltar                                                            | M    |
| Arrastrar un archivo (YAML/JSON/tf/yaml de K8s) sobre la portada para importar                      | S    |
| "Continuar donde lo dejaste" con la última cámara por diagrama                                      | S    |
| Actividad reciente del workspace (servidor)                                                         | M    |
| Onboarding de primera vez: recorrido de 4 pasos sobre el editor real, omitible                      | M    |
| Ayuda contextual (`?`): hoja de atajos + enlaces a docs + "qué hay de nuevo" desde `CHECKPOINTS.md` | S    |

### 3.6 Sistema visual

| Mejora                                                        | Por qué                                                                                   | Esf. |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---- |
| Consolidación CSS (H1 #1)                                     | Deuda estructural                                                                         | L    |
| Componentes de sistema (H1 #2)                                | Homologación garantizada                                                                  | M    |
| Densidad (cómoda/compacta) y tamaño de texto                  | Portátiles de 13" y accesibilidad                                                         | M    |
| Transiciones de salida en diálogos y menús                    | Hoy desaparecen de golpe (React desmonta); usar `@starting-style` + retraso de desmontaje | S    |
| Hoja inferior en móvil para inspector y explorador            | Ya hay media queries parciales                                                            | M    |
| Iconografía única (Lucide-like propia) revisada trazo a trazo | Dos grosores conviven hoy                                                                 | S    |
| Ilustraciones de estados vacíos (SVG propios, sin emojis)     | Portada y paneles                                                                         | S    |
| Modo presentación (H2 #10)                                    | Reuniones                                                                                 | M    |
| Leyenda de chips/tonos en exportaciones                       | Lectores externos                                                                         | S    |
| Etiquetas de grupo con banda tintada y contador de servicios  | Jerarquía a golpe de vista                                                                | S    |

### 3.7 Accesibilidad

| Mejora                                                                                                        | Esf. |
| ------------------------------------------------------------------------------------------------------------- | ---- |
| Descripción textual del diagrama (`aria-describedby` con el Markdown generado)                                | S    |
| Navegación por teclado en el lienzo y anuncio de selección (`aria-live`)                                      | M    |
| Roles y nombres en todos los paneles; foco atrapado en diálogos y devuelto al cerrar (auditar con axe en E2E) | S    |
| Contraste de chips en tonos claros verificado por test (extender `tokens.test.ts` a `toneColors`)             | S    |
| Objetivos táctiles ≥ 44 px en móvil                                                                           | S    |

### 3.8 Rendimiento

| Mejora                                                                         | Esf. |
| ------------------------------------------------------------------------------ | ---- |
| Virtualizar el explorador y el selector (572 filas)                            | S    |
| Memorizar `DiagramScene` por forma (hoy re-renderiza todo al mover)            | M    |
| Culling también para conectores                                                | S    |
| Presupuesto de bundle en CI (`next build` + `size-limit`): shell < 250 KB gzip | S    |
| Lighthouse en CI para la portada (≥ 95 rendimiento/accesibilidad)              | S    |
| Miniaturas de la biblioteca generadas en un Web Worker                         | S    |

### 3.9 Calidad y operación

| Mejora                                                                                              | Esf. |
| --------------------------------------------------------------------------------------------------- | ---- |
| Regresión visual (H1 #4)                                                                            | M    |
| Auditoría funcional en CI (H1 #3)                                                                   | S    |
| Cobertura mínima por módulo (motor 90 %, dsl 90 %, store 85 %) con `--coverage` y umbral            | S    |
| Pruebas de carga del modo servidor (k6: 200 sesiones, 50 guardados/s)                               | M    |
| Copias de seguridad y restauración de PostgreSQL documentadas y probadas                            | S    |
| Versionado semántico + `CHANGELOG.md` generado desde checkpoints                                    | S    |
| Commits por tema del trabajo pendiente (Docker/CI · servidor · diseño · deshacer · iconos · Aurora) | S    |

---

## 4. Victorias rápidas (esta semana, ≤ 1 día cada una)

1. ~~Estabilizar E2E y añadir la auditoría funcional a CI.~~ **Hecho** (2026-09-09).
2. ~~`error.tsx` / `not-found.tsx` con la anatomía Aurora.~~ **Hecho.**
3. ~~⌘F buscar en el lienzo.~~ **Hecho.**
4. ~~Enlaces clicables en el chip de repositorio (exportación incluida).~~ **Hecho** (2026-09-10): el chip es un `<a>` en el lienzo y en el SVG exportado cuando el valor nombra un host (URL, `host/org/repo`, remoto SSH); `org/repo` sigue siendo etiqueta. El PDF es ráster y no lleva enlaces.
5. ~~Exportar con/sin metadatos y tema de exportación.~~ **Hecho**: menú Exportar con «Tema de exportación» (como el editor · claro · oscuro) e «Incluir metadatos»; preferencias persistidas.
6. ~~Ordenar y favoritos en la biblioteca.~~ **Hecho**: orden (reciente · nombre · más nuevos), estrella por tarjeta, filtro «Favoritos»; por navegador (`aion-studio-library`).
7. ~~Arrastrar un archivo a la portada para importar.~~ **Hecho**: JSON de proyecto o registro, volcado de workspace, YAML DSL, Mermaid, Terraform, Kubernetes, OpenAPI y Markdown, reconocidos por contenido.
8. ~~Transiciones de salida en diálogos.~~ **Hecho** con `usePresence` (desmontaje al `animationend`, tope de 260 ms) y keyframes `*-out`; se usaron keyframes y no `@starting-style` para ser coherentes con las entradas existentes. La paleta sigue sin animar.
9. ~~Descripción accesible del diagrama.~~ **Hecho**: `describeDiagram` localizado, `aria-describedby` en el lienzo y `<title>`/`<desc>` en el SVG exportado.
10. ~~Virtualizar explorador y selector.~~ **Cerrado por medición** (2026-09-10): el explorador y el selector muestran una nube a la vez (máximo 128 filas, Azure) y la búsqueda se limita a 120; `content-visibility: auto` se probó y se retiró porque cambiaba el alto de las secciones fuera de pantalla (884 → 240 px) y haría saltar el scroll. No hay nada que virtualizar.

## 4b. Herramientas de verificación de estilos (añadidas el 2026-09-09)

Tres scripts hacen seguro tocar el CSS, y son el requisito para cualquier cambio estructural de estilo:

| Script                                                                                                | Qué hace                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run styles:snapshot -- <out.json> [url]`                                                         | Recorre 70 estados por tema (paneles, menús, diálogos, hovers, anchos 1100/820, tonos, vista compartida) y guarda ~95 propiedades computadas de cada elemento (33.800 elementos). |
| `npm run styles:compare -- <antes.json> <despues.json>`                                               | Lista cada elemento cuyo estilo cambió, propiedad a propiedad. Cero diferencias = cambio exacto.                                                                                  |
| `npm run styles:match-map -- <out.json> [url]`                                                        | Para cada selector, qué elementos reales llega a vestir en algún estado; alimenta al consolidador para saber si dos reglas compiten de verdad.                                    |
| `npm run styles:consolidate -- <in.css> <out.css> --map <map.json> --src src --prune-dead [--report]` | Fusiona selectores repetidos en cascada exacta (deja "cascade-pinned" lo que no puede moverse), poda reglas muertas, conserva la prosa.                                           |

Flujo: `snapshot` → cambiar CSS → `build` → `snapshot` → `compare` (debe dar 0) → `test:visual`.

## 5. Métricas de éxito

| Métrica                                      | Hoy                                    | Objetivo H1                                                                                   | Objetivo H2                                          |
| -------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Líneas de `globals.css`                      | 8.448 (era 8.935)                      | 0 bloques duplicados salvo "cascade-pinned"; 0 reglas muertas; diff de estilos computados = 0 | < 7.000 fusionando reglas de declaraciones idénticas |
| Componentes > 400 líneas                     | 2 (era 4: `TopBar` 542, `Library` 532) | 0                                                                                             | 0                                                    |
| E2E intermitentes por 10 ejecuciones         | ~1                                     | 0                                                                                             | 0                                                    |
| Controles auditados                          | 68                                     | 90                                                                                            | 120                                                  |
| Estados con regresión visual                 | 0                                      | 24                                                                                            | 40                                                   |
| Iconos oficiales                             | 313/572                                | 313                                                                                           | ~520                                                 |
| Tiempo hasta primer diagrama (nuevo usuario) | sin medir                              | < 60 s                                                                                        | < 45 s                                               |
| Lighthouse portada (rendimiento/a11y)        | sin medir                              | ≥ 90/95                                                                                       | ≥ 95/100                                             |

## 6. Riesgos y dependencias

- **Consolidar CSS sin regresión visual** solo es seguro con la regresión visual (#4) primero: el orden H1 es #4 → #1 → #2.
- **Roles y comentarios** dependen del bus multi-réplica (#6) para que dos pestañas en réplicas distintas vean lo mismo.
- **CRDT** cambia el modelo de guardado; no empezar antes de tener roles y actividad, o el conflicto desaparece sin que nadie sepa quién hizo qué.
- **Iconos oficiales** requieren revisar las licencias de cada proveedor antes de vendorizar.
- **IA que edita** debe devolver acciones del reducer validadas con Zod, nunca un modelo completo: preserva el deshacer y evita que un error borre trabajo.
