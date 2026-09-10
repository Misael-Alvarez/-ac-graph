# Checkpoints

Registro de avance por fase del `PLAN_MAESTRO.md`. Cada entrada indica el commit base, lo entregado, las pruebas realmente ejecutadas y lo que sigue. Una fase solo se marca cerrada cuando sus criterios de aceptacion se verificaron; una captura o un commit no bastan.

Convencion de estado: **cerrado**, **parcial** (indica que falta) o **pendiente**.

> **Checkpoint vigente (2026-09-10):** H1 cerrado del todo — #2 fase 2 (componentes de sistema `Row/Tile/Field/Chip/GroupHeader/SearchField/Kbd`, seis superficies migradas, `TopBar` y `Library` partidos) entregado hoy con **0 diferencias de estilo computado**, pendiente de commit y push; el resto en `origin/main` (`e2fcc1d`). Contenedor local en http://127.0.0.1:3080 con `b195b01` (reconstruir). Para retomar: `docs/CONTEXTO.md`. Siguiente: H2.

## CP0: Confianza (cerrado, 2026-09-09)

**Base:** `e28174b` (`main`, 5 commits por delante de la referencia local `origin/main`). Trabajo sin commit al momento de escribir; el arbol contiene las tres entregas.

### Entregado

**Guardado recuperable** (`src/lib/store/saveCoordinator.ts`, `draftJournal.ts`, `draftSession.ts`, `src/components/app/useDiagramDocument.ts`):

- Un coordinador por documento, sin React ni DOM: cola serial de escrituras, debounce de 1,2 s, reintento explicito y el borrador mas nuevo nunca es sustituido por el acuse de una escritura antigua ni por un fallo anterior.
- Journal sincrono en `localStorage` con clave por sesion, propietario y diagrama. Se escribe antes de la navegacion, en `pagehide` y al ocultar la pestana; al reabrir el documento se recupera solo si su base coincide con la revision guardada. Un borrador con otra base queda archivado y descargable, nunca se aplica a ciegas.
- Sesion exclusiva mediante Web Locks: una pestana duplicada obtiene otra sesion y no puede recuperar ni confirmar el journal de la pestana viva. Sin Web Locks se desactiva la recuperacion automatica con aviso visible y se escribe en IndexedDB sin debounce.
- Estados diferenciados: sin guardar, guardando, guardado, error. Un fallo de cuota nunca se anuncia como guardado; el cambio queda reintentable y exportable.
- Repositorio transaccional (`localRepository.ts`): modelo, miniatura, metadatos, snapshot y poda del historial en una sola transaccion IndexedDB, con precondicion `expectedUpdatedAt` que rechaza escrituras obsoletas.
- Historial: la instantanea explicita captura el modelo del clic y espera confirmacion antes del mensaje; restaurar se serializa con el guardado pendiente y no crea autosnapshots que puedan expulsar la version elegida. Un lienzo en blanco no genera fila automatica en el historial.

**Operaciones destructivas** (`DiagramEditor.tsx`, `Modals.tsx`, `useCommands.ts`): importar JSON, elegir plantilla, importar Markdown/IaC y vaciar el lienzo usan `replaceModel`, asi que son un paso de undo. El JSON invalido o ilegible no toca el documento y se avisa. El dialogo generico recupera el foco al cerrar, atrapa Tab y cierra con Escape.

**Coherencia modelo/vista** (`reducer.ts`, `engine/views.ts`, `useCommands.ts`, `useKeyboard.ts`, `SelectionToolbar.tsx`, `InspectorPanel.tsx`, `ZoomControls.tsx`, `ShareDialog.tsx`, `ContextMenu.tsx`):

- Alinear, distribuir, organizar, mover con teclado, encuadrar, seleccionar todo y el inspector operan sobre la vista activa y el nivel de navegacion, escriben la geometria propia de la vista y no tocan la principal.
- SVG, PNG y Markdown exportan la vista proyectada; el JSON nativo sigue siendo el modelo completo, y su etiqueta lo dice.
- Compartir tiene alcance explicito: por defecto la vista actual, con proyeccion que elimina las demas vistas, las reglas y las referencias a elementos excluidos; el modelo completo es una eleccion consciente. El dialogo advierte que el enlace es una copia portable sin control de acceso ni revocacion.

**Base reproducible:** nueve archivos con formato pendiente corregidos; `.env.example` versionado sin secretos; Node 24 fijado en `.nvmrc` y `engines`; Playwright levanta y apaga su propio servidor de produccion en `127.0.0.1:3100` (o usa `E2E_BASE_URL`); CI ejecuta tipos, formato, unitarias, lint, build, E2E criticos y smoke de la imagen Docker.

### Pruebas ejecutadas

| Comprobacion                                                   | Resultado                                                       |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| `npm test`                                                     | 865 pruebas en 51 archivos, todas aprobadas (antes: 791 en 48)  |
| `npm run typecheck` (incluye `next typegen`)                   | Correcto                                                        |
| `npm run lint`                                                 | Correcto                                                        |
| `npm run format:check`                                         | Correcto en todo el repositorio                                 |
| `npm run build`                                                | Correcto, salida standalone                                     |
| `npx playwright test` contra el servidor gestionado            | 130 pruebas en 18 archivos, todas aprobadas                     |
| `npx playwright test` contra la imagen Docker (`E2E_BASE_URL`) | 27 pruebas de biblioteca, comparticion y persistencia aprobadas |

Regresiones nuevas con cobertura: navegacion antes del debounce, recarga tras fallo de IndexedDB, cuota agotada con reintento, sesion copiada con y sin Web Locks, JSON invalido y lectura fallida, instantanea con guardado pendiente, restauracion de la version mas antigua con 50 entradas, alcance de vistas en edicion/exportacion/comparticion.

### Limites conocidos

- No hay fusion multipestana ni sincronizacion remota: la precondicion de revision rechaza la escritura obsoleta y se ofrece descargar el borrador.
- La recuperacion automatica depende de Web Locks y de `sessionStorage`; navegadores sin Web Locks trabajan sin journal.
- Los datos siguen en IndexedDB del navegador, por origen exacto. Cambiar de puerto o dominio requiere exportar e importar el workspace.
- El enlace compartido sigue llevando el diagrama en la URL; la proyeccion por vista reduce lo que viaja, pero no es control de acceso.

## CP1: Fundaciones (parcial, 2026-09-09)

### Cerrado: Docker y ejecucion reproducible

- `Dockerfile` multi-stage con `node:24.20.0-bookworm-slim` fijado por digest, `output: 'standalone'`, `public` y `.next/static` copiados, usuario `node`, `HEALTHCHECK` propio y `node server.js`.
- `compose.yaml` con proyecto `acgraph-foundation`, puertos solo en loopback, `cap_drop: ALL`, `no-new-privileges`, limites de log y perfil opcional `postgres` (PostgreSQL 17 fijado por digest, sin contrasena por defecto). **La aplicacion no se conecta a PostgreSQL**: es un sandbox para el backend futuro.
- `.dockerignore` con lista blanca de entradas de build; excluye secretos, Git, skills y caches.
- `/api/health` con `Cache-Control: no-store`, sin credenciales ni detalles de infraestructura.
- Verificado en Docker Desktop (linux/arm64): build correcto, contenedor sano en `127.0.0.1:43127`, UID 1000, 14 assets estaticos servidos, `/api/embed` y `/api/ai/generate` responden 400/503 sin clave, y 27 pruebas E2E aprobadas contra el contenedor. Imagen final de 103 MB. El proyecto se detuvo con `down` sin tocar otros contenedores ni volumenes.
- `docs/DOCKER.md` documenta arranque, parada, salud, configuracion privada y limites.

### Abierto

- Recorridos y prototipos de biblioteca, editor, inspector, importacion y compartir, validados con usuarios.
- Spike de una semana sobre SVG/layout (flowchart ciclico, ER con puertos por atributo, secuencia pequena).
- ADR de modelo extensible, PostgreSQL/OIDC, revisiones y alcance de publicacion.
- Prototipo temprano de identidad estable y undo colaborativo.

## CP3-interno: Plataforma interna AION Cloud (cerrado, 2026-09-09)

Entrega orientada al uso interno: identidad de la empresa, trabajo compartido en vivo y un rediseno visual completo. Cierra la parte de servidor de F3 (PostgreSQL + OIDC) y adelanta la capa de presencia de F7, sin CRDT. Todo el trabajo esta sin commit en el arbol.

### Entregado

**Identidad y marca**

- Banorte eliminado por completo: codigo, tokens, logo en `public/`, pruebas y pie de exportacion. La unica firma es AION Cloud, activable por persona desde el menu de cuenta.
- Sistema visual "Nova" (`src/app/globals.css`, capa final): paleta violeta electrico con senal cian para lo que ocurre en vivo, superficies azul-negro profundas en oscuro, aurora detras del lienzo, cristal con hairline degradado en los paneles flotantes y un unico lenguaje de hover — tinte, borde en acento, halo y barra lateral — compartido por explorador de servicios, buscador, selector de iconos, menus, plantillas y biblioteca. Botones primarios con gradiente violeta→cian.
- El lienzo sigue al tema: papel en claro, azul-negro en oscuro, y la exportacion coincide con lo que se ve en pantalla. Los tokens de `tokens.ts` y el CSS siguen verificados por paridad y contraste AA.

**Iconos**

- Paquete vendorizado en `vendor/icons` (AWS architecture set 300, Google Cloud 216, IBM Cloud 265) con `LEEME.md` de procedencia y licencias. `scripts/refreshIcons.mjs` reconstruye el sprite con alias explicitos por servicio y escribe `src/data/iconSources.json`.
- Resultado: 313 de 572 servicios dibujan con artwork oficial (AWS 126/127, GCP 113/113, IBM 74/74). Azure y OCI no vienen en el paquete y conservan sus simbolos. Sprite escaneado: sin scripts ni handlers, 572 simbolos con viewBox, sin duplicados.

**Barra superior y exportacion**

- Nueva barra: logo/volver, titulo editable, estado de guardado con punto animado, pill "En vivo" y avatares de presencia, buscador, deshacer/rehacer, tema, menu **Exportar**, IA, Compartir y menu de **Cuenta** (idioma, firma AION, salir).
- Exportar: PNG, SVG, PDF, Markdown, Mermaid, YAML y JSON, con nombre de archivo tomado del titulo. Imagen y documento exportan la vista actual; JSON el modelo completo. PDF generado sin dependencias (`src/lib/editor/pdf.ts`, una pagina al tamano del diagrama, 216 dpi, FlateDecode) con pruebas de estructura y xref.
- Atajos con registro unico (`src/lib/editor/shortcuts.ts`): el teclado, las pistas de la paleta y la hoja `?` leen la misma tabla, con prueba de unicidad de acordes y de existencia de textos en ES/EN. Corregidas las descripciones falsas (Space era "encuadrar", flechas eran "autolayout"). Nuevos: `Mod+E` exportar, `Mod+H` historial, `Mod+I` insights, `Mod+M` minimapa, `Mod+Shift+L` autolayout, `Mod+Shift+D` tema, `Mod+'` cuadricula, `H` desplazar. Dialogos con Escape, foco atrapado y devuelto.

**Modo servidor (subagente + integracion)**

- `src/server/**`: PostgreSQL con migraciones idempotentes y lock de asesoramiento, OIDC Authorization Code + PKCE + state + nonce contra Authentik, sesiones opacas con hash en base de datos y cookie HttpOnly, CSRF por origen y cabecera, repositorio transaccional con `select … for update` y precondicion `If-Match` → `412` con la copia actual, presencia en memoria con TTL y colores deterministas, eventos SSE (`saved`, `meta`, `deleted`, `presence`).
- API completa bajo `/api/diagrams`, `/api/auth/*`, `/api/workspace/*`, `/api/config`. En modo local todo responde `server_mode_off` sin tocar la base.
- Cliente: `AppConfigProvider` decide el modo; `RepositoryProvider` elige IndexedDB o `HttpDiagramRepository`; `AuthProvider` lee `/api/auth/me`; `SignInGate` bloquea todo hasta que Authentik confirma; login fallido vuelve al gate con aviso, nunca un 500.
- Colaboracion en el editor (`useCollaboration`): roster y cursores remotos en el lienzo, guardados ajenos adoptados como un paso de undo (marcados `origin: 'remote'` para que el autosave no los reescriba), conflicto con banner y dos salidas (descargar mi copia / cargar la ultima), aviso de borrado remoto.
- `compose.server.yaml` (overlay) y `docs/AUTHENTIK.md` con el alta del provider, variables y limites.

### Pruebas ejecutadas

| Comprobacion                                                         | Resultado                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` con `TEST_DATABASE_URL` (PostgreSQL 17 real)              | 1035 pruebas en 69 archivos, todas aprobadas (115 de servidor con base real)                                                                                                                                                                                                                                                     |
| `npm run typecheck`, `lint`, `format:check`, `build`                 | Correctos                                                                                                                                                                                                                                                                                                                        |
| Playwright completo, modo local                                      | 130 de 130 aprobadas                                                                                                                                                                                                                                                                                                             |
| Dos navegadores firmados (Ana y Luis) contra la app en modo servidor | Gate anonimo, presencia mutua, cursor remoto con nombre, guardado de Ana adoptado en vivo por Luis con toast, un solo PUT por edicion, conflicto detectado (412) con banner y resolucion, edicion posterior sincronizada, exportacion PDF desde el menu (`Diagrama sin título.pdf`, `%PDF-1.4 … %%EOF`), cierre de sesion → gate |
| Docker overlay servidor (`compose.yaml` + `compose.server.yaml`)     | App y PostgreSQL sanos en loopback, `/api/config` = `server`, API sin sesion → 401, issuer inalcanzable → vuelta al gate con aviso                                                                                                                                                                                               |

Regresiones encontradas y corregidas durante la verificacion: eco del propio guardado tratado como novedad (bucle de re-guardado), autosave reescribiendo un modelo adoptado, `position: relative` de la capa visual que ponia el dock sobre el lienzo, `backdrop-filter` en el inspector que volvia el selector de iconos un popover fuera de pantalla, scroll al icono actual que se rendia antes de que la rejilla de iconos reales terminara de maquetar.

### Limites conocidos

- Presencia y eventos son por proceso: con varias replicas hace falta un bus (LISTEN/NOTIFY o Redis). La persistencia y la concurrencia optimista si son correctas entre replicas.
- Un solo espacio de trabajo: cualquier persona admitida por la aplicacion de Authentik lee y edita todo. `ownerId` es informativo; no hay roles ni permisos por diagrama.
- No hay fusion simultanea: dos personas moviendo el mismo diagrama a la vez resuelven por deteccion de conflicto, no por CRDT. La colaboracion "al mismo tiempo" es en vivo (ver, recibir, resolver), no de teclado compartido.
- Sin refresco ni revocacion de sesion desde Authentik; la sesion vive su TTL.
- Azure y OCI siguen con simbolos propios; la coleccion oficial de Azure hay que descargarla de Microsoft por sus terminos.
- No hay auditoria visual con personas; los criterios de accesibilidad se verificaron por tokens y recorridos automatizados, no con lector de pantalla.

## CP3-interno / Nova II: profundidad y movimiento (cerrado, 2026-09-09)

Segunda pasada de diseno sobre el editor y la biblioteca, revisada con capturas reales en ambos temas.

- **Lienzo oscuro corregido de raiz.** Los rellenos de las plantillas (crema AWS, hielo Azure…) se guardan como colores literales pensados para papel; sobre la hoja oscura salian como placas beige con tarjetas negras dentro. `themedFill` (`src/lib/editor/providers.ts`) reinterpreta el pastel como intencion — "tintar por proveedor" — y lo re-expresa como un susurro del color del proveedor sobre la tarjeta oscura. Un color oscuro o saturado elegido a mano se respeta; en claro nada cambia. Probado con unitarias de contraste AA.
- **Tarjetas rediseñadas.** Grupo con marca de proveedor y divisor que se desvanece desde ella; servicio con pozo de icono tintado y borde suavizado en oscuro; contenedor discreto; frontera con cuerpo lavado por el proveedor y filo de luz en la cabecera; etiquetas de conector con sombra.
- **Movimiento.** Entrada escalonada de las figuras al abrir un diagrama, seleccion con halo y trazo que recorre el conector seleccionado en la direccion de la llamada, vinieta sobre el lienzo, aurora a la deriva y rejilla en la biblioteca, metricas con entrada en cascada, borde degradado violeta→cian en plantillas y tarjetas al pasar el puntero, fundido al entrar al editor. Todo sobre transform/opacity/stroke-offset y apagado con `prefers-reduced-motion`.
- **Biblioteca.** Cabecera con eyebrow de AION Cloud, titulo en degradado, cuatro metricas del espacio (diagramas, 572 servicios, 5 proveedores, puntos de partida).

Verificacion: 1000 unitarias, 130 E2E, tipos/lint/formato/build verdes; imagen Docker reconstruida y comprobada con capturas.

## CP3-interno / Deshacer fiable y Nova III (cerrado, 2026-09-09)

Origen: "Deshacer no hace nada" en Firefox tras mover figuras. No se reprodujo en Chromium ni en Firefox (headless y con ventana), asi que se cerraron todos los caminos reales por los que un Cmd+Z queda en silencio:

- **El foco se quedaba en un campo de texto.** Tras renombrar el diagrama o editar una etiqueta, un arrastre en el lienzo no siempre mueve el foco al SVG; Cmd+Z iba al campo. El lienzo toma el teclado en cada pulsacion (`Canvas.takeKeyboard`).
- **Cmd+Z dentro de un campo.** Primero el historial propio del campo; si no cambia nada (los inputs controlados suelen no tenerlo), deshace el dibujo (`useKeyboard`). CodeMirror conserva el suyo.
- **Rafagas como un solo paso.** `coalesceKey` en `moveShapes`, `resizeShape`, `setShapeProps` y `setConnectorProps`: mover con flechas (pausa de 800 ms corta la rafaga) y escribir en el inspector (una rafaga por visita al campo) vuelven con un solo Cmd+Z. Reducer puro; la clave la decide quien despacha.
- **Sin nada que deshacer se dice.** Toast "No hay nada que deshacer / rehacer".

Pruebas: 4 unitarias de coalescencia en `reducer.test.ts`; 4 E2E nuevas en `editor.spec.ts` (foco en titulo + arrastre, 12 flechas = 1 paso, etiqueta escrita = 1 paso desde el campo, aviso con historial vacio); comprobado ademas en Firefox contra el contenedor.

Auditoria UI/UX con la skill `ui-ux-pro-max` y capturas de 22 estados en ambos temas. Cambios (capa CSS "Nova III"):

- **Encuadre al abrir** (`frameOnOpen`): un diagrama se abre completo en pantalla, nunca ampliado, libre del dock y del minimapa; antes abria al 100% desde la esquina y dejaba la mitad bajo el minimapa. No mueve la camara cuando quien dibuja coloca la primera figura a mano (`doc.lastCreated`).
- **Menu Exportar legible**: la barra superior es cristal y anula el desenfoque de lo que cuelga de ella, asi que el menu dejaba ver el diagrama; ahora es solido, mas ancho, con pistas a dos lineas y por encima del inspector (`.topbar` z-index 40).
- **Barra de seleccion** que salta bajo la seleccion cuando arriba la tapa la barra de vistas.
- **Hoja de atajos** en dos columnas equilibradas y 760 px.
- **Anillos de foco** que siguen las esquinas en todos los campos.
- **Toast** centrado abajo (antes tapaba la barra de vistas y saltaba media anchura al terminar de entrar).
- Inspector: la muestra de relleno ensena el color real de la tarjeta en oscuro; historial con "21 formas · 6 conexiones"; el perfil local se llama "Tu" en la interfaz.

Verificacion: 1007 unitarias, 134 E2E, tipos/lint/formato/build verdes, imagen Docker reconstruida y probada en Firefox.

## CP3-interno / Metadatos visibles, barra, inspector y portada (cerrado, 2026-09-09)

Peticion: lo que se rellena en "Que es" y en las flechas no se veia en el diagrama; la barra superior escondia lo mas usado en el buscador; el inspector y la pantalla principal se veian basicos.

- **Metadatos en el lienzo** (`src/lib/editor/meta.ts`, `ItemShape`, `ConnectorLayer`): entorno, criticidad, ciclo de vida, tecnologia y responsable como chips en la tarjeta (solo chips enteros, orden fijo, `active` no se pinta); `planned` = borde discontinuo, `retired` = atenuado. Conectores: el tipo decide el trazo (async guiones, event puntos, data grueso, dependency fino), el protocolo es la etiqueta si no hay texto, clase de datos y autenticacion como etiquetas (pii/pci/phi en rojo). Las palabras son las del DSL, en mayusculas pequenas. Misma salida en exportaciones SVG/PNG/PDF. La plantilla Microservicios trae inventario para que se vea sin escribir nada.
- **Barra superior**: paneles (servicios, codigo, historial, analisis) a la izquierda del buscador y lienzo (ajustar, organizar, cuadricula) a la derecha, con estado pulsado y atajo en el tooltip; menu "Mas" (plantillas, cambiar nube, importar, abrir/guardar JSON, restablecer zoom, minimapa, atajos, vaciar). Colapsa por anchura: etiquetas < 1280, lienzo < 1100, paneles < 900. `aria-label` fijo en Exportar/IA/Compartir.
- **Inspector**: cabecera con el icono en el tinte de su nube, el titulo editable como titulo, tipo y proveedor; listas fijas como chips (radiogroup) en el mismo color que el lienzo; presets de relleno por nube; "Que es" abierto; conector con origen → destino, invertir sentido, tipo/protocolo/datos como chips. 300 px.
- **Portada**: hero en dos columnas con titulo grande, lede, dos CTA y un escaparate que es la plantilla Microservicios dibujada de verdad (`src/lib/store/preview.ts`, texto real, sin sprite, < 24 KB); "Puntos de partida" siempre visibles como miniaturas reales; estado vacio en linea.

Pruebas: `meta.test.ts` (11), `preview.test.ts` (4), `metadata.spec.ts` actualizado a chips y comprueba las insignias en el lienzo. Verificacion: 1022 unitarias, 134 E2E, tipos/lint/formato/build verdes, imagen Docker reconstruida.

Limites: las demas plantillas no traen metadatos; la miniatura guardada por diagrama sigue siendo la de bloques (barata); las etiquetas y chips de conector se centran en el punto medio y pueden pisar un borde de grupo.

Correccion posterior (mismo dia): las cabeceras pegajosas de "Explorar servicios" y del selector de iconos se habian vuelto transparentes al unificarlas en `.group-header`, y al desplazar las filas pasaban por debajo del titulo pisando las letras. Ahora son barras esmeriladas (96 % superficie + desenfoque, filo y sombra breve); filas e iconos del explorador y celdas del selector con mas aire y un solo lenguaje de hover. Comprobado con capturas en ambos temas; 33 E2E de los paneles afectados en verde.

## CP3-interno / Nova IV: textura (cerrado, 2026-09-09)

Pasada de acabado sin cambios de estructura, en todo lo que tiene texto o estado:

- **Tipo**: titulos con `text-wrap: balance`, parrafos con `pretty`; una sola voz de versalitas (10.5 px, 0.08 em) para todas las etiquetas de seccion (paneles, inspector, menus, paleta, eyebrow); numeros tabulares en todo lo que cuenta; titulo del lienzo vacio con el degradado de la portada.
- **Teclas**: `kbd` como tecla real: cara clara, filo inferior mas pesado, ancho minimo, espaciado de letras.
- **Controles que ceden**: escala 0.96 al pulsar en botones, chips, filas y celdas; control segmentado con pista hundida y pulgar elevado.
- **Estados**: los numeros de la portada llegan rodando (`CountUp`, 900 ms ease-out, sin movimiento si el sistema lo pide); el "Guardado" dibuja su check cada vez que aterriza un guardado (span con `key={status}`).
- **Tarjetas**: flecha que entra por el borde al pasar sobre un diagrama.
- **Tema**: cambiar de claro a oscuro transiciona las superficies grandes en 260 ms en lugar de saltar.

Verificacion: 1022 unitarias, 134 E2E, formato/lint/tipos/build, imagen Docker reconstruida; capturas de estadisticas, check, teclas y segmentado.

## CP3-interno / Nova V: movimiento (cerrado, 2026-09-09)

- **Tooltips propios** (`useTooltips`, montado en `AppProviders`): al posarse el puntero sobre cualquier `title`, el texto pasa a `data-tooltip` (lo que apaga el nativo) y aparece un panel esmerilado junto al control con el atajo como tecla; 420 ms de espera, inmediato entre vecinos, tambien con foco de teclado; el nombre accesible se conserva (`aria-label` si el `title` era el unico nombre). Los tooltips del dock, que ya eran propios, hablan ahora el mismo idioma.
- **Camara que se desliza**: `setViewport` acepta `smooth`; ajustar, restablecer, +/- y el descenso a un grupo se deslizan 360 ms con zoom en escala logaritmica (`lerpViewport`); rueda y arrastre siguen saltando porque ya son el movimiento. El lienzo pinta `shown` (derivado, un salto se ve en el mismo commit) y la matematica del puntero usa el viewport confirmado.
- **El dibujo responde a la mano**: borde violeta al pasar sobre una tarjeta (solo CSS, nunca en exportaciones); chips y muestras hacen un pequeno pop al elegirse.
- **Portada**: el escaparate se inclina hacia el puntero (`--tilt-x/--tilt-y`) y vuelve al soltarlo; el hero aterriza por partes; con `animation-timeline` la cabecera gana sombra solo cuando algo se desplaza debajo y los puntos de partida suben al entrar en pantalla (sobre `translate`/`scale`, para que el hover siga componiendo).

Todo sobre transform/opacity y apagado con `prefers-reduced-motion`. Verificacion: 1024 unitarias, 134 E2E, formato/lint/tipos/build, imagen Docker reconstruida.

## CP3-interno / Nova VI: cristal, lineas, iconos propios (cerrado, 2026-09-09)

Peticion: mejorar las lineas; el campo Repositorio no se veia; Posicion no hacia nada; "el front no cambio"; cristal Apple en todo; que la gente suba sus propios iconos; ningun boton muerto.

- **Lineas**: codos de radio 14; punta de flecha en espacio de usuario (no crece con el grosor) con dorso curvo; segundo marcador en tinta para la seleccionada; halo del color de la hoja bajo cada linea (una carretera bordeada en el mapa); hover en violeta (solo editor); pill de etiqueta al 94 %.
- **Todo campo tiene su chip**: `@owner`, repositorio con glifo de rama y nombre corto (`repositoryName`), `#tags`, y `+N` cuando no cabe todo (el ajuste reserva sitio para el contador). Nombres con su grafia; estados en versalitas.
- **Posicion editable**: X/Y/W/H son campos numericos (`NumberField`), teclear o flechas mueve/redimensiona al instante, una rafaga = un paso de deshacer; W/H deshabilitados en servicios y marcos, que los mide su grupo.
- **Iconos propios** (`src/lib/icons/`): SVG saneado con DOM (fuera scripts, foreignObject, style, handlers, referencias externas; ids con prefijo del icono) o PNG/JPEG/WebP como data URL; hasta 256 KB. Viven en la biblioteca del navegador (`aion-studio-custom-icons`, 48 iconos / 3 MB) y se **embeben en el documento** (`model.customIcons`) al usarse, asi enlaces, exportaciones y otros navegadores los dibujan. Pestana "Propios" en el selector con subida (nombre, que es, origen, etiquetas), busqueda transversal, quitar de la biblioteca; `Defs` emite `<symbol id="i-custom-…">`; el YAML acepta claves `custom-*`; `replaceModel` conserva los iconos en una recompilacion. El selector se renderiza en un portal (el inspector ya puede ser cristal).
- **Cristal**: luz ambiental fija tras la portada (violeta/cian/naranja a la deriva) y tras el lienzo; barra, barra de estado, cabecera de portada, inspector, paneles laterales, tarjetas, escaparate y estadisticas esmerilados con filo de luz.
- **Sin botones muertos**: auditoria estatica (todo `<button>` con handler); el unico no-op — el nombre local en el menu de cuenta — ahora renombra el perfil (inicial del avatar y presencia). Sello de compilacion (`NEXT_PUBLIC_BUILD_STAMP`) en el menu de cuenta y el pie de la portada, para saber si la version nueva llego.

Pruebas: `customIcons.test.ts` (happy-dom, 10), reducer (2), DSL (1), meta (12), E2E nuevo de subida (saneado + persistencia) y actualizados de selector/posicion. Verificacion: 1038 unitarias, 135 E2E, formato/lint/tipos/build, imagen Docker reconstruida.

Limites: los iconos propios no aparecen aun en "Explorar servicios" (solo en el selector del inspector); la biblioteca es por navegador (en modo servidor no se sincroniza); las etiquetas de conector siguen centradas en el segmento mas largo.

## CP3-interno / Aurora: funcionalidad verificada y una sola anatomia (cerrado, 2026-09-09)

Peticion: protocolo no cambiaba nada; todo control debe cambiar algo en el diagrama; iconos propios en Explorar y en un espacio aparte; Subir/Bajar sin efecto; minimapa que no seguia el zoom; diez bucles de prueba; plan de rediseno radical homologado y su ejecucion.

- **Conectores**: el protocolo es etiqueta junto al texto cuando el texto no lo dice ya; toda clase de datos se etiqueta (`public` incluido); tipo → trazo; auth → etiqueta. Cada campo del conector cambia la flecha.
- **Subir/Bajar**: deshabilitados con motivo cuando el servicio esta solo en su grupo ("anade otro para reordenar"); con hermanos, mueven y vuelven (verificado).
- **Minimapa**: encuadra contenido ∪ camara, asi el rectangulo crece y encoge con el zoom en vez de recortarse en el borde (verificado: 1440 → 1728 al alejar).
- **Iconos propios en todas partes**: pestana "Propios" en Explorar servicios (subir, arrastrar, clic coloca, quitar), dialogo "Mis iconos…" desde Mas y desde la paleta, ademas del selector del inspector; `useIconLibrary` sincroniza los tres (evento `acgraph:icon-library` + `storage`). Soltar un icono propio en el lienzo lo embebe y lo coloca (`addCustomService`).
- **Bug real encontrado por la auditoria**: eliminar un servicio dentro de su grupo dejaba proxies de Immer revocados en `model.shapes` (el `relayoutGroup` escribia en drafts de un array reasignado); toda lectura posterior (analisis, minimapa, autosave) lanzaba. `deleteShape`/`deleteConnector` eliminan in situ con `splice`. Test de regresion en `reducer.test.ts`.
- **Auditoria funcional** `scripts/audit-controls.mjs`: 68 controles (barra, exportaciones reales, menus, zoom/minimapa, dock, inspector campo a campo, conector campo a campo, explorador con subida, menu contextual, barra de seleccion, vistas, cuenta, biblioteca) comprobando un cambio observable cada uno. **10 bucles, 68/68, sin errores de pagina.**
- **Plan de diseno** `docs/PLAN_DISENO.md` y capa "Aurora": una anatomia (cabecera 44 · busqueda 38 · pestanas · secciones · pie; fila 40 con tesela 28; celda con tesela 30; campo 34 radio 10) aplicada sobre el explorador, la paleta (ahora con cabecera, contador y cierre como todo panel), el selector de iconos, historial, analisis, menus y contextual; un solo hover (tinte + filo + barra lateral); titulos de panel en caja de oracion, secciones en versalitas.

Verificacion: 1040 unitarias, 135 E2E, auditoria 10×68, formato/lint/tipos/build, imagen Docker reconstruida.

Limites: la homologacion vive en CSS sobre las clases actuales (el siguiente paso son componentes `Panel/Row/Tile/Field`); la biblioteca de iconos es por navegador.

## CP3-interno / Aurora II: identidad visual (cerrado, 2026-09-09)

Peticion: "mejora el front drasticamente, presentable y profesional". Cambios estructurales, no de pulido:

- **Tipografia**: Geist + Geist Mono (`next/font/google`, autoalojadas) sustituyen a Plus Jakarta Sans + JetBrains Mono en toda la interfaz; tracking ajustado en titulos.
- **Paleta**: superficies pizarra-azul con jerarquia clara (`#0b1020 / #121a2e / #1a2440`, bordes `#1f2a44 / #2e3b5c`, texto `#eef2ff / #aeb8d0 / #7b88a8`; claro `#f4f6fb / #ffffff / #e9edf6`), lienzo `#0e1526`, tarjetas `#16203a`, grupos `#111a30`; paridad tokens.ts ↔ CSS y contraste AA verificados por `tokens.test.ts`.
- ~~Barra de herramientas flotante abajo al centro~~ — probada y **revertida a peticion del usuario**: la barra vuelve a la izquierda, vertical, como estaba. Queda la correccion de apilamiento de la pildora.
- **Material en el lienzo**: brillo superior y sombra al pie en cada tarjeta (`card-gloss`, `card-shade`), sombra mas suave y amplia; tambien en las exportaciones.
- **Encuadre al abrir** con suelo de zoom 0.52: nunca tan lejos que los grupos se plieguen en resumenes (fallo destapado por E2E en 1280×720).
- Correccion: la pildora de la barra se pintaba sobre el icono activo (stacking) — resuelto.

Verificacion: 1040 unitarias, 135 E2E, auditoria 3×68, formato/lint/tipos/build, Docker. Capturas `160-home-*`, `161-editor-*`.

## CP3-interno / Aurora III: revision de movimiento y tonos (cerrado, 2026-09-09)

Skills instaladas y aplicadas: `emilkowalski/skills@emil-design-eng`, `@apple-design`, `@review-animations`, `@improve-animations` (259K/130K/148K/120K instalaciones), junto con `ui-ux-pro-max` y `web-design-guidelines`.

Revision de movimiento contra la lista de Emil Kowalski / Apple:

| Antes                                                    | Despues                                                        | Por que                                              |
| -------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| La paleta ⌘K entraba con animacion                       | Sin entrada; solo el fondo funde 120 ms                        | Lo que abre el teclado cien veces al dia no se anima |
| Selector de iconos con `transform-origin` centro         | Origen en su disparador (100 % 12 %), 180 ms                   | Los popovers crecen desde donde se pidieron          |
| Tooltips vecinos con fundido                             | `is-instant` sin transicion tras el primero                    | Escanear una barra debe sentirse inmediato           |
| Menus/dialogos 240–340 ms                                | 160–240 ms, salidas mas rapidas que entradas                   | UI por debajo de 300 ms                              |
| Hover con movimiento en tactil                           | `@media (hover: none)` lo apaga                                | Un dedo no debe ver saltar la tarjeta                |
| Sin `prefers-reduced-transparency` ni `prefers-contrast` | Superficies solidas sin blur / bordes fuertes                  | Los materiales honran los ajustes del lector         |
| Linea de 1 px bajo cabeceras pegajosas                   | Fundido de 10 px donde el contenido toca el cristal            | "Scroll edge", no divisor duro                       |
| Tracking unico                                           | Positivo en 11 px, negativo en titulares, leading segun tamano | La tipografia cambia de forma con el tamano          |

**Tonos**: cinco acentos (Violeta AION, Indigo, Grafito, Oceano, Rosa) que re-clavean todo el acento — seleccion, chips, botones, dock, minimapa — con pares AA claro/oscuro; se eligen en el menu de cuenta, se guardan en preferencias, se aplican antes del primer pintado y tambien en la portada. La marca conserva su degradado.

Verificacion: 1041 unitarias, 135 E2E, auditoria 68/68, formato/lint/tipos/build, Docker.

## CP3-interno / Aurora IV: alineacion, cristal y la vibracion (cerrado, 2026-09-09)

- **Bug "vibra entre dos servicios"**: era el gestor de tooltips. Cada fila de servicio lleva `title`; al cruzar la frontera entre dos filas el panel se ocultaba y reaparecia bajo la siguiente (y repetia la etiqueta ya visible). Ahora: un tooltip que solo repite el texto visible no se muestra; al pasar a un vecino se reposiciona en sitio sin parpadeo; las listas lo piden a su derecha. Medido: 0 cambios de estado al recorrer una frontera pixel a pixel.
- **Un solo borde izquierdo** (`--panel-inset: 16px`) para titulo, campo de busqueda, pestanas, cabeceras de seccion, filas y pie en explorador, paleta, selector, historial, analisis e inspector.
- **Pestanas de nube** como pildoras de cristal (blur, filo de luz, punto con halo; la activa tenida con su color) en explorador, selector, portada y barra de vistas.
- **Barra de seleccion** de cristal: contador en pildora de acento, botones de 32 con tinte al pasar, separadores suaves.
- **Portada**: navegacion segmentada en la cabecera (Tus diagramas · Puntos de partida), tres puntos de capacidad bajo los CTA (⌘K, YAML, PDF), meta real por plantilla (servicios · conexiones), campo de busqueda alineado a la reticula.

Verificacion: 1041 unitarias, 135 E2E, auditoria 68/68, formato/lint/tipos/build, Docker.

## H1 del plan de mejoras / red de seguridad y victorias rapidas (cerrado, 2026-09-09)

Primer tramo de `docs/PLAN_MEJORAS.md`, en el orden que el propio plan exige: primero lo que protege, despues lo que cambia.

- **E2E estables**: el spec intermitente de biblioteca no era una carrera sino una expectativa vieja (esperaba que los puntos de partida desaparecieran al haber diagramas; ahora se quedan). Corregido; 33/33 en tres repeticiones con dos workers.
- **Auditoria funcional en CI**: `npm run audit:controls` como paso del job `verify` contra la app construida (69 controles).
- **Regresion visual**: proyecto Playwright `visual` (`e2e/visual.spec.ts`, `npm run test:visual` / `test:visual:update`), 12 estados × 2 temas, 1440×900, animaciones desactivadas, texto variable oculto, umbral 0,2 %. Lineas base en `e2e/__screenshots__` (2,5 MB). La suite funcional queda en el proyecto `functional`; `test:e2e` y `test:e2e:critical` lo usan.
- **Hallazgo de la regresion visual**: el panel de analisis ordenaba hallazgos iguales por id de forma, que es aleatorio por plantilla; dos sesiones del mismo diagrama mostraban ordenes distintos. Ahora ordena por severidad → tipo → nombres de lo que trata → id. Test unitario de determinismo.
- **`error.tsx` y `not-found.tsx`** con la anatomia Aurora (`PageState`): titulo, una frase que dice que el trabajo esta a salvo, reintentar y volver.
- **⌘F Buscar en el lienzo** (`FindBar`): filtra por titulo, subtitulo, nota, icono y metadatos; selecciona la primera coincidencia y desliza la camara; Enter/Shift+Enter recorren; Escape cierra; contador "n de m"; en la hoja de atajos y en la paleta. E2E y control en la auditoria.

Verificacion: 1042 unitarias, 136 E2E funcionales, 24 visuales (estables en dos pasadas), auditoria 69/69, formato/lint/tipos/build, Docker.

## H1 del plan de mejoras / consolidacion del CSS y componentes de sistema (cerrado, 2026-09-09)

**Herramientas primero.** `scripts/style-snapshot.mjs` recorre 70 estados por tema (`scripts/lib/tour.mjs`: paneles, menus, dialogos, hovers, teclado, toast, tooltip, drill, vistas, biblioteca con tarjetas, iconos propios, historial con version y comparacion, vista compartida, tono Oceano, anchos 1100/820) y guarda ~95 propiedades computadas de cada elemento; `compare` las enfrenta propiedad a propiedad. Determinista: dos capturas del mismo build dan 0 diferencias en 33.800 elementos. `scripts/css-match-map.mjs` registra que elementos reales viste cada selector (778 de 918 se ven en algun estado).

**Consolidacion** (`scripts/consolidate-css.mjs`, postcss): fusiona cada selector repetido en su ultima aparicion con las declaraciones en orden de cascada y sin duplicados internos (183 bloques fusionados, 273 declaraciones muertas), deja _cascade-pinned_ — con un comentario que dice frente a que regla — toda declaracion que al moverse cruzaria una regla de igual especificidad que compita por la misma familia de propiedad **y** se encuentre con ella en un elemento real (130 declaraciones en 47 bloques), poda 14 reglas muertas (el top bar antiguo, `.position-grid`, `.equivalents`…), quita las banderas de capa y conserva la prosa. Dos ajustes salieron de la propia verificacion: el detector debia razonar por _familias_ de propiedad (un `padding` que cruza un `padding-right`, un `border` que cruza un `border-left`) y por encuentro real entre selectores (con los selectores nunca vistos decidiendo estaticamente por clases co-ocurrentes en el codigo). Resultado: **0 diferencias de estilo computado** en 140 estados, 24/24 visuales, 136 E2E, 69/69 auditoria. `globals.css`: 8.935 → 8.448 lineas; la cifra baja poco porque la duplicacion era menor de lo estimado (183 bloques) y el resto es superficie real (965 reglas); lo que desaparece es la dependencia del orden entre capas.

**Componentes de sistema**: `src/components/ui/PanelHead.tsx` (titulo · contador · acciones · cerrar) sustituye cinco cabeceras escritas a mano (explorador, analisis, historial, codigo, paleta); `InspectorPanel.tsx` (956 lineas) pasa a 75 y delega en `inspector/{fields,ShapeHero,ConnectorInspector,ShapeInspector}.tsx`. Marcado identico salvo la cabecera de la paleta, que gana la clase compartida; visual 24/24 lo confirma.

Scripts: `styles:snapshot`, `styles:compare`, `styles:match-map`, `styles:consolidate`. Docker reconstruido.

## H1 del plan de mejoras / observabilidad minima (cerrado, 2026-09-10)

**Base:** `c03cf6e` (`main`). H1 #5 del `PLAN_MEJORAS.md`: logs JSON con `requestId`/`userId`/`diagramId`, metricas Prometheus en `/api/metrics`, trazas OpenTelemetry opcionales.

### Entregado

**Un envoltorio por peticion** (`src/server/observability/request.ts`, `observe(request, { route }, run)`): asigna el id (el `x-request-id` del proxy si tiene forma de id — 8 a 128 caracteres de `[A-Za-z0-9._-]` —, un UUID si no), ejecuta el handler dentro de un `AsyncLocalStorage` (`context.ts`) para que el repositorio, el pool y el stream registren con ese id sin pasarlo por parametros, mide, cuenta bajo la **plantilla de ruta** (`/api/diagrams/[id]`, nunca el path concreto), escribe una linea de acceso y devuelve `x-request-id` en la respuesta (reconstruyendo la respuesta si sus cabeceras son inmutables, como una redireccion). `withUser`/`withServerMode` (`handler.ts`) exigen `route` y anotan `userId` y `sessionKey` tras autenticar; las rutas que no pasan por ellos (IA, embed, config, health, metrics) se envuelven directamente. Los parametros dinamicos se leen del path contra la plantilla, asi que un 401 o un 404 que nunca llega al handler igualmente dice que diagrama se pedia. `error()` anota el `code` del fallo; un 500 lleva el `requestId` en el cuerpo para que la persona pueda citarlo.

**Logger propio** (`log.ts`, sin dependencia): un objeto JSON por linea en stdout — `time`, `level`, `msg`, despues las vinculaciones (id, metodo, ruta, usuario, diagrama) y los campos —; `LOG_LEVEL` (`debug|info|warn|error|silent`) y `LOG_FORMAT` (`json` en produccion, `pretty` en terminal). Claves que parecen credenciales (`cookie`, `authorization`, `password`, `secret`, `token`, `api_key`) se redactan a cualquier profundidad; los `Error` salen como nombre, mensaje y `code`, con pila solo en registros `error` o con logger `debug`; ciclos y profundidad acotados. Nunca se registra la query string (llevaria `code` y `state` del callback OIDC o el payload de un embed) ni cuerpo ni cabeceras. Si hay un span activo, cada registro lleva `traceId` y `spanId`. Los cuatro `console.error` del servidor pasan por el logger. Salud y scrape registran en `debug`.

**Registro Prometheus propio** (`metrics.ts`): contadores, gauges e histogramas con exposicion 0.0.4, singleton en `globals.ts` (compartido entre los bundles por ruta de Next), tope de 500 series por metrica con contador de rechazos, colectores en tiempo de scrape para proceso (CPU, RSS, heap, utilizacion del bucle de eventos, version), `acgraph_build_info` y clientes del pool. Metricas de aplicacion: `acgraph_http_requests_total{route,method,status}`, `acgraph_http_request_duration_seconds{route,method}`, `acgraph_http_requests_in_flight`, `acgraph_http_conflicts_total{route}` (412), `acgraph_diagram_saves_total{operation=save|restore,result=ok|conflict|error}` (en el repositorio), `acgraph_sessions_created_total`, `acgraph_sessions_ended_total`, `acgraph_logins_total{result}`, `acgraph_sse_connections`, `acgraph_sse_connections_total`, `acgraph_sse_events_published_total{type}`, `acgraph_db_transactions_total{result}`, `acgraph_db_transaction_duration_seconds`, `acgraph_unhandled_errors_total{source}`. Ninguna etiqueta es un id (hay prueba). `GET /api/metrics` abierto por defecto (puerto en loopback); con `METRICS_TOKEN` exige `Authorization: Bearer` con comparacion en tiempo constante.

**Trazas opcionales** (`tracing.ts`, `startup.ts`, `src/instrumentation.ts`): `register()` de Next arranca el logger, crea las metricas con sus series a cero, escribe `server started` (modo, Node, build, pid, nivel, formato, trazas, metricas protegidas) y, solo si `OTEL_EXPORTER_OTLP_ENDPOINT` esta definido, importa el SDK (`@opentelemetry/sdk-trace-node` + exportador OTLP HTTP/JSON, paquetes marcados `serverExternalPackages`) y registra el proveedor global: Next, ya instrumentado, emite un span por peticion, por handler y por `fetch` con `service.name` = `OTEL_SERVICE_NAME` y `service.version` = sello de build; los avisos del exportador salen por el logger; SIGTERM vacia el lote. `onRequestError` registra y cuenta los errores que Next atrapa fuera de los handlers, sin leer cabeceras. Sin colector no se carga nada del SDK.

**Configuracion**: `readObservabilityEnv` en `env.ts` (independiente del modo servidor); variables en `.env.example`, pasadas por `compose.yaml`; seccion "Logs, metrics and traces" en `docs/DOCKER.md`, referencias en `README.md` y `docs/AUTHENTIK.md`; corregidas las frases de `DOCKER.md` y `compose.yaml` que aun decian que PostgreSQL era un "sandbox futuro" y que no habia autenticacion.

### Pruebas ejecutadas

| Comprobacion                                                  | Resultado                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                    | 1094 pruebas en 74 archivos (antes 1041): logger (formato, niveles, hijos, redaccion, errores, ciclos, pretty), registro (exposicion exacta, escapes, tipos, tope de series, colectores), `observe` (id, plantilla vs path, en vuelo, 412, 500 con id, `code`, rutas silenciosas, aislamiento entre peticiones concurrentes), `/api/metrics` (formato, token), `readObservabilityEnv` |
| `npm test` con `TEST_DATABASE_URL` (PostgreSQL 17 desechable) | 1138 pruebas en 77 archivos; nueva prueba de extremo a extremo: guardado → 412 → contadores de guardados, conflictos, transacciones (1 commit, 1 rollback), sesiones creada/terminada; linea de acceso con `userId`, `diagramId`, `sessionKey`, `code`; scrape sin ids ni cookie                                                                                                      |
| `npm run typecheck`, `lint`, `format:check`, `build`          | Correctos; `/api/metrics` y `src/instrumentation.ts` en el build                                                                                                                                                                                                                                                                                                                      |
| Humo `npm start` (3100, modo local)                           | `server started` en JSON; `x-request-id` generado y respetado desde el proxy; lineas de acceso con `diagramId` y `code` en 404 sin handler; `/api/metrics` con 83 series compartidas entre rutas y sin contarse a si mismo                                                                                                                                                            |
| Humo con colector OTLP falso (`OTEL_EXPORTER_OTLP_ENDPOINT`)  | 12 spans exportados para 3 peticiones (`GET /api/config`, `executing api route`, `resolve page components`, `start response`) con `service.name` y `service.version`; el `traceId` de la linea de acceso coincide con el del span; parada con SIGTERM sin avisos                                                                                                                      |
| Imagen Docker reconstruida (`acgraph-foundation`, Node 24)    | Sana en loopback; `docker logs` en JSON (`server started`, lineas de acceso), `x-request-id`, `/api/metrics` con `acgraph_build_info`, paquetes `@opentelemetry/*` trazados al standalone e `instrumentation.js` compilado                                                                                                                                                            |
| Playwright funcional / visual (servidor externo 3100)         | 136 de 136 / 24 de 24                                                                                                                                                                                                                                                                                                                                                                 |

### Limites conocidos

- Las metricas y la presencia son por proceso: con replicas cada una expone las suyas (Prometheus las agrega por `instance`); no hay bus ni agregacion. H1 #6.
- Las rutas de IA responden con `NextResponse.json` propio, asi que su linea de acceso lleva `status` pero no `code`.
- No hay metricas de negocio del lado del cliente (tiempo hasta interactivo, errores del navegador) ni alertas; que un colector reciba los datos es decision del operador.
- Las trazas cubren los spans de Next; no hay spans propios por consulta SQL ni por render de miniatura (el histograma de transaccion cubre lo primero en agregado).

## H1 del plan de mejoras / presencia multi-replica (cerrado, 2026-09-10)

**Base:** `f12fdb2` (`main`). H1 #6 del `PLAN_MEJORAS.md`: bus `LISTEN/NOTIFY` de PostgreSQL para difundir `saved`/`meta`/`deleted`/presencia entre procesos, con la memoria como respaldo cuando no hay base.

### Entregado

**Bus** (`src/server/collab/bus.ts`): contrato `Bus` (`publish`/`subscribe`/`close`) con dos transportes. `MemoryBus` entrega dentro del proceso (modo local, y tests que levantan dos replicas en un solo proceso). `PgBus` hace `LISTEN acgraph_collab` en una conexion dedicada (`pg.Client` con `keepAlive`, `application_name` `ac-graph-bus`; un cliente del pool no puede reservarse de por vida) y `NOTIFY` por el pool con `pg_notify`. Si la conexion se cae, vuelve con retardo creciente (0,5 s → 30 s) y se anota `bus disconnected` / `bus connected`; mientras esta caida se pierden los mensajes ajenos, nunca los locales. Los mensajes van como JSON validado con Zod (`v: 1`, `origin`, `diagramId`, `kind`), se descartan los ajenos al formato y los mayores de 7.900 bytes (`pg_notify` rechaza 8.000), y un fallo al publicar se registra y cuenta sin lanzar.

**Coordinador** (`src/server/collab/collaboration.ts`): `Collaboration` con un `origin` por proceso aplica cada cosa primero en local (hub → streams; registro → roster) y despues la cuenta al bus; lo que llega del bus se aplica igual sin reenviarlo; el eco propio (`NOTIFY` devuelve el mensaje al emisor) se reconoce por `origin` y se ignora. La presencia viaja como **estado absoluto por sesion** (`touch` con usuario `{id, name}`, cursor y `editing` tras la fusion local; `leave`), de modo que cada replica mantiene el roster fusionado, un mensaje perdido lo corrige el siguiente heartbeat y una replica que muere se lleva a sus viewers al vencer el TTL de 15 s sin necesidad de despedida. Un heartbeat remoto refresca el TTL sin anunciar nada; un cursor, un `editing` o un `leave` remoto si anuncian el roster a los streams locales. `collaboration()` es el singleton del proceso (PgBus en modo servidor, memoria si no) y `startup.ts` lo arranca al iniciar el servidor, asi que la primera persona que entra ya oye a las demas. Las rutas (`PUT`/`PATCH`/`DELETE`, `restore`, `presence`) y el stream publican a traves de el; `events.ts` queda como fan-out local y `presence.ts` gana `peek()`.

**Metricas**: `acgraph_collab_bus_messages_total{direction=sent|received|echo,kind}`, `acgraph_collab_bus_dropped_total{reason=invalid|too_large|publish_failed}`, `acgraph_collab_bus_connected`, `acgraph_collab_bus_reconnects_total`.

**Documentacion**: `docs/AUTHENTIK.md` (la capa viva entre replicas, la conexion de `LISTEN` debe llegar directa a PostgreSQL o a un pooler en modo sesion — PgBouncer en modo transaccion la rompe), `docs/DOCKER.md` (limites: varias replicas sobre una base, sin sesiones pegajosas), `README.md`.

### Pruebas ejecutadas

| Comprobacion                                                                                 | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                                   | 1113 pruebas (antes 1094): `decode`, `MemoryBus`, `PgBus` con cliente falso (LISTEN, entrega, descarte de payloads invalidos y grandes, fallo al publicar, reintentos con backoff bajo temporizadores falsos, reconexion tras `error`/`end`, `close`, `start` idempotente); dos replicas virtuales sobre un `MemoryBus` (relevo unico de eventos, roster fusionado, heartbeat sin anuncio, cursor/`editing`/`leave` remotos, eco ignorado, `touch` de una replica desconocida, cierre) |
| `npm test` con `TEST_DATABASE_URL` (PostgreSQL 17 desechable)                                | 1160 pruebas en 80 archivos; `bus.pg.test.ts`: dos conexiones `LISTEN` reales (entrega a todos, emisor incluido; capa viva entre dos `Collaboration`; **vuelta tras `pg_terminate_backend`** de la conexion que escucha)                                                                                                                                                                                                                                                               |
| `npm run typecheck`, `lint`, `format:check`, `build`                                         | Correctos                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Dos procesos reales** (`npm start` en 3100 y 3101, misma base, sesiones sembradas por SQL) | Ambos `bus connected` al arrancar; Bob (stream en B) recibe la presencia con cursor de Ada (POST en A), su `saved` y su `meta`; Ada (stream en A) ve a Bob como remoto y lo ve salir al cerrar Bob su stream en B; metricas `sent`/`received`/`leave` coherentes en ambos; 0 avisos en los logs                                                                                                                                                                                        |
| Playwright funcional (servidor externo 3100)                                                 | 136 de 136                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Limites conocidos

- Best effort: un mensaje se pierde si la replica receptora tiene la conexion de escucha caida; la presencia se cura en ≤ 15 s y los guardados no dependen del bus (la base decide). No hay cola ni reenvio.
- `LISTEN` exige conexion directa a PostgreSQL o pooler en modo sesion.
- Un solo canal para todos los diagramas: cada replica recibe todos los mensajes y filtra en memoria; suficiente para decenas de replicas y cientos de mensajes por segundo, no disenado para miles.
- El roster remoto lleva solo `id` y `name` (el color se deriva del id); correo y avatar quedan en la replica que tiene la sesion.

## H1 del plan de mejoras / roles por diagrama (cerrado, 2026-09-10)

**Base:** `9db935a` (`main`). H1 #7 del `PLAN_MEJORAS.md`: tabla `diagram_members`, invitacion por correo entre usuarios ya vistos por OIDC, rutas y SSE que respetan el rol, menu Compartir con personas y selector de rol, lector en solo lectura con presencia.

### Entregado

**Modelo y servidor.** `RoleSchema` (`owner|editor|viewer`), `DiagramMeta.role` (el rol de quien lee; ausente en el almacen local) y `DiagramMemberSchema` en `src/lib/domain/project.ts`. Migracion 6 `diagram_members(diagram_id, user_id, role, added_by, created_at)` con **backfill**: cada diagrama existente recibe a su `owner_id` como propietario. `PgDiagramRepository` reescrito con autorizacion en cada operacion: `list` y `exportWorkspace` solo devuelven lo que la persona es miembro de; `get` distingue inexistente (null → 404) de ajeno (`DiagramForbiddenError` → 403 `no_access` con `required` y el nombre del propietario, nunca el diagrama); `save`/`updateMeta`/`restoreVersion` leen el rol **en la misma consulta que bloquea la fila** (`for update of d`), asi que quien pierde el acceso no termina una escritura en vuelo; `delete` es del propietario; `duplicate` lo puede hacer cualquiera que lea (la copia es suya); `create` e `importWorkspace` insertan diagrama y fila de propietario en una transaccion. Miembros: `listMembers` (cualquier miembro), `setMember` por correo (propietario; `lower(email)`, `UserNotFoundError` → 404 `user_not_found`, la fila del propietario es intocable → `MembershipError` → 400), `setMemberRole` por `userId`, `removeMember` (el propietario quita a cualquiera menos a si mismo; cualquier otro solo se va), `roleOf`. Rutas nuevas `GET/PUT /api/diagrams/[id]/members` y `PATCH/DELETE /api/diagrams/[id]/members/[userId]`; `presence` y `events` exigen ser miembro; `versions` delega en el repositorio. Cada cambio de acceso se publica como evento `access {userId, role|null, by}` por hub y bus.

**Cliente.** `NoAccessError` (403 `no_access`) y `MembersApi` en `HttpDiagramRepository`; `useMembersApi()` en `RepositoryProvider` (null en modo local). `useDiagramDocument` gana `noAccess`, `role`, `applyAccess(role, by)` y `accessRevokedBy`. El cliente SSE recibe `access`; `useCollaboration` lo reenvia y expone `accessVersion` para que la lista de personas se refresque en todas las pantallas.

**Solo lectura.** `EditorProvider` acepta `readOnly` y envuelve `dispatch` con `guardDispatch` (`src/lib/editor/readOnly.ts`): solo pasan `load` y `replaceModel` remoto; deshacer/rehacer quedan fuera para no bifurcar el lienzo de lo guardado. Ademas, de forma visible: insignia «Solo lectura» con candado en lugar del estado de guardado (barra superior y de estado), titulo `readOnly`, dock con solo el selector (y sin explorador), inspector envuelto en `<fieldset disabled>` con controles atenuados, sin asa de redimensionar ni menu contextual ni barra de seleccion, arrastres y redimensionados que no arrancan, YAML de solo lectura (`Compartment` de CodeMirror), comandos de edicion `enabled: false` (paleta y menus), atajos de herramienta ignorados, `Autosave` inerte. Sin acceso: pagina «No tienes acceso a este diagrama · Pide a {nombre} que lo comparta contigo». Acceso retirado en vivo: el lienzo se queda, en solo lectura, con aviso que nombra a quien lo retiro y boton para descargar la copia; una promocion o degradacion cambia el editor al instante con un aviso.

**Compartir y biblioteca.** Seccion «Personas» al inicio del dialogo Compartir (solo en modo servidor): lista con avatar del color de presencia, nombre, correo y rol; el propietario cambia roles con un selector y quita personas; cualquiera puede salir; formulario correo + rol + Añadir con mensajes para correo desconocido y fallo. Tarjetas de la biblioteca con chip «Puede ver / Puede editar» y boton «Salir» (con confirmacion) en lugar de «Eliminar» para quien no es propietario. `colorForUser` movido a `src/lib/collab/colors.ts` (compartido). 30 claves i18n nuevas en es/en.

**Auditoria repetible.** `scripts/audit-roles.mjs` (`npm run audit:roles -- <url>` con `AUDIT_DATABASE_URL`): siembra dos personas y dos sesiones, recorre con dos navegadores toda la historia (extraño, invitacion, lector, promocion en vivo, retirada en vivo, biblioteca y salida) con 26 comprobaciones y limpia lo que creo.

**Documentacion**: `docs/AUTHENTIK.md` § 6 «Who can open a diagram» (matriz de roles, rutas, comportamiento en vivo, editor del lector), limites actualizados; `README.md`, `docs/DOCKER.md`, `src/lib/appConfig.ts`.

### Pruebas ejecutadas

| Comprobacion                                                  | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                                                    | 1120 pruebas (antes 1113): guarda de solo lectura, `NoAccessError` vs 403 CSRF, cliente de miembros (GET/PUT/PATCH/DELETE con marcador), evento `access` en el cliente SSE, mapeo HTTP de los errores nuevos                                                                                                                                                                                                                                                       |
| `npm test` con `TEST_DATABASE_URL` (PostgreSQL 17 desechable) | 1177 en 81 archivos: matriz de roles en el repositorio (privado hasta compartir, lector lee/copia/no escribe, editor no borra ni gestiona, propietario intocable, salir, cascada al borrar), API: un extraño recibe 403 `no_access` en las diez rutas del diagrama, invitacion con evento `access`, lector 403 al guardar y 204 en presencia, promocion, salida y retirada, validaciones (correo, rol `owner`, cuerpo extra, desconocido → 404, propietario → 400) |
| `npm run typecheck`, `lint`, `format:check`, `build`          | Correctos                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Playwright funcional / visual (modo local, servidor externo)  | 136 de 136 / 24 de 24 (la seccion de personas no se renderiza en modo local; lineas base intactas)                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run audit:controls`                                      | 69 de 69                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Imagen Docker reconstruida (`acgraph-foundation`)             | Sana; rutas `members` compiladas; `acgraph_build_info` del build nuevo                                                                                                                                                                                                                                                                                                                                                                                             |
| **`npm run audit:roles`** (modo servidor, dos navegadores)    | **26 de 26** con el build definitivo; 0 avisos en el log del servidor; capturas revisadas: dialogo con personas, editor del lector (insignia, un solo tool, inspector bloqueado), aviso de acceso retirado, tarjeta con chip de rol                                                                                                                                                                                                                                |

### Limites conocidos

- Un solo workspace; sin equipos ni roles de workspace; la propiedad no se transfiere.
- Invitar exige que la persona haya iniciado sesion una vez; no se envian correos.
- Quien pierde el acceso conserva abierto su stream SSE hasta recargar (el servidor no lo cierra); ya no puede escribir ni ve nada que no pudiera ver.
- La seccion de personas del dialogo no entra en `audit-controls` (modo local); su auditoria es `audit:roles`.

## Victorias rapidas 4-10 del plan de mejoras (cerrado, 2026-09-10)

**Base:** `c3afefa` (`main`). Siete mejoras pequenas del `PLAN_MEJORAS.md` § 4, cada una con su cambio observable.

### Entregado

- **Descripcion accesible (#9)** — `src/lib/editor/describe.ts`: `describeDiagram(model, t)` dice en el idioma del lector cuantos grupos, servicios y conexiones hay, que servicios tiene cada grupo y quien llama a quien (listas acotadas: 12 grupos, 8 servicios por grupo, 20 conexiones, «y N mas»). El lienzo (`role="application"`) lleva `aria-describedby` a un `<p class="sr-only">` con ese texto, calculado sobre la vista en pantalla; el SVG exportado lleva `<title>` (el nombre del documento) y `<desc>` (la descripcion) y `role="img"`. Utilidad `.sr-only` nueva.
- **Opciones de exportacion (#5)** — `ui.exportTheme` (`editor|light|dark`) y `ui.exportMeta` en `uiState`, persistidos en preferencias; el menu Exportar gana el grupo «Tema de exportacion» (tres filas, la activa marcada) e «Incluir metadatos» (toggle; el menu no se cierra al elegir). `exportOptions()` dibuja sobre el tema elegido y, sin metadatos, sobre `stripMetadata(model)` (sin chips, etiquetas de conector ni trazos de ciclo de vida); PNG, SVG y PDF lo respetan.
- **Chip de repositorio enlazado (#4)** — `repositoryUrl()` en `meta.ts`: URL completa tal cual, remoto SSH (`git@host:org/repo.git`) y `host/org/repo` → pagina https del repositorio; `org/repo` no enlaza (adivinar el forge llevaria al sitio equivocado). El chip se envuelve en `<a target=_blank rel=noreferrer noopener>` con `pointer-events: auto` y parada de propagacion, asi que un clic abre el repositorio en vez de seleccionar la tarjeta; el mismo arbol React lo lleva al SVG exportado y al embed. Subrayado al pasar el puntero y foco visible. El PDF es raster: sin enlaces.
- **Orden y favoritos (#6)** — `src/lib/library/prefs.ts` (`aion-studio-library` en `localStorage`, por navegador): `sort` (`recent|name|created`) y `favourites`. Selector «Ordenar por» en la barra de la biblioteca (solo con mas de un diagrama), estrella por tarjeta (`aria-pressed`; la tarjeta marcada muestra su estrella sin hover), chip de filtro «Favoritos» con contador; los favoritos van primero dentro del orden elegido; el nombre se ordena de forma natural e insensible a mayusculas. Quitar el ultimo favorito con el filtro activo devuelve a «Todos» (hallado por la auditoria).
- **Soltar un archivo en la portada (#7)** — `src/lib/library/dropImport.ts`: `readDroppedFile(name, text, locale)` reconoce por contenido, en este orden, JSON (modelo, registro guardado o volcado de workspace), Terraform/Kubernetes/OpenAPI (`detectFormat`), Mermaid (`flowchart|graph`), YAML DSL (`parseDsl`) y Markdown; lo que no reconoce se rechaza con motivo (`empty|unreadable|unrecognised`). La portada muestra una capa «Suelta para importar…» mientras se arrastra (contador de entradas para no parpadear al cruzar hijos), crea el diagrama con el nombre del archivo y lo abre; un volcado de workspace se importa entero y avisa con el recuento; los fallos se anuncian con `role="status"`.
- **Salidas animadas (#8)** — `src/lib/editor/usePresence.ts`: `usePresence(value)` devuelve el ultimo valor abierto mientras `closing`, desmonta al `animationend` de una animacion `*-out` (tope de 260 ms si nada anima) y da una `key` por apertura para que reabrir durante la salida monte contenidos nuevos (sin ella, el dialogo de compartir reabria con el alcance «modelo completo» de la vez anterior: lo detecto la E2E). Aplicado a `Modals`/`Dialog`, `ShareDialog`, `AiDialog`, `ConfirmDialog`, `NewDiagramDialog`, `TopBarMenu`, `ContextMenu`, popover del selector de iconos y toast; los menus quedan `inert` mientras salen. Keyframes `backdrop-out`/`dialog-out` (140 ms), `menu-out` (120 ms), `toast-out` (180 ms), junto a sus entradas en el CSS; la paleta sigue sin entrada ni salida; `prefers-reduced-motion` los acorta a 0,01 ms. Se usaron keyframes y no `@starting-style` para ser coherentes con las entradas existentes y con el `freeze()` de la regresion visual.
- **Virtualizar (#10) — cerrado por medicion.** El explorador y el selector muestran una nube a la vez (127 AWS, 128 Azure, 113 GCP, 90 OCI, 74 IBM) y la busqueda se limita a 120 resultados: no hay 572 filas en pantalla. Se probo `content-visibility: auto` con `contain-intrinsic-size` y se retiro: `styles:compare` mostro secciones fuera de pantalla midiendo 240 px en vez de 884, con el consiguiente salto de scroll, sin beneficio medible. Nada que virtualizar.

### Pruebas ejecutadas

| Comprobacion                                                                                                  | Resultado                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                                                    | 1139 pruebas (antes 1120): `describeDiagram` (vacio, recuento, listas acotadas, es/en), `repositoryUrl` y `stripMetadata`, `parseLibraryPrefs`/`sortDiagrams`, `readDroppedFile` (JSON/registro/workspace, DSL, Mermaid, K8s, Terraform, Markdown, rechazos), `usePresence` (con `react-dom` en happy-dom: mostrar, cerrar, tope, reabrir, `key`)                                                                 |
| `npm run typecheck`, `lint`, `format:check`, `build`                                                          | Correctos (el hook se escribio con estado derivado en render: el linter de React rechaza `setState` en efectos)                                                                                                                                                                                                                                                                                                   |
| `styles:snapshot` / `styles:compare` (build anterior en un worktree vs. nuevo, 140 estados, 33.998 elementos) | Solo diferencias explicadas por los controles nuevos: `p.sr-only` nuevo, menu Exportar mas alto (811 px), acciones de tarjeta 62 → 94 px por la estrella. `content-visibility` se retiro por lo que esta comparacion mostro                                                                                                                                                                                       |
| Playwright funcional / visual (servidor externo 3100)                                                         | 136 de 136 / 24 de 24 (una regresion encontrada y corregida: reabrir Compartir durante la salida conservaba el alcance)                                                                                                                                                                                                                                                                                           |
| `npm run audit:controls`                                                                                      | **83 de 83** (antes 69): tema de exportacion marcado y fondo `#ffffff` en el SVG, metadatos desmarcados y sin `data-badge` en el SVG, `<desc>` presente, ordenar por nombre, favorito sube la tarjeta y muestra el filtro, filtro deja solo marcados, quitar favorito retira el filtro, soltar un YAML abre el diagrama con su nombre y 3 formas y aparece en la lista, repositorio con host enlaza y sin host no |

### Limites conocidos

- Favoritos y orden son por navegador; en modo servidor no se sincronizan entre dispositivos.
- El PDF no lleva enlaces (es raster).
- `org/repo` sin host no enlaza; no hay ajuste de forge por defecto.
- Soltar varios archivos importa solo el primero.
- El AiDialog conserva su estado entre aperturas (deliberado) y por eso no usa la `key` de apertura.

## H1 #2 fase 2 del plan de mejoras / componentes de sistema (cerrado, 2026-09-10)

**Base:** `e2fcc1d` (`main`). La homologacion «Aurora» vivia en CSS sobre clases repetidas a mano en seis superficies; ahora vive ademas en componentes React, y las dos pantallas mas grandes estan partidas. Restriccion de la entrega: **ningun cambio de DOM** — la instantanea de estilos identifica cada elemento por etiqueta, conjunto de clases y posicion, y las lineas base visuales y los selectores de pruebas nombran las clases actuales.

### Entregado

**`src/components/ui/`** (junto a `PanelHead`): `Kbd` (una tecla; clase opcional solo para la paleta), `SearchField` (lupa + campo `filter-field`/`filter-input` + hueco `trailing` para el boton de limpiar o cerrar; tamano de icono y `ref`), `Chip` y `ChipRow` (pestanas de nube del explorador y del selector, chips de carpeta y favoritos de la biblioteca: `role="tab"` con `aria-selected` cuando son pestanas, punto `chip-dot`, contador `chip-count`, `--cloud-color`, modificador `is-mine`), `GroupHeader` (cabecera de grupo con contador; `button` con chevron y `aria-expanded` cuando pliega, antes o despues del nombre; `div|header|p|span|h3` cuando no), `Tile` (tesela de servicio: icono → marca → nombre → meta, `data-key`/`aria-pressed`/`is-current` para el selector, `draggable` con la clave en `text/plain` para el explorador) con `SpriteIcon` (el `<svg><use href="#i-…"/></svg>` del sprite), `Row` (fila de lista: icono → texto → meta; `--i` para el escalonado; el resto de atributos de la lista por `rest`), y `Field`/`NumberField`/`Section` movidos desde `inspector/fields.tsx` (`Section` ahora construido sobre `GroupHeader`). Las clases propias de cada superficie viajan por props (`className`, `labelClassName`, `countClassName`…): son lo que el CSS viste y las pruebas seleccionan; la anatomia comun (`chip`, `group-header`, `filter-field`, el orden de las partes) la impone el componente.

**Migradas**: explorador de servicios (busqueda, pestanas, cabeceras, teselas de catalogo, propias y de subida), selector de iconos y su seccion «Propios» en `CustomIcons.tsx` (ademas el formulario de subida usa `Field` en vez de cuatro copias del marcado), paleta ⌘K (cabeceras de grupo, filas de comando y de servicio, `kbd` del pie), historial (cuatro cabeceras), analisis (cabeceras con severidad, filas), menus de la barra y contextual (`Kbd`), hoja de atajos (`GroupHeader` + `Kbd`), dock y estado vacio (`Kbd`), biblioteca (busqueda, chips, `kbd`), inspector (`Field`, `NumberField`, `Section` desde `ui`).

**Particiones**: `TopBar.tsx` 600 → 279 lineas, con `ExportMenu.tsx`, `MoreMenu.tsx` y `AccountMenu.tsx` (cada uno su `.topbar-menu-host` completo; contrato comun en `menuProps.ts`: `menu` (presencia), `onToggle`, `onClose`, `pick`, `chord`, `off`); `Library.tsx` 702 → 352, con `LibraryHeader.tsx`, `LibraryHero.tsx` (con `SERVICE_COUNT`/`CLOUD_COUNT` y la inclinacion del escaparate), `LibraryToolbar.tsx` (exporta `FAVOURITES`/`NO_FOLDER`), `DiagramCard.tsx` y `TemplateGallery.tsx` (exporta `TemplatePreview`). Extraccion por corte de lineas exactas: el JSX es el mismo, cambiaron solo los nombres de los manejadores.

**Pruebas de render** (`src/components/ui/ui.test.ts`, happy-dom + `react-dom/client`): cada componente se renderiza y su HTML se compara byte a byte con el marcado manual que sustituye (16 pruebas), incluida la carga `text/plain` del arrastre de `Tile`.

### Pruebas ejecutadas

| Comprobacion                                         | Resultado                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `npm test`                                           | 1155 pruebas (antes 1139)                                                              |
| `npm run typecheck`, `lint`, `format:check`, `build` | Correctos (ESLint sin avisos: importaciones de iconos podadas en `TopBar` y `Library`) |
| **`styles:compare`** (build de `e2fcc1d` vs. nuevo)  | **0 elementos distintos de 33.960 comparados en 140 estados — identicos**              |
| Playwright funcional / visual                        | 136 de 136 / 24 de 24                                                                  |
| `npm run audit:controls`                             | 83 de 83                                                                               |

### Limites conocidos

- La paleta conserva su propia busqueda (`palette-search`/`palette-input`, con ARIA de combobox) y no `SearchField`: cambiar sus clases cambiaria el DOM.
- `ChoiceField`, `FillField` y `FillPresets` siguen en `inspector/fields.tsx`: son del inspector (tonos por palabra), no anatomia comun.
- El menu contextual y `MenuItem` siguen siendo marcados distintos (`context-menu-item` sin icono ni texto secundario); unificarlos exigiria cambiar el DOM.
- No hay `@testing-library/react`: las pruebas de render usan `react-dom/client` + `act` en happy-dom (patron de `usePresence.test.ts`).

## CP2, CP4 a CP9: pendientes

Orden previsto: F2 (editor general y flowchart), F4 (biblioteca de equipo, comentarios, publicaciones), F5, F6, F7 (CRDT y offline) y F8 (AWS). Ver `PLAN_MAESTRO.md`, seccion 9.

## Siguiente tarea exacta

1. Confirmar H1 #2 fase 2 en un commit y `git push`; reconstruir la imagen Docker local.
2. H1 cerrado del todo. Siguiente segun `PLAN_MEJORAS.md`: **H2** — #10 presentacion (M), #12 notas/texto/regiones (L, primer paso de F2), #20 plantillas propias (S, ya puede apoyarse en los roles), #14 iconos en servidor (M), #9 comentarios anclados (L), #11 conectores editables (L).
3. Dar de alta el provider en Authentik siguiendo `docs/AUTHENTIK.md` cuando el usuario lo pida (hoy no existe), y probar el login de extremo a extremo.
4. Abrir F2 (editor general) por las notas/texto/regiones de `PLAN_MEJORAS.md` H2 #12, sin romper la familia cloud.
