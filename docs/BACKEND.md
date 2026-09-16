# Backend de AC Graph — guía de traspaso

> Documento raíz del backend. Está escrito para que una persona que no ha tocado el
> proyecto pueda entender, operar, depurar y extender el servidor sin preguntar a
> nadie. Lo completan la [referencia de la API](API.md) y la [base de datos](DATABASE.md).

**Estado en la fecha del traspaso (2026-09-16):** modo servidor completo (PostgreSQL,
login por contraseña u OIDC, roles por diagrama, colaboración en vivo, iconos y
comentarios compartidos), observabilidad completa, imagen Docker y Terraform para AWS
(no aplicado desde esta máquina). Sin bugs conocidos abiertos; los límites de alcance
están en [§22](#22-límites-conocidos-y-deuda-técnica).

## 0. Cómo usar este conjunto de documentos

| Necesitas…                                                       | Lee                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Entender qué hace el servidor y cómo está armado                 | Este documento, §1–§5                                                             |
| Saber qué devuelve cada endpoint y con qué códigos               | [`API.md`](API.md)                                                                |
| Tocar el esquema, escribir una migración, consultas de operación | [`DATABASE.md`](DATABASE.md)                                                      |
| Levantarlo con Docker, ver logs y métricas                       | [`DOCKER.md`](DOCKER.md)                                                          |
| Configurar SSO con Authentik                                     | [`AUTHENTIK.md`](AUTHENTIK.md)                                                    |
| Desplegar en AWS                                                 | [`AWS.md`](AWS.md) (runbook, inglés) y [`GUIA_RAPIDA_AWS.md`](GUIA_RAPIDA_AWS.md) |
| Retomar el trabajo: decisiones, comandos del día a día           | [`CONTEXTO.md`](CONTEXTO.md)                                                      |
| Historial de entregas                                            | [`CHECKPOINTS.md`](CHECKPOINTS.md)                                                |

Regla del conjunto: **el código es la fuente de verdad**. Cada afirmación señala el
archivo donde vive; si código y documento discrepan, gana el código y se corrige el
documento.

## 1. Resumen en una página

- **Qué es.** AC Graph es un editor de diagramas de arquitectura (Next.js 16, React 19).
  El "backend" son los _route handlers_ de `src/app/api/**` y el módulo `src/server/**`
  que los sostiene. No hay servidor aparte: todo corre dentro del proceso Node de Next
  (`output: 'standalone'`).
- **Dos modos.** Sin `DATABASE_URL` + `APP_URL` la app es **local**: los diagramas viven
  en IndexedDB del navegador y el servidor solo sirve la página, la IA, el embed,
  `/api/health`, `/api/metrics` y `/api/config`. Con ambas variables es **modo servidor**:
  PostgreSQL, cuentas, sesiones por cookie, roles por diagrama, colaboración en vivo.
- **Stack.** Node ≥ 24.20 < 25 · Next 16.3 · TypeScript estricto · `pg` (SQL a mano, sin
  ORM) · `zod` 4 (todo lo que cruza la red se valida) · `openid-client` 6 (OIDC) ·
  `@anthropic-ai/sdk` (IA) · OpenTelemetry (opcional). Logger y registro Prometheus son
  propios, sin dependencias.
- **Una sola puerta.** Toda ruta pasa por `observe()` (id de petición, métricas, línea de
  acceso) y las de modo servidor por `withUser()` / `withServerMode()`
  (`src/server/handler.ts`). Todo error sale como `{ code, message, ...details }` desde
  `errorResponse()` (`src/server/http.ts`).
- **Autorización en el repositorio, no en la UI.** `PgDiagramRepository` hace join con
  `diagram_members` en cada lectura y lee el rol con `for update` en cada escritura.
  Roles: `owner` > `editor` > `viewer`.
- **Concurrencia optimista.** `updatedAt` (ISO estrictamente creciente,
  `src/server/clock.ts`) es la revisión. El cliente la manda en `If-Match`; si no
  coincide, `412 conflict` con el registro actual.
- **Colaboración best effort.** SSE por diagrama (`/api/diagrams/[id]/events`), presencia
  en memoria con TTL 15 s, y un bus `LISTEN/NOTIFY` (`acgraph_collab`) que une réplicas.
  Lo que decide un guardado es la base de datos, nunca el bus.
- **Esquema automigrado.** Diez migraciones SQL embebidas en `src/server/schema.ts`; se
  aplican en el primer acceso autenticado de cada proceso bajo advisory lock. No hay paso
  manual de migración.
- **Sin estado compartido fuera de Postgres.** Rate limiters, presencia, hub de eventos y
  memo del esquema son por proceso (`globalThis`). Es una decisión de alcance, no un
  olvido (§22).

## 2. Los dos modos

Lo decide `readServerEnv()` (`src/server/env.ts`), leído en cada llamada, nunca en import:

```
modo servidor  ⇔  DATABASE_URL y APP_URL ambos presentes, y APP_URL es http(s) absoluta
proveedor      =  'oidc' si OIDC_ISSUER y OIDC_CLIENT_ID están AMBOS; si no, 'local' (contraseña)
                  (solo uno de los dos → readServerEnv devuelve null → MODO LOCAL, a propósito:
                   un proveedor a medias no debe caer en silencio a contraseñas)
signupOpen     =  proveedor 'local' y AUTH_SIGNUP ≠ 'closed'
```

|                                                                          | Local                                          | Servidor                                                                      |
| ------------------------------------------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Persistencia                                                             | IndexedDB (`src/lib/store/localRepository.ts`) | PostgreSQL (`src/server/diagrams/repository.ts`); cliente `httpRepository.ts` |
| Cuentas                                                                  | No hay                                         | Contraseña (scrypt) u OIDC                                                    |
| `/api/diagrams/**`, `/api/icons/**`, `/api/workspace/**`, `/api/auth/**` | `404 server_mode_off`                          | Activos                                                                       |
| Iconos propios                                                           | `localStorage` del navegador                   | Tabla `icons`, compartida por todos                                           |
| Colaboración                                                             | No                                             | SSE + presencia + bus entre réplicas                                          |
| `/api/config`                                                            | `{ mode: 'local' }`                            | `{ mode: 'server', auth: {…} }`                                               |
| IA, embed, health, metrics, config                                       | Sí                                             | Sí                                                                            |

El navegador pregunta `/api/config` una vez al arrancar (`src/lib/appConfig.ts`) y
elige repositorio. Si la respuesta falla, asume local: un despliegue sin API es
exactamente el editor local.

## 3. Arquitectura

```mermaid
flowchart LR
  subgraph Browser
    UI[Editor React]
    Repo[HttpDiagramRepository<br/>fetch same-origin + cookie]
    SSE[EventSource /events]
  end
  subgraph Next[Proceso Next.js standalone]
    Routes[src/app/api/** route handlers]
    Guard[handler.ts<br/>observe → withUser / withServerMode]
    Http[http.ts errores tipados]
    PgRepo[PgDiagramRepository / PgIconLibrary]
    Auth[auth/ session · password · oidc]
    Collab[collab/ hub · presence · stream · bus]
    Obs[observability/ log · metrics · tracing]
    AI[lib/ai + /api/ai/*]
  end
  PG[(PostgreSQL 17<br/>10 migraciones)]
  IdP[Proveedor OIDC<br/>opcional]
  Anthropic[Anthropic API<br/>opcional]
  OTLP[Colector OTLP<br/>opcional]
  Prom[Prometheus]

  UI --> Repo --> Routes
  SSE --> Routes
  Routes --> Guard --> Http
  Guard --> PgRepo --> PG
  Guard --> Auth --> PG
  Auth -.-> IdP
  Routes --> Collab
  Collab -- LISTEN / NOTIFY --> PG
  Routes --> AI -.-> Anthropic
  Obs -.-> OTLP
  Prom -- GET /api/metrics --> Routes
```

Las dos reglas que sostienen la forma (README § Architecture) valen también para el
backend:

1. **La UI nunca hace I/O directo**: todo pasa por la interfaz `DiagramRepository`
   (`src/lib/store/types.ts`), con dos implementaciones del mismo contrato — IndexedDB y
   HTTP — y el servidor implementa ese contrato sobre Postgres. Por eso `SaveCoordinator`
   y los hooks del editor no saben en qué modo están.
2. **El motor nunca toca el navegador**: `src/lib/engine` y `src/lib/editor/renderSvg`
   corren en Node, y así `/api/embed` renderiza el mismo SVG que el lienzo.

Dirección de las importaciones: `src/app/api/**` → `src/server/**` → `src/lib/**`.
**Nada de `src/lib` ni `src/components` importa `src/server`** (rompería el bundle del
cliente y el modo local). Verificado a la fecha con `grep`.

## 4. Mapa del código

### `src/server/` — el núcleo

| Archivo                               | Responsabilidad                                                                                           | Símbolos clave                                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `handler.ts`                          | Prólogo común de toda ruta de modo servidor: modo → CSRF → cookie → esquema → sesión                      | `withUser`, `withServerMode`, `ServerContext`, `sessionKeyOf`                                                                                  |
| `http.ts`                             | Forma única de error, helpers de respuesta, lectura de cuerpo con tope                                    | `ErrorCode`, `HttpError`, `errorResponse`, `json`, `noContent`, `readJsonBody`, `MAX_BODY_BYTES` (5 MiB)                                       |
| `env.ts`                              | Lectura y validación de variables; decide modo y proveedor                                                | `readServerEnv`, `serverEnv`, `oidcEnv`, `serverMode`, `readObservabilityEnv`                                                                  |
| `db.ts`                               | Pool `pg` único por proceso, transacciones                                                                | `getPool`, `withTransaction`, `poolConfig`, `STATEMENT_TIMEOUT_MS` (15 s)                                                                      |
| `schema.ts`                           | Migraciones embebidas e idempotentes; memo por proceso                                                    | `MIGRATIONS`, `runMigrations`, `ensureSchema`                                                                                                  |
| `globals.ts`                          | Singletons en `globalThis` (Next empaqueta cada ruta por separado)                                        | `singleton`, `peekSingleton`, `resetSingleton`                                                                                                 |
| `clock.ts`                            | Timestamps ISO estrictamente crecientes (la "revisión")                                                   | `serverClock`, `createClock`                                                                                                                   |
| `diagrams/repository.ts`              | Repositorio Postgres: diagramas, versiones, miembros, hilos, export/import. **Aquí vive la autorización** | `PgDiagramRepository`, `roleAllows`                                                                                                            |
| `diagrams/schemas.ts`                 | Cuerpos de petición (Zod) de la API de diagramas                                                          | `CreateDiagramBodySchema`, `SaveBodySchema`, `MetaPatchSchema`, `MemberBodySchema`, `ThreadBodySchema`, `WorkspaceImportSchema`                |
| `diagrams/routes.ts`                  | Helpers de ruta: parseo de cuerpo, `If-Match`, 412 con registro actual                                    | `parseBody`, `expectedRevision`, `withConflict`                                                                                                |
| `diagrams/errors.ts`                  | Errores de dominio que `errorResponse` traduce                                                            | `DiagramNotFoundError`, `DiagramForbiddenError`, `UserNotFoundError`, `MembershipError`, `Thread*Error`, `VersionNotFoundError`                |
| `icons/repository.ts`                 | Biblioteca de iconos del workspace, deduplicada por hash, con cuota                                       | `PgIconLibrary`, `contentHashOf`, `MAX_WORKSPACE_ICONS` (200), `MAX_WORKSPACE_ICON_BYTES` (16 MiB)                                             |
| `icons/schemas.ts`, `icons/errors.ts` | Cuerpo de subida; error de cuota                                                                          | `IconBodySchema`, `IconLibraryFullError`                                                                                                       |
| `auth/session.ts`                     | Cookies de sesión y de estado de login, CSRF, lectura de cookies                                          | `SESSION_COOKIE` (`acg_session`), `createSession`, `requireUser`, `destroySession`, `assertSameOrigin`, `AUTH_STATE_COOKIE`                    |
| `auth/password.ts`                    | Cuentas locales: scrypt, límites de intentos, alta, cambio de contraseña                                  | `hashPassword`, `verifyPassword`, `authenticate`, `register`, `createLocalUser`, `setPassword`, `takeAttempt`, `LOGIN_LIMITS`, `SIGNUP_LIMITS` |
| `auth/oidc.ts`                        | Authorization Code + PKCE contra cualquier proveedor OIDC                                                 | `beginLogin`, `completeLogin`, `endSessionUrl`, `safeNextPath`, `CALLBACK_PATH`                                                                |
| `collab/events.ts`                    | Fan-out por diagrama dentro del proceso (salas)                                                           | `EventHub`, `DiagramEvent`, `formatSse`                                                                                                        |
| `collab/presence.ts`                  | Quién mira qué, en memoria, con TTL                                                                       | `PresenceRegistry`, `PRESENCE_TTL_MS` (15 s)                                                                                                   |
| `collab/stream.ts`                    | Una conexión SSE por espectador                                                                           | `openDiagramStream`, `HEARTBEAT_MS` (15 s), `toWire`                                                                                           |
| `collab/bus.ts`                       | Transporte entre réplicas: `PgBus` (LISTEN/NOTIFY) y `MemoryBus`                                          | `BUS_CHANNEL` (`acgraph_collab`), `BusMessageSchema`, `MAX_PAYLOAD_BYTES` (7 900), `DEFAULT_BACKOFF_MS`                                        |
| `collab/collaboration.ts`             | Coordinador por réplica: aplica local, publica al bus, filtra eco                                         | `collaboration()`, `Collaboration.publish / touch / leave`                                                                                     |
| `observability/context.ts`            | `AsyncLocalStorage` con el contexto de la petición                                                        | `runWithRequest`, `currentRequest`, `annotateRequest`                                                                                          |
| `observability/log.ts`                | Logger JSON/pretty con redacción de secretos                                                              | `log()`, `rootLogger`, `createLogger`, `sanitize`                                                                                              |
| `observability/metrics.ts`            | Registro Prometheus propio y las métricas de la app                                                       | `metrics()`, `appMetrics()`, `Counter / Gauge / Histogram`, `MAX_SERIES` (500)                                                                 |
| `observability/request.ts`            | Envoltorio de toda ruta: id, métricas, línea de acceso                                                    | `observe`, `REQUEST_ID_HEADER`                                                                                                                 |
| `observability/tracing.ts`            | OpenTelemetry, solo si hay colector                                                                       | `startTracing`                                                                                                                                 |
| `observability/startup.ts`            | Arranque del proceso y red de seguridad de errores de Next                                                | `startObservability`, `reportRequestError`                                                                                                     |
| `testing/pg.ts`, `testing/logs.ts`    | Utilidades de prueba (Postgres desechable por esquema, captura de logs)                                   | `testPool`, `freshSchema`, `testEnv`, `resetServerSingletons`, `captureLogs`                                                                   |

### `src/app/api/` — las 26 rutas

Cada `route.ts` es delgado: declara su plantilla de ruta, elige guarda, parsea el
cuerpo con su schema, llama al repositorio y publica el evento de sala si toca. La
lista completa con métodos, códigos y ejemplos está en [`API.md`](API.md). Todas llevan
`export const dynamic = 'force-dynamic'` salvo `embed` (que se cachea por URL) y las
dos de IA.

### Fuera de `src/server`, pero parte del backend

| Ruta                                                        | Qué aporta                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/instrumentation.ts`                                    | Hooks de Next: `register()` → `startObservability()`; `onRequestError` → `reportRequestError()`                          |
| `src/lib/domain/project.ts`                                 | Schemas compartidos con el navegador: `DiagramMeta / Record / Version`, `DiagramMember`, `CommentThread`, `User`, `Role` |
| `src/lib/domain/diagram.ts`                                 | `DiagramModelSchema` (el documento) y `CustomIconSchema`                                                                 |
| `src/lib/store/types.ts`                                    | Interfaz `DiagramRepository` que el servidor implementa                                                                  |
| `src/lib/store/httpRepository.ts`                           | El cliente de la API; define el contrato desde el otro lado (`x-requested-with`, `If-Match`, mapeo de errores)           |
| `src/lib/store/localRepository.ts`                          | `DiagramConflictError`, `MAX_VERSIONS_PER_DIAGRAM` (50), `copyTitle` — compartidos con el servidor                       |
| `src/lib/ai/*`                                              | Cliente Anthropic, prompts, schema de salida, `RateLimiter` (también lo usa el login)                                    |
| `src/lib/share/codec.ts`                                    | Codec deflate + base64url del embed                                                                                      |
| `scripts/users.mjs`                                         | CLI de cuentas (usa `src/server/auth/password.ts` directamente a través de `bin/hooks.mjs`)                              |
| `Dockerfile`, `compose.yaml`, `compose.server.yaml`         | Imagen y orquestación local                                                                                              |
| `deploy/aws/terraform/`, `.github/workflows/deploy-aws.yml` | Infraestructura y despliegue continuo                                                                                    |

## 5. Ciclo de vida de una petición

```mermaid
sequenceDiagram
  participant B as Navegador
  participant O as observe()
  participant G as withUser()
  participant S as ensureSchema()
  participant R as PgDiagramRepository
  participant C as collaboration()
  B->>O: PUT /api/diagrams/dgm_x (cookie, x-requested-with, If-Match)
  O->>O: requestId (x-request-id o UUID), contexto ALS, in-flight++
  O->>G: run()
  G->>G: serverMode()? no → 404 server_mode_off
  G->>G: mutating → assertSameOrigin() → 403 forbidden
  G->>G: ¿cookie acg_session? no → 401 (sin tocar la BD)
  G->>S: migraciones pendientes (memo por proceso)
  G->>G: requireUser() → 401 si la sesión no existe o expiró
  G->>R: handler({ user, repository, icons, sessionKey })
  R->>R: BEGIN · SELECT … FOR UPDATE + join miembros · rol ≥ editor · expectedUpdatedAt = updated_at
  R->>R: UPDATE … · COMMIT
  R-->>G: DiagramRecord
  G->>C: publish(id, { type: 'saved' })
  G-->>O: Response 200
  O->>O: métricas (route, method, status), línea de acceso
  O-->>B: 200 + x-request-id
```

**Orden exacto de las guardas** (`src/server/handler.ts`):

`withUser` — para todo lo que necesita usuario:

1. `observe()` — siempre, antes que nada, para que un 401 o un 404 también queden en
   métricas y log.
2. `serverMode()` falso → `404 server_mode_off` (sin tocar la BD).
3. `mutating: true` → `assertSameOrigin()` → `403 forbidden` (barato, sin I/O).
4. Sin cookie `acg_session` → `401 unauthenticated` **sin despertar la base de datos**.
5. `ensureSchema()` — migraciones pendientes, una vez por proceso.
6. `requireUser()` — la sesión existe y no ha expirado; si no, `401`.
7. Se construyen `PgDiagramRepository(user)` y `PgIconLibrary(user)` (una instancia por
   petición, ligadas al actor) y `sessionKey` (SHA-256 truncado de la cookie: identifica
   pestañas de una misma sesión sin exponer la cookie).
8. Cualquier `throw` posterior → `errorResponse()`.

`withServerMode` — para las rutas de auth, donde aún no hay usuario: igual, pero en
lugar de la cookie comprueba la **cara** del login (`provider: 'local' | 'oidc'`): una
ruta de la otra cara responde `404 not_found` **antes** de `ensureSchema()`, de modo que
un despliegue con contraseñas no expone el redirect OIDC y viceversa.

Rutas que **no** pasan por `withUser`: `/api/health`, `/api/metrics`, `/api/config`,
`/api/embed`, `/api/ai/*`. Todas pasan igualmente por `observe()`.

### Contrato de errores

Siempre JSON `{ code, message, ...details }` con `Cache-Control: no-store`. El cliente
decide por `code`, nunca por `message`. Mapeo completo en `errorResponse()`
(`src/server/http.ts`):

| Lanzado                                                               | HTTP    | `code`           | Detalles extra                                                |
| --------------------------------------------------------------------- | ------- | ---------------- | ------------------------------------------------------------- |
| `HttpError(status, code)`                                             | el suyo | el suyo          | `details`; cabeceras (p. ej. `Retry-After`)                   |
| `DiagramConflictError`                                                | 412     | `conflict`       | `current` (el registro actual) cuando pasa por `withConflict` |
| `DiagramNotFoundError`, `VersionNotFoundError`, `ThreadNotFoundError` | 404     | `not_found`      |                                                               |
| `DiagramForbiddenError`                                               | 403     | `no_access`      | `required` (rol mínimo), `owner.name`                         |
| `ThreadForbiddenError`                                                | 403     | `forbidden`      |                                                               |
| `UserNotFoundError`                                                   | 404     | `user_not_found` |                                                               |
| `MembershipError`                                                     | 400     | `bad_request`    |                                                               |
| `IconLibraryFullError`                                                | 409     | `library_full`   | `count`, `bytes`                                              |
| `ZodError`                                                            | 400     | `bad_request`    | `issues: [{ path, message }]`                                 |
| cualquier otro                                                        | 500     | `internal`       | `requestId`; se loguea con stack, nunca con la petición       |

Los 15 códigos y cuándo aparece cada uno: [`API.md` § Errores](API.md#errores).

## 6. Autenticación y sesiones

### Cookie de sesión

- Nombre `acg_session`; valor: 256 bits aleatorios en base64url. **La BD guarda solo su
  SHA-256** (`sessions.id_hash`): un volcado no sirve para suplantar.
- Atributos: `HttpOnly; SameSite=Lax; Path=/; Max-Age=<SESSION_TTL_HOURS·3600>`; `Secure`
  exactamente cuando `APP_URL` es `https://`.
- **TTL fijo, sin renovación** (12 h por defecto): más simple de razonar; volver a entrar
  es barato (y con SSO, casi invisible).
- Cada login y cada logout barren las sesiones expiradas
  (`delete … where expires_at <= now()`); la tabla no necesita cron.
- `GET /api/auth/me` devuelve el usuario o 401; el cliente lo usa al arrancar.

### CSRF (`assertSameOrigin`, `src/server/auth/session.ts`)

Toda petición mutante (POST/PUT/PATCH/DELETE) en modo servidor debe cumplir **dos**
cosas, o es `403 forbidden`:

1. Cabecera `x-requested-with: ac-graph` (un formulario cross-site o una navegación no la
   pueden poner).
2. `Origin` (o `Referer` si no hay `Origin`) con el mismo origen que `APP_URL`.

Por eso `APP_URL` tiene que ser **exactamente** el origen que usa el navegador (esquema,
host y puerto). Un `APP_URL` mal puesto se manifiesta como "todo GET funciona, todo
POST da 403".

### Dos caras del login

`serverEnv().authProvider` decide qué rutas existen:

|                       | `local` (contraseña)                                                                  | `oidc`                                                                      |
| --------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Entrar                | `POST /api/auth/login` `{ email, password }`                                          | `GET /api/auth/login?next=/…` → 302 al proveedor                            |
| Alta                  | `POST /api/auth/register` si `AUTH_SIGNUP ≠ closed`; si no, `npm run users -- create` | La decide el proveedor                                                      |
| Callback              | —                                                                                     | `GET /api/auth/callback`                                                    |
| Salir                 | `POST /api/auth/logout` → 204                                                         | `POST /api/auth/logout` → 200 `{ endSessionUrl }` si el proveedor lo ofrece |
| Rutas de la otra cara | `404 not_found`                                                                       | `404 not_found`                                                             |

### Contraseñas (`src/server/auth/password.ts`)

- **scrypt de Node** (sin dependencia): `N = 2^15, r = 8, p = 3`, clave 64 B, sal 16 B,
  `maxmem` 64 MiB (~32 MiB reales, decenas de ms por hash). Formato almacenado
  `scrypt$N$r$p$<sal>$<hash>` en base64url: los parámetros viajan dentro y se pueden
  subir sin migrar lo existente.
- Una cuenta local es una fila de `users` con `issuer = 'local'` y
  `subject = lower(email)`. La unicidad del correo la da la constraint `(issuer, subject)`
  que ya existía; **no añadir índice por email**.
- Contraseña: 10–200 caracteres. Correo: 3–254, en minúsculas, regex sencilla.
- Correo inexistente y contraseña errónea son **el mismo `401 invalid_credentials` y
  tardan lo mismo** (se verifica contra un hash señuelo, `decoy()`).
- Una cuenta que llegó por OIDC no tiene `password_hash` y falla igual: la página de
  login no revela quién existe.
- Límite de intentos con el `RateLimiter` de token bucket de la IA, **por proceso**:
  login 10 de ráfaga / 5 por minuto en dos cubos (por IP y por correo); alta 5 / 2 por IP.
  Agotado → `429 rate_limited` con `Retry-After` y `retryAfter` en el cuerpo. La IP se lee
  de `x-forwarded-for` (primer valor) o `x-real-ip`.
- El alta responde `403 signup_closed` o `409 email_taken` de forma explícita (quien se
  da de alta quiere crear, no sondear; el limitador es lo que impide usarlo como sonda).
- Nunca se loguea el correo de un intento rechazado (solo `password rejected`).

### OIDC (`src/server/auth/oidc.ts`) — Authorization Code + PKCE

```mermaid
sequenceDiagram
  participant B as Navegador
  participant A as App
  participant DB as auth_states
  participant P as Proveedor OIDC
  B->>A: GET /api/auth/login?next=/d/dgm_x
  A->>P: discovery (una vez por proceso, en memo — se olvida si falla)
  A->>DB: insert state, code_verifier, nonce, next_path (TTL 10 min)
  A-->>B: 302 authorize_url + Set-Cookie acg_auth_state=state (10 min)
  B->>P: login en el proveedor
  P-->>B: 302 /api/auth/callback?code&state
  B->>A: GET /api/auth/callback (cookie acg_auth_state)
  A->>A: state de la query == state de la cookie (si no: 400)
  A->>DB: delete … where state=$1 and expires_at>now() returning … (consumido una sola vez)
  A->>P: token endpoint (code, PKCE verifier, redirect_uri = APP_URL + /api/auth/callback)
  P-->>A: id_token (firma verificada contra JWKS, nonce comprobado)
  A->>A: upsert users por (issuer, subject) y actualiza name / email / picture
  A->>A: createSession()
  A-->>B: 302 next_path + Set-Cookie acg_session + borra acg_auth_state
```

- El usuario se identifica por `(iss, sub)`, **nunca por correo** (los correos cambian de
  manos).
- La cookie `acg_auth_state` ata el intento al navegador que lo empezó: evita el _login
  CSRF_ (que un atacante termine _su_ login en el navegador de la víctima).
- `next` solo admite rutas relativas del mismo sitio (`safeNextPath`): nada de `//evil`
  ni URLs absolutas.
- `redirect_uri` se construye desde `APP_URL`, no desde el host que ve el contenedor. En
  el proveedor debe estar registrado exactamente `<APP_URL>/api/auth/callback`.
- Fallos (proveedor caído, token rechazado, estado caducado) → 302 a la página de inicio
  con `?auth_error=provider` o `?auth_error=callback`; el detalle queda en el log, no en
  la respuesta.
- Alcances `openid profile email`. Nombre mostrado: `name` → `preferred_username` →
  `email` → `sub`.
- Issuer `http://` solo se acepta para desarrollo (`allowInsecureRequests`).
- Cliente confidencial si `OIDC_CLIENT_SECRET` está (`client_secret_post`); si no,
  público solo con PKCE.

Configuración paso a paso del proveedor: [`AUTHENTIK.md`](AUTHENTIK.md) §1–§3.

## 7. Autorización: roles por diagrama

- Tres roles con rango: `viewer (1) < editor (2) < owner (3)` (`roleAllows`,
  `src/server/diagrams/repository.ts`). El propietario es `diagrams.owner_id` y
  **también** tiene fila en `diagram_members` con `role = 'owner'` (así un solo join
  responde "qué diagramas ve esta persona").
- **Dónde se decide:** en `PgDiagramRepository`, nunca solo en la UI. Cada lectura hace
  `left join diagram_members m on m.user_id = <actor>`; cada escritura hace
  `select … for update of d` con el mismo join y comprueba el rol dentro de la
  transacción. No hay instante en que alguien revocado conserve un lock.
- Diagrama inexistente → `404 not_found`. Existe pero no soy miembro (o mi rol no alcanza)
  → `403 no_access` con `required` y `owner.name` (para que la UI diga "pídele acceso a
  Ada"), **nunca el diagrama**.

| Acción                                                 | Rol mínimo                    | Nota                                          |
| ------------------------------------------------------ | ----------------------------- | --------------------------------------------- |
| Ver, listar versiones, listar miembros, presencia, SSE | `viewer`                      |                                               |
| Comentar: abrir, responder, resolver / reabrir         | `viewer`                      | Leer basta para tener algo que decir          |
| Borrar un hilo                                         | autor del hilo **o** `owner`  | `403 forbidden` para el resto                 |
| Guardar (PUT), PATCH de metadatos, restaurar versión   | `editor`                      |                                               |
| Duplicar                                               | `viewer`                      | La copia es de quien la hace, con rol `owner` |
| Invitar / cambiar rol / quitar a otros                 | `owner`                       | La fila del propietario es intocable (`400`)  |
| Salir del diagrama (borrar mi propia fila)             | `viewer`                      |                                               |
| Borrar el diagrama                                     | `owner`                       |                                               |
| Iconos del workspace (listar, subir, quitar)           | cualquier usuario autenticado | Sin roles: hay un solo workspace (§22)        |

- Invitar exige que la persona **haya iniciado sesión al menos una vez** (se busca por
  `lower(email)` en `users`; si no está → `404 user_not_found`). Las cuentas nacen del
  login, nunca de una invitación.
- No hay transferencia de propiedad ni roles de workspace (§22).
- Los cambios de acceso viajan en vivo como evento SSE `access` (`role: null` = quitado)
  y el cliente reacciona sin recargar.
- Auditoría automatizada: `npm run audit:roles` (`scripts/audit-roles.mjs`, 48
  comprobaciones con tres navegadores).

## 8. Persistencia y concurrencia

### El repositorio

`PgDiagramRepository` implementa `DiagramRepository` (`src/lib/store/types.ts`) — el
mismo contrato que IndexedDB — más `MembersApi` y los comentarios. Una instancia **por
petición**, ligada al `actor`. SQL a mano con parámetros `$n`; nunca interpolación de
valores. Toda fila se **re-valida con Zod al leer** (`DiagramRecordSchema.parse`): una
fila editada a mano o de un esquema antiguo falla aquí, no en el lienzo.

### La revisión: `updatedAt`

- Los timestamps de dominio (`created_at` / `updated_at` de `diagrams` y
  `diagram_versions`; `created_at` / `resolved_at` de hilos) son **`text` ISO-8601**, no
  `timestamptz`: el dominio compara por igualdad exacta de cadenas y un viaje por
  `timestamptz` los reformatearía.
- `serverClock()` (`src/server/clock.ts`) produce ISO **estrictamente crecientes** dentro
  del proceso y, con `clock(after)`, siempre posteriores a la fila que se acaba de leer
  bajo lock. Así dos escrituras nunca comparten sello aunque haya varias réplicas.

### Guardado con concurrencia optimista

1. El cliente manda `If-Match: <updatedAt que vio>` (o `options.expectedUpdatedAt`; la
   cabecera gana). Se aceptan la forma entrecomillada `"…"` y el prefijo `W/`; `*` o
   vacío = sin condición.
2. `change()` abre transacción, `select … for update of d`, comprueba rol ≥ `editor`,
   compara `expectedUpdatedAt === existing.updatedAt`.
3. Si difiere → `DiagramConflictError` → `withConflict` responde `412 conflict` **con
   `current`** (el registro actual), para que el editor muestre qué cambió sin otra ida y
   vuelta. `acgraph_diagram_saves_total{result="conflict"}` y `acgraph_http_conflicts_total`
   lo cuentan: un conflicto es normal en un workspace compartido, no un error.
4. Si coincide: se aplica `metadata` (título / descripción / carpeta), se redibuja la
   miniatura (`renderThumbnail`, SVG inline en `diagrams.thumbnail`), se hace snapshot si
   `options.snapshot` o `options.snapshotModel`, se escribe con
   `updatedAt = clock(existing.updatedAt)`, `COMMIT`.
5. La ruta publica `saved` (y `meta` si cambió el título) a la sala.

`PATCH` de metadatos y `DELETE` no llevan condición de revisión (no tocan el modelo).
`restore` sí.

### Historial de versiones

- `diagram_versions` guarda modelos completos (`jsonb`). Un snapshot se crea al guardar
  con `snapshot: true` (guarda el modelo **anterior**) o `snapshotModel` (guarda ese
  modelo explícito, con `label`), y siempre antes de restaurar (`label = 'before restore'`).
- Se conservan las **50 más recientes** por diagrama (`MAX_VERSIONS_PER_DIAGRAM`); el
  resto se borra en la misma transacción.
- Restaurar copia el modelo de la versión al diagrama, redibuja la miniatura y avanza
  `updatedAt`; nunca destruye (siempre hay un snapshot previo).

### Otras operaciones

- **Crear**: `id = uid('dgm')`, miniatura dibujada ya (para que la biblioteca tenga vista
  previa), fila `owner` en `diagram_members`, todo en una transacción.
- **Duplicar**: `get` (basta `viewer`) + `create` con el modelo clonado; título del cuerpo
  o `"<título> copy"` (`copyTitle`).
- **Borrar**: `owner`; `for update`; `delete from diagrams` — versiones, miembros e hilos
  caen en cascada. Idempotente (id desconocido → 204).
- **Export**: todo lo que el actor puede leer + su historial. **Import**: valida todo
  antes de escribir nada, reasigna ids (`dgm_`, `ver_`), el importador queda propietario,
  una transacción. Los iconos del workspace **no** van en la exportación (§22).

### Transacciones y pool (`src/server/db.ts`)

- `withTransaction(work)`: `begin` / `commit` / `rollback` con `release()` garantizado;
  cuenta `acgraph_db_transactions_total{result}` y su duración.
- Pool: `max = PGPOOL_MAX` (10), `statement_timeout` 15 s por conexión,
  `idleTimeoutMillis` 30 s, `connectionTimeoutMillis` 10 s, `application_name = 'ac-graph'`.
  TLS lo decide la cadena de conexión
  (`sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem` en AWS).
- Creado en el primer uso, nunca en import: un build o un despliegue local cargan estos
  módulos sin base de datos.

## 9. Colaboración en vivo

Tres capas, de dentro hacia fuera:

1. **`EventHub`** (`collab/events.ts`): mapa `diagramId → Set<subscriber>`. Entrega dentro
   del proceso. Un suscriptor que lanza no frena al resto.
2. **`PresenceRegistry`** (`collab/presence.ts`): `diagramId → sessionKey → { user, color,
cursor, editing, lastSeen }`. En memoria, TTL **15 s**; quien deja de oírse desaparece
   al listar. Presencia = estado absoluto por sesión, no parches: un mensaje perdido lo
   corrige el siguiente latido.
3. **`Collaboration`** (`collab/collaboration.ts`): aplica todo localmente primero (hub,
   registro) y luego lo cuenta al **bus**; lo que llega del bus se aplica igual, menos el
   contar. Un `origin` (UUID) por proceso filtra el eco propio (NOTIFY devuelve al emisor).

### El stream SSE (`collab/stream.ts`)

`GET /api/diagrams/[id]/events` → `text/event-stream`, `X-Accel-Buffering: no`,
`Connection: keep-alive`. Abrir el stream **une** al espectador a la sala (y publica el
roster a todos, incluido él: así recibe su lista inicial). Cerrarlo lo saca. Cada 15 s
escribe un comentario `: ping` (mantiene vivos proxies y ALB) y refresca la presencia en
todas las réplicas. Formato de cada mensaje:

```
event: saved
data: {"type":"saved","updatedAt":"2026-…","by":{"id":"usr_…","name":"Ada"}}
```

Eventos: `saved`, `meta`, `deleted`, `presence` (con `self: true` en la fila propia;
`sessionKey` nunca sale al cable), `access`, `comment` (solo ids: la sala vuelve a pedir
el hilo, así un comentario largo nunca desborda el bus). Detalle en
[`API.md` § Server-Sent Events](API.md#server-sent-events).

### El bus entre réplicas (`collab/bus.ts`)

- Transporte: `LISTEN acgraph_collab` en una **conexión dedicada** (`pg.Client`,
  `keepAlive`, `application_name = 'ac-graph-bus'`) y `select pg_notify($1, $2)` a través
  del pool. En modo local y en tests, `MemoryBus` con el mismo contrato.
- Mensajes `{ v: 1, origin, diagramId, kind: 'event' | 'touch' | 'leave', … }` validados
  con Zod al recibir; lo que no es nuestro se descarta y se cuenta
  (`busDropped{reason="invalid"}`).
- Tope de carga **7 900 B** (`pg_notify` rechaza ≥ 8 000): un mensaje mayor se descarta y
  se cuenta (`too_large`).
- Reconexión con backoff `500 ms, 1 s, 2 s, 5 s, 10 s, 30 s` (el último se repite).
  `acgraph_collab_bus_connected` dice si esta réplica escucha.
- La conexión se abre en `startObservability()` al arrancar (modo servidor), para que el
  primer espectador ya oiga a los demás.

**Garantías (léelo antes de tocar nada aquí):** entrega _best effort_. Mientras la
conexión de escucha de una réplica está caída, se pierden las notificaciones ajenas; la
entrega local no. La presencia se cura por latidos dentro del TTL; los guardados
**siguen siendo correctos porque los decide la base de datos** (412), no el bus. No hay
cola ni reenvío, y hay un solo canal para todos los diagramas. Un pooler tipo PgBouncer
en modo _transaction_ rompe `LISTEN`: hace falta conexión directa o modo _session_ para
el cliente del bus.

**Regla:** toda publicación en vivo pasa por `collaboration().publish / touch / leave`,
**nunca** por `events().publish` directo (eso solo entrega en este proceso).

## 10. Biblioteca de iconos del workspace

- Un solo workspace ⇒ una sola biblioteca para todos los que inician sesión;
  **cualquiera** añade o quita. Quitar un icono no rompe documentos: el icono se embebe
  en el modelo al usarse (`model.customIcons`).
- Deduplicación por **hash SHA-256 del dibujo** (`svg.viewBox + body` o `image`), no del
  nombre: subir dos veces el mismo logo devuelve el existente (200) en lugar de crear
  otro (201). **El cliente debe usar siempre el icono que la respuesta devuelve.**
- Cuota: **200 iconos / 16 MiB** de JSON, comprobada dentro de la misma transacción que
  escribe, con `lock table icons in share row exclusive mode` (las subidas son raras; la
  cuenta tiene que ser exacta). Llena → `409 library_full { count, bytes }`.
- El servidor **no sanea SVG** (no tiene DOM); valida forma y tamaños
  (`CustomIconSchema.strict()` + "exactamente una imagen: `svg` o `image`"). El saneado
  lo hace el navegador antes de subir.
- `key` con formato `custom-[a-z0-9][a-z0-9-]*`; re-subir bajo una `key` existente
  reemplaza.

## 11. Comentarios

- Viven **fuera del modelo** (`comment_threads`): no entran en deshacer, no tocan
  `updatedAt`, no viajan en enlaces ni exportaciones, y **un lector puede comentar**.
- Un hilo = una fila con sus respuestas dentro (`comments jsonb`, nunca vacío); anclado a
  una forma (`shapeId` + coordenadas de entonces) o a un punto de la hoja.
- El autor lo firma **la sesión** (`{ id, name }` del actor), nunca el cuerpo de la
  petición.
- Cada mutación bloquea el hilo (`for update`), re-comprueba que el diagrama se puede leer
  y lo reescribe entero, en una transacción.
- Métrica `acgraph_comment_writes_total{operation, result}` (`ok` / `refused` / `error`).

## 12. IA (Anthropic)

- Rutas `POST /api/ai/generate` y `POST /api/ai/explain` (`src/app/api/ai/*`).
  **Disponibles en ambos modos y sin autenticación**; el único control es un
  `RateLimiter` por proceso con clave `ip:x-studio-session` (`callerKey`): generate 5 de
  ráfaga / 3 por minuto, explain 8 / 6.
- Sin `ANTHROPIC_API_KEY` responden `503 not_configured` (el producto degrada a "IA no
  disponible", no a roto). La clave **solo existe en el servidor**.
- Modelo `AI_MODEL` (`src/lib/ai/client.ts`); salida estructurada con
  `zodOutputFormat(AiDiagramSchema)` que luego se compila con el DSL (`aiToDsl` →
  `compile`). `explain` devuelve texto plano en streaming.
- Errores del SDK se traducen en `describeError` (`src/lib/ai/errors.ts`): `bad_key` 500,
  `no_permission` 500, `upstream_rate_limit` 429, `unreachable` 503, `api_error` 502/400;
  y propios `refused` 422, `unparseable` 502, `empty_diagram` 400.
- Estas rutas responden con `NextResponse.json` propio, así que **no llevan `code` en la
  línea de acceso** (límite conocido).

## 13. Embed

`GET /api/embed?d=<payload>[&theme=dark]` devuelve el SVG del diagrama, renderizado con
el mismo motor del lienzo. El payload es el modelo comprimido (deflate-raw + base64url,
`src/lib/share/codec.ts`; máx. 6 000 caracteres al generar el enlace). Como el diagrama
va en la URL, la respuesta es `public, max-age=31536000, immutable`, lleva CSP
`default-src 'none'; style-src 'unsafe-inline'` y `X-Content-Type-Options: nosniff`.
400 en texto plano si falta o no decodifica.

## 14. Observabilidad

Detalle operativo (Docker, Loki, Grafana):
[`DOCKER.md` § "Logs, metrics and traces"](DOCKER.md#logs-metrics-and-traces).

### Logs (`observability/log.ts`)

- Un objeto JSON por línea a stdout (`LOG_FORMAT=json`, por defecto en producción) o
  `pretty` para terminal. Niveles `debug | info | warn | error | silent` (`LOG_LEVEL`,
  por defecto `info`).
- Registro: `time, level, msg` + bindings del logger (`requestId, method, route,
diagramId, versionId, userId, sessionKey, code`) + `traceId / spanId` si hay tracer +
  campos de la llamada.
- **Redacción**: cualquier clave que case `/cookie|authorization|password|secret|token|api[_-]?key/i`,
  a cualquier profundidad, sale como `[redacted]`. Errores → `{ name, message, code }`; el
  stack solo en `error` o con logger `debug`. Profundidad máxima 5, ciclos cortados.
- **Nunca** se registra query string, cuerpo ni cabeceras de la petición. `path` es la
  ruta concreta sin query; `route` la plantilla.
- Una **línea de acceso** por petición (`msg: "http request"`, con `status`,
  `durationMs`) a nivel `info`; `error` si ≥ 500; `debug` para `health` y `metrics`
  (`quiet`).
- Usa `log()` (devuelve el logger de la petición en curso o el del proceso). **Nunca
  `console.*`** en `src/server`.

### Métricas (`observability/metrics.ts`, `GET /api/metrics`)

Formato de exposición Prometheus 0.0.4. Etiquetas siempre de conjuntos cerrados
(plantilla de ruta, método, status, resultado) — **nunca ids** (hay una prueba que lo
verifica). Tope 500 series por métrica; lo que sobra se cuenta en
`acgraph_metrics_series_dropped_total`.

| Métrica                                                                     | Tipo                | Etiquetas                                                                    | Qué mide                                                                                  |
| --------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `acgraph_http_requests_total`                                               | counter             | route, method, status                                                        | Peticiones API (sin health / metrics)                                                     |
| `acgraph_http_request_duration_seconds`                                     | histogram           | route, method                                                                | Latencia hasta cabeceras (buckets 1 ms–10 s)                                              |
| `acgraph_http_requests_in_flight`                                           | gauge               |                                                                              | En curso                                                                                  |
| `acgraph_http_conflicts_total`                                              | counter             | route                                                                        | 412 por revisión obsoleta                                                                 |
| `acgraph_diagram_saves_total`                                               | counter             | operation (save / restore), result (ok / conflict / error)                   | Escrituras del repositorio                                                                |
| `acgraph_icon_writes_total`                                                 | counter             | operation (save / remove), result (ok / deduplicated / full / error)         | Biblioteca de iconos                                                                      |
| `acgraph_comment_writes_total`                                              | counter             | operation (create / reply / resolve / delete), result (ok / refused / error) | Comentarios                                                                               |
| `acgraph_sessions_created_total` / `acgraph_sessions_ended_total`           | counter             |                                                                              | Logins con cookie / logouts explícitos                                                    |
| `acgraph_logins_total`                                                      | counter             | result (ok / rejected / rate_limited / error)                                | Intentos de entrada                                                                       |
| `acgraph_sse_connections` / `acgraph_sse_connections_total`                 | gauge / counter     |                                                                              | Streams abiertos / abiertos desde el arranque                                             |
| `acgraph_sse_events_published_total`                                        | counter             | type                                                                         | Eventos entregados al hub                                                                 |
| `acgraph_db_transactions_total` / `acgraph_db_transaction_duration_seconds` | counter / histogram | result                                                                       | Transacciones                                                                             |
| `acgraph_db_pool_clients`                                                   | gauge               | state (total / idle / waiting)                                               | Pool `pg` (ausente hasta que exista)                                                      |
| `acgraph_unhandled_errors_total`                                            | counter             | source                                                                       | Errores que Next atrapó fuera de nuestras rutas                                           |
| `acgraph_collab_bus_messages_total`                                         | counter             | direction (sent / received / echo), kind                                     | Tráfico del bus                                                                           |
| `acgraph_collab_bus_dropped_total`                                          | counter             | reason (too_large / publish_failed / invalid)                                | Mensajes no entregados                                                                    |
| `acgraph_collab_bus_connected`                                              | gauge               |                                                                              | 1 si esta réplica escucha                                                                 |
| `acgraph_collab_bus_reconnects_total`                                       | counter             |                                                                              | Reconexiones del LISTEN                                                                   |
| `acgraph_build_info`                                                        | gauge               | stamp, node                                                                  | Build en ejecución                                                                        |
| `process_*`, `nodejs_*`                                                     |                     |                                                                              | Gauges de proceso con los nombres de `prom-client` (los dashboards Node existentes valen) |

Las métricas son **por proceso**: Prometheus agrega por `instance`. Con `METRICS_TOKEN`
el endpoint exige `Authorization: Bearer <token>` (comparación en tiempo constante).

### Trazas (`observability/tracing.ts`)

Solo si `OTEL_EXPORTER_OTLP_ENDPOINT` está: se carga el SDK dinámicamente
(`serverExternalPackages` en `next.config.ts`), se registra un `NodeTracerProvider` con
`BatchSpanProcessor` + exportador OTLP/HTTP, y Next (ya instrumentado) emite un span por
petición, por route handler y por `fetch` saliente. `OTEL_SERVICE_NAME` (por defecto
`ac-graph`), `service.version = NEXT_PUBLIC_BUILD_STAMP`. Los logs llevan
`traceId / spanId`. Se apaga con `SIGTERM` / `SIGINT`.

### Id de petición

`x-request-id` de entrada se respeta si casa `^[A-Za-z0-9._-]{8,128}$`; si no, UUID
nuevo. Siempre vuelve en la respuesta. Un 500 lo incluye en el cuerpo (`requestId`) para
que la persona lo cite y el operador lo encuentre en el log.

## 15. Configuración

Todo se lee de `process.env` **en cada llamada**, nunca en import (así los tests lo
stubbean y el servidor se configura al arrancar). Plantilla comentada:
[`.env.example`](../.env.example).

### Modo servidor (`readServerEnv`)

| Variable             | Obligatoria                  | Por defecto | Efecto                                                                                                                                                                              |
| -------------------- | ---------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | Sí, junto con `APP_URL`      | —           | Cadena `postgres://…`. TLS según sus parámetros (`sslmode`, `sslrootcert`). Con Compose se deriva de `POSTGRES_PASSWORD`.                                                           |
| `APP_URL`            | Sí, junto con `DATABASE_URL` | —           | Origen exacto del navegador. Decide `Secure` de la cookie, el check CSRF y el `redirect_uri` OIDC. Se normaliza (sin barra final ni query). Si no es http(s) absoluta → modo local. |
| `OIDC_ISSUER`        | Con `OIDC_CLIENT_ID`         | —           | Issuer del proveedor, con la barra final tal como él lo muestra. Uno solo de los dos → **modo local**.                                                                              |
| `OIDC_CLIENT_ID`     | Con `OIDC_ISSUER`            | —           |                                                                                                                                                                                     |
| `OIDC_CLIENT_SECRET` | No                           | —           | Cliente confidencial; vacío = público (solo PKCE).                                                                                                                                  |
| `AUTH_SIGNUP`        | No                           | `open`      | `closed` deja las altas a `npm run users`. Ignorado con OIDC.                                                                                                                       |
| `SESSION_TTL_HOURS`  | No                           | `12`        | Vida fija de la sesión (cookie y fila).                                                                                                                                             |
| `PGPOOL_MAX`         | No                           | `10`        | Tamaño del pool por proceso. Con N réplicas: N·PGPOOL_MAX + N (bus) conexiones a Postgres.                                                                                          |

### Observabilidad (ambos modos, `readObservabilityEnv`)

| Variable                      | Por defecto                          | Efecto                                                                                                                    |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `LOG_LEVEL`                   | `info`                               | `debug                                                                                                                    | info | warn | error | silent` |
| `LOG_FORMAT`                  | `json` en producción, `pretty` si no |                                                                                                                           |
| `METRICS_TOKEN`               | vacío                                | Si está, `/api/metrics` exige Bearer                                                                                      |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | vacío                                | Activa trazas. `OTEL_EXPORTER_OTLP_HEADERS` y `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` funcionan como dicta la especificación |
| `OTEL_SERVICE_NAME`           | `ac-graph`                           |                                                                                                                           |

### Otras

| Variable                                         | Efecto                                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                              | Activa `/api/ai/*`. Vacía = `503 not_configured`. Puede generar cargos.                                                      |
| `PORT`, `HOSTNAME`                               | Del servidor standalone de Next (`3000`, `0.0.0.0` en la imagen).                                                            |
| `NEXT_PUBLIC_BUILD_STAMP`                        | Lo fija `next.config.ts` en el build (ISO de la compilación). Sale en `acgraph_build_info`, en `service.version` y en la UI. |
| `TEST_DATABASE_URL`                              | Solo tests: activa `*.pg.test.ts`.                                                                                           |
| `APP_PORT`, `POSTGRES_PORT`, `POSTGRES_PASSWORD` | Solo Compose.                                                                                                                |

## 16. Arranque y ciclo de vida del proceso

1. Next arranca y llama a `register()` de `src/instrumentation.ts` (solo runtime
   `nodejs`) → `startObservability()`:
   - logger raíz configurado; métricas creadas con valores cero (un primer scrape ve
     todas las series);
   - en modo servidor, `collaboration()` abre el `LISTEN` en segundo plano (reintenta
     solo);
   - trazas si hay colector; `SIGTERM` / `SIGINT` las apagan;
   - una línea `server started` con `mode`, `node`, `build`, `logLevel`, `tracing`,
     `metricsProtected`.
2. **El pool y el esquema no se tocan hasta la primera petición autenticada**
   (`withUser` / `withServerMode` → `ensureSchema()`). Un contenedor en modo servidor
   arranca sano aunque la BD tarde; el primer login la migra.
3. Singletons por proceso en `globalThis.__acGraphServer__` (`src/server/globals.ts`):
   `pgPool`, `schemaReady`, `clock`, `events`, `presence`, `collaboration`, `metrics`,
   `appMetrics`, `logger`, `oidcConfig`, `loginLimiter`, `signupLimiter`,
   `passwordDecoy`. Motivo: Next compila cada ruta en su propio bundle y el dev server
   recarga módulos; un `const` de módulo daría una copia por ruta.
4. Errores que Next atrapa fuera de nuestras rutas (render de página, etc.) →
   `onRequestError` → `reportRequestError()` → log `unhandled request error` +
   `acgraph_unhandled_errors_total{source}`.
5. Parada: `stop_grace_period: 30s` en Compose (en ECS, el `stopTimeout` de la task
   definition). Los SSE abiertos se cierran con el proceso; el cliente reconecta y vuelve
   a unirse a la sala. No hay drenado explícito de conexiones (§22).

## 17. Desarrollo local y pruebas

```bash
# Modo local (sin BD): portada directamente, sin login
npm run dev                                   # http://localhost:3000

# Modo servidor contra un Postgres desechable
docker run -d --rm --name acgraph-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=acgraph_test \
  -p 127.0.0.1:55433:5432 postgres:17.11-bookworm
DATABASE_URL=postgres://postgres:test@127.0.0.1:55433/acgraph_test APP_URL=http://localhost:3000 npm run dev
# (o en .env.local: Next lo lee; el esquema se migra en el primer acceso autenticado)

# Con Compose (imagen de producción), ver DOCKER.md
docker compose -f compose.yaml -f compose.server.yaml -p acgraph-foundation up -d --build --wait
```

### Pruebas

| Comando                                                                            | Qué cubre                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                         | Unitarias (`src/**/*.test.ts`, `bin/**`), Vitest, entorno node, `LOG_LEVEL=silent`. Las `*.pg.test.ts` **se saltan** sin `TEST_DATABASE_URL`.                                                                                                                                                                                                                         |
| `TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55433/acgraph_test npm test` | Añade las de integración con Postgres: `api.pg.test.ts` (rutas de punta a punta), `schema.pg.test.ts`, `diagrams/repository.pg.test.ts`, `auth/password.pg.test.ts`, `collab/bus.pg.test.ts`, `icons/repository.pg.test.ts`. Cada archivo trabaja en su propio **schema** de Postgres (`search_path`) y lo recrea desde cero (`freshSchema`), así corren en paralelo. |
| `npm run typecheck`                                                                | `next typegen` (genera `RouteContext<…>`) + `tsc --noEmit`.                                                                                                                                                                                                                                                                                                           |
| `npm run lint`, `npm run format:check`                                             | ESLint 9, Prettier.                                                                                                                                                                                                                                                                                                                                                   |
| `npm run test:e2e:critical`                                                        | Playwright, flujos críticos (modo local).                                                                                                                                                                                                                                                                                                                             |
| `npm run audit:roles -- http://127.0.0.1:3101`                                     | Login, roles, iconos compartidos y comentarios en vivo con tres navegadores contra un servidor en modo servidor (`AUDIT_DATABASE_URL` para sembrar y limpiar usuarios). Receta exacta en [`CONTEXTO.md` §3](CONTEXTO.md).                                                                                                                                             |

Cómo se prueban las rutas: `src/server/api.pg.test.ts` monta las funciones `GET / POST /
…` de cada `route.ts` directamente con `Request` reales y `process.env` stubbeado
(`testEnv(schema, 'local' | 'oidc')`), sesiones sembradas en la tabla, y comprueba
códigos, cuerpos, cookies y métricas. Para capturar logs en una prueba: `captureLogs()`
(`src/server/testing/logs.ts`). Para limpiar singletons entre archivos:
`resetServerSingletons()`.

### CI (`.github/workflows/ci.yml`)

`typecheck → format:check → test → lint → build → e2e críticos → audit:controls`, y un
job `docker-smoke` que construye la imagen y comprueba usuario no root, `/api/health`,
HTML y estáticos. **CI no levanta Postgres**: las `*.pg.test.ts` se corren en local antes
de mergear cambios del servidor.

## 18. Despliegue y migraciones

- **Imagen**: `Dockerfile` multi-stage (deps → build → runner `node:24.20-bookworm-slim`),
  usuario `node`, `HEALTHCHECK` contra `/api/health`, bundle CA de RDS en
  `/app/certs/rds-global-bundle.pem`. Un solo puerto (3000).
- **Compose**: `compose.yaml` (modo local; Postgres bajo perfil `postgres`) +
  `compose.server.yaml` (overlay que exige `POSTGRES_PASSWORD` y `APP_URL`, deriva
  `DATABASE_URL` hacia el servicio interno `postgres:5432` y quita el perfil). Operación
  completa en [`DOCKER.md`](DOCKER.md).
- **AWS**: ECS Fargate + ALB (`idle_timeout` 3600 por los SSE) + RDS PostgreSQL 17
  (`verify-full`) + Secrets Manager + ECR + rol OIDC para GitHub Actions;
  `deploy-aws.yml` construye, empuja y rueda el servicio en cada push a `main`. Runbook
  en [`AWS.md`](AWS.md); guía en español en [`GUIA_RAPIDA_AWS.md`](GUIA_RAPIDA_AWS.md).
  **No se ha aplicado desde esta máquina** (sin credenciales, a propósito).
- **Migraciones**: automáticas, en el primer acceso autenticado de cada proceso, bajo
  `pg_advisory_xact_lock(7364281045)` para que N réplicas arrancando a la vez solo migren
  una vez. Una migración que falla revierte todo el lote y el memo se olvida, así la
  siguiente petición reintenta. **Solo hay migraciones hacia adelante** (no hay `down`):
  para revertir, restaurar backup. Cómo añadir una:
  [`DATABASE.md` § Migraciones](DATABASE.md#3-migraciones).
- **Réplicas**: el diseño soporta N procesos tras un balanceador sin afinidad de sesión
  (sesiones en BD, bus entre réplicas). Lo que **no** se comparte: rate limiters,
  presencia (se fusiona vía bus) y métricas (por `instance`).

## 19. Runbook de operación

### Primer arranque en modo servidor

1. Variables: `DATABASE_URL`, `APP_URL` (exacto), opcionalmente OIDC. Arrancar.
2. Comprobar: `curl -s $APP_URL/api/config` →
   `{"mode":"server","auth":{"provider":"local","signup":true,…}}`. Si dice `local`,
   falta una variable o `APP_URL` no es http(s) absoluta.
3. Forzar la migración sin abrir el navegador:
   `curl -s -H 'Cookie: acg_session=x' $APP_URL/api/auth/me` (devuelve 401, pero antes
   migra). Ver en el log que no hay `unhandled error`.
4. Primera cuenta: desde la página ("Créala") o
   `DATABASE_URL=… npm run users -- create ada@example.com "Ada"`.
5. Cerrar altas cuando toque: `AUTH_SIGNUP=closed` y reiniciar.

### Cuentas (`scripts/users.mjs`, necesita `DATABASE_URL`)

```bash
npm run users -- list                      # todas, con cómo entran (password / provider …)
npm run users -- create <email> "<Nombre>" # pide la contraseña sin eco (o PASSWORD=… en el entorno)
npm run users -- passwd <email>            # nueva contraseña; las sesiones abiertas siguen
npm run users -- delete <email>            # rehúsa si la persona es propietaria de algún diagrama
```

No hay "cerrar todas las sesiones de X" desde CLI:
`delete from sessions where user_id = '<usr_…>'` (ver
[`DATABASE.md` § Consultas](DATABASE.md#8-consultas-de-operación)).

### Síntoma → causa probable → dónde mirar

| Síntoma                                                     | Causa probable                                                                   | Comprobar                                                                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `/api/config` dice `mode: local` en producción              | Falta `DATABASE_URL` o `APP_URL`, o solo uno de `OIDC_ISSUER` / `OIDC_CLIENT_ID` | Variables del contenedor; `readServerEnv`                                                                           |
| Todos los GET funcionan, todo POST / PUT da `403 forbidden` | `APP_URL` no coincide con el origen real (puerto, esquema, `www`)                | Cabecera `Origin` del navegador vs `APP_URL`                                                                        |
| Login OK pero la cookie no se guarda                        | `APP_URL` es `https://` pero se accede por `http://` (cookie `Secure`)           | `Set-Cookie` en la respuesta de login                                                                               |
| `401` a las 12 h exactas                                    | TTL fijo de sesión, por diseño                                                   | `SESSION_TTL_HOURS`                                                                                                 |
| `500 internal` con `requestId`                              | Error no tipado                                                                  | `grep '<requestId>'` en el log: línea `unhandled error` con stack                                                   |
| Colaboradores no se ven entre sí, pero cada uno guarda bien | Bus caído en una réplica                                                         | `acgraph_collab_bus_connected == 0`; log `bus disconnected` / `bus could not connect`; ¿pooler en modo transaction? |
| Presencia "fantasma" durante 15 s                           | TTL de presencia                                                                 | Normal                                                                                                              |
| `412 conflict` frecuentes                                   | Dos editores sobre el mismo diagrama                                             | `acgraph_http_conflicts_total`; es funcionamiento normal                                                            |
| `429 rate_limited` en login                                 | 10 intentos por IP o por correo                                                  | Esperar `Retry-After`; los cubos son por proceso (un reinicio los limpia)                                           |
| `409 library_full`                                          | 200 iconos o 16 MiB                                                              | Borrar iconos desde la UI o `delete from icons …`                                                                   |
| `413 payload_too_large`                                     | Cuerpo > 5 MiB                                                                   | `MAX_BODY_BYTES`                                                                                                    |
| Login OIDC vuelve con `?auth_error=provider`                | Discovery falló (issuer mal, red, TLS)                                           | Log `could not start login`                                                                                         |
| Login OIDC vuelve con `?auth_error=callback`                | State caducado o no coincide, token rechazado, `redirect_uri` no registrado      | Log `login callback failed`; el `redirect_uri` exacto debe estar en el proveedor                                    |
| Migración falla al arrancar                                 | Permisos de la BD, esquema tocado a mano                                         | Log del primer request; `select * from schema_migrations`                                                           |
| `statement timeout`                                         | Query > 15 s (import enorme)                                                     | `STATEMENT_TIMEOUT_MS`; tamaño del import                                                                           |
| Sin métricas de pool                                        | Nadie ha hecho aún una petición autenticada                                      | Normal hasta el primer login                                                                                        |
| Página vieja tras desplegar                                 | Caché del navegador                                                              | Sello de build en el pie; `Cmd+Shift+R`. Los HTML salen `no-cache, must-revalidate`                                 |

### Backups

La BD es el único estado. `pg_dump` / snapshots de RDS:
[`DOCKER.md` § PostgreSQL](DOCKER.md#postgresql), [`AWS.md` § Operating it](AWS.md#operating-it).
Restaurar un backup de un esquema anterior es seguro: las migraciones que falten se
aplican en el primer acceso.

## 20. Seguridad: resumen de controles

| Área                     | Control                                                                                                                         | Dónde                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Sesiones                 | Id opaco 256 bits, solo hash en BD, `HttpOnly`, `SameSite=Lax`, `Secure` con https, TTL fijo                                    | `auth/session.ts`            |
| CSRF                     | Cabecera propia + comprobación `Origin` / `Referer` contra `APP_URL` en toda mutación                                           | `assertSameOrigin`           |
| Login CSRF / replay OIDC | `state` en cookie **y** en BD, consumido una vez, TTL 10 min; PKCE S256; `nonce`; firma del ID token verificada                 | `auth/oidc.ts`               |
| Open redirect            | `next` solo rutas relativas del mismo sitio                                                                                     | `safeNextPath`               |
| Contraseñas              | scrypt (OWASP), sal por usuario, comparación en tiempo constante, señuelo para correos inexistentes, sin enumeración de cuentas | `auth/password.ts`           |
| Fuerza bruta             | Token bucket por IP y por correo (login), por IP (alta)                                                                         | `takeAttempt`                |
| Autorización             | En el repositorio, dentro de la transacción que bloquea la fila                                                                 | `PgDiagramRepository`        |
| Inyección SQL            | Solo consultas parametrizadas                                                                                                   | todo `src/server`            |
| Validación de entrada    | Zod en todo cuerpo; `.strict()` donde el cuerpo es un patch; `Content-Length` y flujo contados (5 MiB)                          | `schemas.ts`, `readJsonBody` |
| Fugas en logs            | Redacción por nombre de clave; nunca query / cuerpo / cabeceras; nunca el correo de un login fallido                            | `log.ts`, rutas de auth      |
| Errores                  | Mensajes genéricos al cliente; detalle y stack solo en el log                                                                   | `errorResponse`              |
| Métricas                 | Sin ids como etiquetas; tope de cardinalidad; Bearer opcional                                                                   | `metrics.ts`                 |
| Embed                    | CSP restrictiva, `nosniff`, sin scripts                                                                                         | `api/embed`                  |
| Contenedor               | Usuario `node`, `cap_drop: ALL`, `no-new-privileges`, puerto solo en loopback en Compose                                        | `Dockerfile`, `compose.yaml` |
| BD en AWS                | `sslmode=verify-full` con bundle CA en la imagen; secretos en Secrets Manager                                                   | `Dockerfile`, Terraform      |
| IA                       | Clave solo en el servidor; rate limit por visitante; cuerpo validado                                                            | `api/ai/*`                   |

Lo que **no** hay (decisiones de alcance, §22): 2FA, bloqueo de cuenta, rotación de
sesión, rate limit compartido entre réplicas, cabeceras de seguridad globales (CSP del
sitio) más allá de las del embed.

## 21. Cómo extender

### Añadir un endpoint en modo servidor

1. Crear `src/app/api/<ruta>/route.ts` con `export const dynamic = 'force-dynamic'` y
   `const ROUTE = '/api/<ruta>/[param]'` (la **plantilla**, nunca el path concreto: es la
   etiqueta de métricas y logs).
2. Envolver con
   `withUser(request, { route: ROUTE, mutating: <true si escribe> }, async ({ user, repository, icons, sessionKey }) => …)`.
3. Cuerpo: definir el schema Zod en `src/server/diagrams/schemas.ts` (o el módulo que
   toque) y leerlo con `parseBody(request, Schema)`. Patches → `.strict()`.
4. Lógica en el repositorio, no en la ruta; la autorización va dentro
   (`this.access(id, role)` o `this.change(id, role, …)`).
5. Errores nuevos: clase en `errors.ts` + rama en `errorResponse()` + (si hace falta)
   nuevo `ErrorCode`. Documentarlo en [`API.md`](API.md).
6. Si cambia algo que otros deben ver en vivo: `collaboration().publish(id, evento)` y,
   si es un tipo nuevo, añadirlo a `DiagramEvent` (`events.ts`) **y** a `RoomEventSchema`
   (`bus.ts`).
7. Añadir el método al `HttpDiagramRepository` del cliente (y a `LocalDiagramRepository`
   si aplica al modo local).
8. Prueba en `src/server/api.pg.test.ts`. Correr `npm run typecheck` (regenera
   `RouteContext`).

### Añadir una migración

Ver [`DATABASE.md` § Migraciones](DATABASE.md#3-migraciones). Resumen: nuevo objeto al
final de `MIGRATIONS` con el `id` siguiente, SQL idempotente (`if not exists`,
`add column if not exists`), nunca editar una migración ya publicada, actualizar
`dropSchema` en `testing/pg.ts` si hay tabla nueva, y `schema.pg.test.ts`.

### Añadir una métrica

Declararla en `declareAppMetrics()` (`metrics.ts`) con nombre `acgraph_*` y etiquetas de
conjunto cerrado; inicializar a cero en `defineAppMetrics()` si es un gauge / counter sin
etiquetas; usarla vía `appMetrics().x`. Documentarla en §14 y en `DOCKER.md`.

### Añadir una variable de entorno

Leerla en `env.ts` (nunca `process.env` suelto en otro módulo), con valor por defecto y
validación; añadirla a `.env.example`, a `compose*.yaml`, a la task definition de
Terraform si aplica, y a la tabla de §15.

## 22. Límites conocidos y deuda técnica

Alcance decidido, no bugs (ampliado desde [`CONTEXTO.md` §6](CONTEXTO.md)):

- **Estado por proceso**: rate limiters (login, alta, IA), presencia (fusionada vía bus,
  pero perdida al reiniciar) y métricas. Con varias réplicas el límite de intentos
  efectivo se multiplica por N.
- **Bus best effort**: sin cola ni reenvío; un solo canal para todos los diagramas;
  `LISTEN` exige conexión directa (no pooler en modo transaction).
- **Sin CRDT**: colaboración = presencia + adopción de guardados ajenos + 412 con banner.
  Dos editores simultáneos sobre el mismo diagrama pisan revisiones, no se fusionan.
- **Un solo workspace**: sin equipos, sin roles de workspace, sin transferencia de
  propiedad; invitar exige que la persona haya iniciado sesión antes. La biblioteca de
  iconos no tiene roles y no va en la exportación.
- **Sesiones**: TTL fijo sin renovación; sin "cerrar todas mis sesiones"; sin 2FA.
- **Migraciones**: solo hacia adelante; sin herramienta de estado más allá de
  `schema_migrations`.
- **Sin OpenAPI**: el contrato está en Zod (`schemas.ts`, `project.ts`) y en
  [`API.md`](API.md). Zod 4 permite generar JSON Schema (`z.toJSONSchema`) si algún día
  hace falta un spec formal.
- **IA sin autenticación**: en modo servidor `/api/ai/*` sigue abierto a cualquier
  visitante de la página, limitado solo por proceso. Si el despliegue es público, poner la
  IA detrás de `withUser` es un cambio pequeño por ruta.
- **Parada**: sin drenado explícito de SSE ni del pool en `SIGTERM` (se apoya en el grace
  period y en la reconexión del cliente).
- **Miniaturas**: `renderThumbnail` en tema claro, solo como relleno; la portada dibuja la
  vista real por revisión.
- **CI sin Postgres**: las `*.pg.test.ts` son responsabilidad de quien cambia el servidor.

## 23. Glosario

| Término                         | Significado aquí                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Modo local / modo servidor**  | Sin / con `DATABASE_URL` + `APP_URL`. Ver §2                                                                         |
| **Cara del login** (`provider`) | `local` (contraseña) u `oidc`. Cada ruta de auth pertenece a una                                                     |
| **Actor**                       | El usuario de la sesión, al que se liga el repositorio de la petición                                                |
| **Revisión**                    | El `updatedAt` de un diagrama; lo que viaja en `If-Match`                                                            |
| **Snapshot / versión**          | Copia completa del modelo en `diagram_versions`                                                                      |
| **Sala** (room)                 | El conjunto de streams SSE abiertos sobre un diagrama en un proceso                                                  |
| **Roster**                      | La lista de presencia de una sala                                                                                    |
| **sessionKey**                  | Hash corto de la cookie de sesión; distingue pestañas de una misma persona                                           |
| **Bus**                         | Transporte entre réplicas (`LISTEN / NOTIFY`)                                                                        |
| **Eco**                         | Un mensaje del bus que vuelve a quien lo envió; se filtra por `origin`                                               |
| **Plantilla de ruta**           | `/api/diagrams/[id]`: la etiqueta de métricas y logs, nunca el path con ids                                          |
| **Workspace**                   | Todo lo que ve un usuario en modo servidor: sus diagramas y los que le compartieron; también su exportación completa |
| **Guarda** (guard)              | `withUser` / `withServerMode`                                                                                        |
