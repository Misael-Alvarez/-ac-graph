# API HTTP de AC Graph — referencia

> Contrato completo de las 26 rutas de `src/app/api/**`. La arquitectura, las guardas y
> las decisiones de diseño están en [`BACKEND.md`](BACKEND.md); el esquema de datos en
> [`DATABASE.md`](DATABASE.md). Los cuerpos se validan con los schemas Zod de
> `src/server/diagrams/schemas.ts`, `src/server/icons/schemas.ts`,
> `src/server/auth/password.ts` y `src/lib/domain/project.ts`: **ante la duda, esos
> archivos mandan**.

## Convenciones

- **Base URL**: el mismo origen que la aplicación (`APP_URL`). No hay prefijo de versión.
  Todas las rutas empiezan por `/api/`.
- **Modos**. Las rutas marcadas _servidor_ existen solo en modo servidor; en modo local
  responden `404 { code: 'server_mode_off' }`. Las marcadas _ambos_ existen siempre.
- **Autenticación**: cookie `acg_session` (`HttpOnly`, `SameSite=Lax`, `Secure` con
  https), emitida por `POST /api/auth/login`, `POST /api/auth/register` o el callback
  OIDC. Se envía sola en peticiones same-origin (`credentials: 'same-origin'`). Sin ella o
  expirada: `401 unauthenticated`. No hay tokens Bearer para la API (solo para
  `/api/metrics`).
- **Mutaciones** (POST, PUT, PATCH, DELETE en rutas de servidor) exigen **dos**
  cabeceras, o `403 forbidden`:
  - `x-requested-with: ac-graph`
  - `Origin` (o `Referer`) con el mismo origen que `APP_URL`.
- **Cuerpos**: JSON con `Content-Type: application/json`. Tope **5 MiB**
  (`413 payload_too_large`). JSON malformado o cuerpo ausente donde se espera →
  `400 bad_request`. Los schemas marcados _strict_ rechazan claves desconocidas.
- **Revisión**: `If-Match: <updatedAt>` en `PUT /api/diagrams/[id]` y en `restore`. Se
  acepta el valor a pelo, entrecomillado (`"…"`) o con prefijo `W/`; `*` o vacío
  equivale a no enviarla. Gana sobre `options.expectedUpdatedAt` del cuerpo.
- **Id de petición**: `x-request-id` de entrada se respeta si casa
  `^[A-Za-z0-9._-]{8,128}$`; siempre vuelve en la respuesta.
- **Caché**: toda respuesta de la API lleva `Cache-Control: no-store`, salvo
  `/api/embed` (inmutable por URL).
- **Códigos de éxito**: `200` con JSON; `201` al crear; `204` sin cuerpo; `302` en los
  redirects de login OIDC.
- **Ids**: `<prefijo>_<nanoid de 10>`: `usr_`, `dgm_` (diagrama), `ver_` (versión),
  `thr_` (hilo), `cmt_` (comentario). Opacos: no derivar nada de ellos.
- **Fechas**: cadenas ISO-8601 (`2026-09-16T10:20:30.123Z`). El `updatedAt` de un
  diagrama es su revisión y se compara por **igualdad exacta de cadena**.
- **Orden de comprobación** en una ruta de servidor: modo → CSRF → cookie presente →
  migraciones → sesión válida → parámetros de ruta → cuerpo → autorización (en el
  repositorio) → lógica. Por eso un cuerpo inválido sobre un diagrama ajeno devuelve
  `400`, no `403`.

## Errores

Forma única, siempre JSON:

```json
{
  "code": "no_access",
  "message": "You do not have access to this diagram.",
  "required": "editor",
  "owner": { "name": "Ada" }
}
```

`code` es estable y es lo que debe leer un cliente; `message` es texto para personas y
puede cambiar. Los campos adicionales dependen del código.

| `code`                | HTTP | Cuándo                                                                                                                                             | Campos extra                                                      |
| --------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `server_mode_off`     | 404  | Ruta de modo servidor en un despliegue local                                                                                                       |                                                                   |
| `unauthenticated`     | 401  | Sin cookie, sesión inexistente o expirada. También `/api/metrics` sin Bearer válido cuando hay `METRICS_TOKEN`                                     |                                                                   |
| `invalid_credentials` | 401  | `POST /api/auth/login`: correo o contraseña incorrectos (nunca se dice cuál; una cuenta OIDC sin contraseña falla igual)                           |                                                                   |
| `signup_closed`       | 403  | `POST /api/auth/register` con `AUTH_SIGNUP=closed`                                                                                                 |                                                                   |
| `email_taken`         | 409  | `POST /api/auth/register`: ya hay cuenta local con ese correo                                                                                      |                                                                   |
| `rate_limited`        | 429  | Demasiados intentos de login (por IP o por correo) o de alta (por IP). Cabecera `Retry-After`                                                      | `retryAfter` (segundos)                                           |
| `forbidden`           | 403  | Falla la comprobación same-origin (falta `x-requested-with` u `Origin` distinto); borrar un hilo del que no eres autor ni propietario del diagrama |                                                                   |
| `no_access`           | 403  | El diagrama existe pero no eres miembro, o tu rol no alcanza                                                                                       | `required` (`viewer`/`editor`/`owner`), `owner.name` si se conoce |
| `not_found`           | 404  | Diagrama, versión, hilo o icono inexistente; ruta de auth de la otra cara del login (`provider`)                                                   |                                                                   |
| `user_not_found`      | 404  | `PUT …/members`: ese correo no pertenece a nadie que haya iniciado sesión                                                                          |                                                                   |
| `conflict`            | 412  | `PUT /api/diagrams/[id]` o `restore`: `If-Match` distinto del `updatedAt` actual                                                                   | `current` (el `DiagramRecord` actual)                             |
| `bad_request`         | 400  | Cuerpo que no pasa el schema, JSON malformado, sin cuerpo; tocar la fila del propietario en miembros; `state` OIDC que no coincide                 | `issues: [{ path, message }]` si es Zod                           |
| `payload_too_large`   | 413  | Cuerpo mayor de 5 MiB (por `Content-Length` o contando el flujo)                                                                                   |                                                                   |
| `library_full`        | 409  | `POST /api/icons`: la biblioteca tiene 200 iconos o 16 MiB                                                                                         | `count`, `bytes`                                                  |
| `internal`            | 500  | Error no previsto. El detalle y el stack quedan en el log del servidor, nunca en la respuesta                                                      | `requestId`                                                       |

Las rutas de IA (`/api/ai/*`) responden con su propio conjunto de códigos, misma forma
`{ code, message }`: ver [IA](#ia).

## Tipos

Notación TypeScript; los schemas reales están en `src/lib/domain/project.ts` y
`src/lib/domain/diagram.ts`. Los campos con `?` pueden faltar; `| null` viene siempre,
posiblemente nulo.

```ts
type Role = 'owner' | 'editor' | 'viewer';

interface User {
  id: string; // usr_…
  name: string;
  email?: string;
  avatarUrl?: string; // 'picture' del proveedor OIDC
}

interface DiagramMeta {
  id: string; // dgm_…
  ownerId: string;
  title: string;
  description: string; // '' por defecto
  folder: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO — la revisión
  thumbnail: string | null; // SVG inline dibujado por el servidor
  template: boolean; // plantilla propia, no diagrama
  role?: Role; // el rol de QUIEN PREGUNTA; siempre presente en modo servidor
}

interface DiagramRecord extends DiagramMeta {
  model: DiagramModel; // el documento: { schemaVersion, canvas: { w, h }, shapes, connectors,
  //   showFooter, views, rules?, customIcons? } — src/lib/domain/diagram.ts
}

interface DiagramVersion {
  id: string; // ver_…
  diagramId: string;
  createdAt: string;
  label: string | null; // p. ej. 'before restore'
  model: DiagramModel;
}

interface DiagramMember {
  user: User;
  role: Role;
  addedAt: string;
}

interface CommentAnchor {
  shapeId: string | null; // forma a la que apunta, o null para un punto de la hoja
  x: number;
  y: number; // coordenadas de lienzo
}

interface Comment {
  id: string; // cmt_…
  author: { id: string; name: string }; // firmado por la sesión, nunca por el cliente
  body: string; // 1..4000
  createdAt: string;
}

interface CommentThread {
  id: string; // thr_…
  diagramId: string;
  anchor: CommentAnchor;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: { id: string; name: string } | null;
  comments: Comment[]; // nunca vacío; el primero abre el hilo
}

interface CustomIcon {
  key: string; // /^custom-[a-z0-9][a-z0-9-]*$/
  name: string; // 1..60
  description?: string; // ≤ 240
  source?: string; // ≤ 40
  tags?: string[]; // ≤ 12 × ≤ 30
  svg?: { viewBox: string; body: string }; // body ≤ 200 000
  image?: string; // data URL, ≤ 400 000
  createdAt: string;
} // al subir: exactamente uno de svg / image

interface WorkspaceExport {
  exportedAt: string;
  diagrams: DiagramRecord[];
  versions: DiagramVersion[];
}
```

Un `DiagramModel` mínimo válido (todo lo demás tiene valor por defecto):
`{ "canvas": { "w": 1600, "h": 900 }, "shapes": [], "connectors": [] }`.

## Índice

| Método | Ruta                                              | Modo     | Auth / rol mínimo        | Mutante | Éxito      | Sección                                     |
| ------ | ------------------------------------------------- | -------- | ------------------------ | ------- | ---------- | ------------------------------------------- |
| GET    | `/api/health`                                     | ambos    | —                        |         | 200        | [Sistema](#sistema)                         |
| GET    | `/api/metrics`                                    | ambos    | Bearer opcional          |         | 200        | [Sistema](#sistema)                         |
| GET    | `/api/config`                                     | ambos    | —                        |         | 200        | [Sistema](#sistema)                         |
| GET    | `/api/embed`                                      | ambos    | —                        |         | 200        | [Embed](#embed)                             |
| GET    | `/api/auth/login`                                 | servidor | cara `oidc`              |         | 302        | [Auth](#autenticación)                      |
| POST   | `/api/auth/login`                                 | servidor | cara `local`             | sí      | 200        | [Auth](#autenticación)                      |
| GET    | `/api/auth/callback`                              | servidor | cara `oidc`              |         | 302        | [Auth](#autenticación)                      |
| POST   | `/api/auth/logout`                                | servidor | —                        | sí      | 204/200    | [Auth](#autenticación)                      |
| GET    | `/api/auth/me`                                    | servidor | sesión                   |         | 200        | [Auth](#autenticación)                      |
| POST   | `/api/auth/register`                              | servidor | cara `local`             | sí      | 201        | [Auth](#autenticación)                      |
| GET    | `/api/diagrams`                                   | servidor | sesión                   |         | 200        | [Diagramas](#diagramas)                     |
| POST   | `/api/diagrams`                                   | servidor | sesión                   | sí      | 201        | [Diagramas](#diagramas)                     |
| GET    | `/api/diagrams/[id]`                              | servidor | `viewer`                 |         | 200        | [Diagramas](#diagramas)                     |
| PUT    | `/api/diagrams/[id]`                              | servidor | `editor`                 | sí      | 200        | [Diagramas](#diagramas)                     |
| PATCH  | `/api/diagrams/[id]`                              | servidor | `editor`                 | sí      | 200        | [Diagramas](#diagramas)                     |
| DELETE | `/api/diagrams/[id]`                              | servidor | `owner`                  | sí      | 204        | [Diagramas](#diagramas)                     |
| POST   | `/api/diagrams/[id]/duplicate`                    | servidor | `viewer`                 | sí      | 201        | [Diagramas](#diagramas)                     |
| GET    | `/api/diagrams/[id]/versions`                     | servidor | `viewer`                 |         | 200        | [Versiones](#versiones)                     |
| POST   | `/api/diagrams/[id]/versions/[versionId]/restore` | servidor | `editor`                 | sí      | 200        | [Versiones](#versiones)                     |
| GET    | `/api/diagrams/[id]/members`                      | servidor | `viewer`                 |         | 200        | [Miembros](#miembros)                       |
| PUT    | `/api/diagrams/[id]/members`                      | servidor | `owner`                  | sí      | 200        | [Miembros](#miembros)                       |
| PATCH  | `/api/diagrams/[id]/members/[userId]`             | servidor | `owner`                  | sí      | 200        | [Miembros](#miembros)                       |
| DELETE | `/api/diagrams/[id]/members/[userId]`             | servidor | `owner`, o uno mismo     | sí      | 204        | [Miembros](#miembros)                       |
| GET    | `/api/diagrams/[id]/comments`                     | servidor | `viewer`                 |         | 200        | [Comentarios](#comentarios)                 |
| POST   | `/api/diagrams/[id]/comments`                     | servidor | `viewer`                 | sí      | 201        | [Comentarios](#comentarios)                 |
| POST   | `/api/diagrams/[id]/comments/[threadId]`          | servidor | `viewer`                 | sí      | 200        | [Comentarios](#comentarios)                 |
| PATCH  | `/api/diagrams/[id]/comments/[threadId]`          | servidor | `viewer`                 | sí      | 200        | [Comentarios](#comentarios)                 |
| DELETE | `/api/diagrams/[id]/comments/[threadId]`          | servidor | autor del hilo u `owner` | sí      | 204        | [Comentarios](#comentarios)                 |
| POST   | `/api/diagrams/[id]/presence`                     | servidor | miembro                  | sí      | 204        | [Presencia y eventos](#presencia-y-eventos) |
| GET    | `/api/diagrams/[id]/events`                       | servidor | `viewer`                 |         | 200 SSE    | [Presencia y eventos](#presencia-y-eventos) |
| GET    | `/api/icons`                                      | servidor | sesión                   |         | 200        | [Iconos](#iconos)                           |
| POST   | `/api/icons`                                      | servidor | sesión                   | sí      | 201/200    | [Iconos](#iconos)                           |
| DELETE | `/api/icons/[key]`                                | servidor | sesión                   | sí      | 204        | [Iconos](#iconos)                           |
| GET    | `/api/workspace/export`                           | servidor | sesión                   |         | 200        | [Workspace](#workspace)                     |
| POST   | `/api/workspace/import`                           | servidor | sesión                   | sí      | 200        | [Workspace](#workspace)                     |
| POST   | `/api/ai/generate`                                | ambos    | — (rate limit)           |         | 200        | [IA](#ia)                                   |
| POST   | `/api/ai/explain`                                 | ambos    | — (rate limit)           |         | 200 stream | [IA](#ia)                                   |

"Mutante" = exige `x-requested-with: ac-graph` + `Origin` same-origin. Todas las rutas
de servidor con sesión pueden devolver además `401 unauthenticated`, `403 forbidden` (si
son mutantes) y `404 server_mode_off`; no se repite en cada una.

---

## Sistema

### `GET /api/health`

Liveness: el proceso responde. No toca la base de datos. Silenciosa en métricas y log
(`debug`).

- **200** `{ "status": "ok" }`, `Cache-Control: no-store`.

Es el `HEALTHCHECK` de la imagen Docker y el health check del ALB.

### `GET /api/metrics`

Exposición Prometheus (`text/plain; version=0.0.4; charset=utf-8`). Silenciosa. Lista de
métricas en [`BACKEND.md` §14](BACKEND.md#14-observabilidad).

- Cabecera: `Authorization: Bearer <METRICS_TOKEN>` **solo si** la variable está
  configurada; sin ella el endpoint es abierto (no expone datos de usuarios).
- **200** texto Prometheus.
- **401** `unauthenticated` si hay token configurado y no coincide (comparación en
  tiempo constante).

### `GET /api/config`

Cómo está configurado este despliegue. Solo lee variables de entorno: nunca toca la BD
ni el proveedor. El navegador la llama una vez al arrancar.

- **200** en modo local: `{ "mode": "local" }`
- **200** en modo servidor:
  ```json
  {
    "mode": "server",
    "auth": {
      "provider": "local", // o "oidc"
      "signup": true, // la página puede crear cuentas (solo con provider local)
      "loginUrl": "/api/auth/login",
      "logoutUrl": "/api/auth/logout"
    }
  }
  ```

## Embed

### `GET /api/embed?d=<payload>[&theme=dark]`

El diagrama como imagen SVG, renderizado en el servidor con el mismo motor del lienzo.
El diagrama viaja **dentro de la URL** (`d` = modelo comprimido con deflate-raw y
base64url, `src/lib/share/codec.ts`); no se consulta ninguna base de datos.

- `theme=dark` para el tema oscuro; cualquier otro valor = claro.
- **200** `image/svg+xml; charset=utf-8`, `Cache-Control: public, max-age=31536000, immutable`,
  `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`,
  `X-Content-Type-Options: nosniff`.
- **400** texto plano `Missing diagram payload.` si falta `d`.
- **400** texto plano `That link does not contain a readable diagram.` si no decodifica
  o no pasa `DiagramModelSchema`.

Los enlaces los construye `buildShareLinks` (`src/lib/share/links.ts`): `/share?d=…`
para la vista interactiva y `/api/embed?d=…` para la imagen.

## Autenticación

Rutas de `src/app/api/auth/*`. Cada una pertenece a una **cara** del login
(`provider`): una ruta de la otra cara responde `404 not_found` (con un mensaje que
explica cómo se entra en este servidor) antes de tocar la base de datos. Detalles de
diseño en [`BACKEND.md` §6](BACKEND.md#6-autenticación-y-sesiones).

### `GET /api/auth/login?next=<ruta>` — cara `oidc`

Empieza el flujo OIDC (Authorization Code + PKCE).

- `next`: ruta relativa del mismo sitio a la que volver tras el login. Cualquier cosa que
  no empiece por una sola `/` (URLs absolutas, `//host`, saltos de línea) se sustituye
  por `/`.
- **302** `Location: <authorization_url del proveedor>`,
  `Set-Cookie: acg_auth_state=<state>; Max-Age=600; HttpOnly; SameSite=Lax[; Secure]`.
- **302** `Location: <next>?auth_error=provider` si no se pudo hablar con el proveedor
  (discovery fallido, issuer erróneo, red). El detalle está en el log
  (`could not start login`).
- **404** `not_found` en la cara `local`.

### `POST /api/auth/login` — cara `local`, mutante

Entra con correo y contraseña.

- **Cuerpo** (`LoginBodySchema`):
  ```json
  { "email": "ada@example.com", "password": "…" }
  ```
  `email`: 3–254 caracteres, se recorta y pasa a minúsculas, debe parecer un correo.
  `password`: 10–200 caracteres.
- **200** `{ "user": User }` + `Set-Cookie: acg_session=…; Max-Age=<TTL>; Path=/; HttpOnly; SameSite=Lax[; Secure]`.
- **400** `bad_request` con `issues` — se comprueba **antes** de gastar intentos.
- **429** `rate_limited` + `Retry-After` — se cargan dos cubos, por IP y por correo
  (10 de ráfaga, 5 por minuto cada uno, por proceso).
- **401** `invalid_credentials` — correo desconocido, contraseña incorrecta o cuenta sin
  contraseña (OIDC): indistinguibles y con el mismo tiempo de respuesta.
- **404** `not_found` en la cara `oidc`.

### `GET /api/auth/callback?code=…&state=…` — cara `oidc`

Adonde vuelve el proveedor. Comprueba que el `state` de la query coincide con la cookie
`acg_auth_state`, lo consume en `auth_states` (una sola vez, TTL 10 min), canjea el
código, verifica el ID token (firma, `nonce`) y crea o actualiza el usuario por
`(issuer, subject)`.

- **302** `Location: <next_path guardado>`, `Set-Cookie: acg_session=…` y
  `Set-Cookie: acg_auth_state=; Max-Age=0`.
- **302** `Location: /?auth_error=callback` (+ borrado de `acg_auth_state`) ante
  cualquier fallo: state ausente, distinto o caducado, código rechazado, token sin
  `sub`/`iss`. El motivo está en el log (`login callback failed`); la respuesta nunca lo
  dice.
- **404** `not_found` en la cara `local`.

### `POST /api/auth/logout` — ambas caras, mutante

Cierra la sesión de la app. Idempotente: sin cookie o con una desconocida también
responde bien.

- **204** + `Set-Cookie: acg_session=; Max-Age=0` — cara `local`, o `oidc` cuando el
  proveedor no publica `end_session_endpoint`.
- **200** `{ "endSessionUrl": "https://…" }` + la misma cookie de borrado — cara `oidc`
  con `end_session_endpoint`: el navegador debe navegar a esa URL para cerrar también la
  sesión del proveedor (vuelve a `APP_URL`).

### `GET /api/auth/me`

- **200** `{ "user": User }`.
- **401** `unauthenticated`.

### `POST /api/auth/register` — cara `local`, mutante

Crea una cuenta local y la deja ya iniciada.

- **Cuerpo** (`RegisterBodySchema`):
  ```json
  { "name": "Ada Lovelace", "email": "ada@example.com", "password": "…" }
  ```
  `name`: 1–120 tras recortar. `email` y `password` como en login.
- **201** `{ "user": User }` + `Set-Cookie: acg_session=…`.
- **400** `bad_request`.
- **429** `rate_limited` (por IP: 5 de ráfaga, 2 por minuto).
- **403** `signup_closed` si `AUTH_SIGNUP=closed` (las cuentas se crean con
  `npm run users -- create`).
- **409** `email_taken`.
- **404** `not_found` en la cara `oidc`.

## Diagramas

Todas requieren sesión. La autorización la decide `PgDiagramRepository`: diagrama
inexistente → `404 not_found`; existe pero sin rol suficiente → `403 no_access` con
`required` y, si se conoce, `owner.name`.

### `GET /api/diagrams`

La biblioteca del usuario: metadatos de **todo lo que puede ver** (propios y compartidos,
plantillas incluidas — el cliente las separa por `template`), sin el modelo, ordenados
por `updatedAt` descendente.

- **200** `DiagramMeta[]`; cada elemento trae `role` (el del solicitante).

### `POST /api/diagrams` — mutante

Crea un diagrama del que el solicitante es `owner`.

- **Cuerpo** (`CreateDiagramBodySchema`):
  ```json
  {
    "title": "Pagos", // 1..500
    "model": { "canvas": { "w": 1600, "h": 900 }, "shapes": [], "connectors": [] },
    "description": "…", // opcional, ≤ 5000
    "folder": "Equipo A", // opcional, ≤ 500, o null
    "template": false // opcional: guardar como plantilla propia
  }
  ```
  `model` pasa por `DiagramModelSchema` completo (la misma puerta que la importación de
  archivos): un `schemaVersion` mayor que el actual se rechaza.
- **201** `DiagramRecord` con `thumbnail` ya dibujada, `role: "owner"` y
  `createdAt === updatedAt`.
- **400** `bad_request`.

### `GET /api/diagrams/[id]`

- **200** `DiagramRecord` (con `model` y `role`).
- **404** `not_found` · **403** `no_access` (`required: "viewer"`).

### `PUT /api/diagrams/[id]` — mutante, rol `editor`

Guarda el modelo (y opcionalmente metadatos y un snapshot) con control de revisión.

- **Cabecera** `If-Match: <updatedAt que el editor vio>` — recomendado siempre. Sin ella
  (y sin `options.expectedUpdatedAt`) el guardado **pisa** lo que haya.
- **Cuerpo** (`SaveBodySchema`; `options` es _strict_):
  ```json
  {
    "model": { … },
    "options": {
      "snapshot": true,                 // guarda en el historial el modelo ANTERIOR
      "snapshotModel": { … },           // o este modelo explícito (gana sobre snapshot)
      "label": "antes de pasar a GCP",  // ≤ 500, etiqueta del snapshot
      "metadata": { "title": "…", "description": "…", "folder": null }, // sin thumbnail
      "expectedUpdatedAt": "2026-…"     // alternativa a If-Match
    }
  }
  ```
- **200** `DiagramRecord` con el nuevo `updatedAt` (estrictamente posterior al anterior)
  y `thumbnail` redibujada. El historial conserva las 50 versiones más recientes.
- **412** `conflict` `{ "current": DiagramRecord }` — la revisión no coincide. El cliente
  debe mostrar / fusionar `current` y reintentar con su `updatedAt`.
- **400** `bad_request` · **404** `not_found` · **403** `no_access` (`required: "editor"`).
- **Eventos**: `saved` a la sala; `meta` además si `options.metadata.title` venía.

### `PATCH /api/diagrams/[id]` — mutante, rol `editor`

Solo metadatos. No lleva control de revisión, pero **sí avanza `updatedAt`** (afecta al
`If-Match` de otros editores).

- **Cuerpo** (`MetaPatchSchema`, _strict_, todo opcional):
  `{ "title"?: string (1..500), "description"?: string (≤ 5000), "folder"?: string | null, "thumbnail"?: string | null }`
- **200** `DiagramRecord`.
- **Eventos**: `saved`; `meta` si venía `title`.

### `DELETE /api/diagrams/[id]` — mutante, rol `owner`

Borra el diagrama con sus versiones, miembros e hilos (cascada en BD).

- **204** — también para un id que no existe (idempotente).
- **403** `no_access` (`required: "owner"`) si existe y no eres el propietario.
- **Eventos**: `deleted`.

### `POST /api/diagrams/[id]/duplicate` — mutante, rol `viewer`

Copia el diagrama (modelo, descripción, carpeta) a uno nuevo del que el solicitante es
`owner`. La copia nunca es plantilla y no arrastra historial ni miembros.

- **Cuerpo** opcional (`DuplicateBodySchema`, _strict_): `{ "title": "Pagos (copia)" }`
  (1–200 tras recortar). Sin cuerpo (o con `Content-Length: 0`), la copia se titula
  `"<título> copy"`.
- **201** `DiagramRecord`.
- **404** · **403** (`required: "viewer"`).

## Versiones

### `GET /api/diagrams/[id]/versions` — rol `viewer`

- **200** `DiagramVersion[]` (con `model` completo cada una), más reciente primero.
  Máximo 50.
- **404** · **403**.

### `POST /api/diagrams/[id]/versions/[versionId]/restore` — mutante, rol `editor`

Convierte una versión en el modelo actual. Antes, guarda el modelo presente como versión
`label: "before restore"`: restaurar nunca destruye.

- **Cabecera** `If-Match` opcional, mismo significado que en `PUT`. Sin cuerpo.
- **200** `DiagramRecord` con el modelo restaurado y nuevo `updatedAt`.
- **412** `conflict` `{ current }`.
- **404** `not_found` — el diagrama **o** la versión (la versión debe pertenecer a ese
  diagrama).
- **403** `no_access` (`required: "editor"`).
- **Eventos**: `saved`.

## Miembros

El propietario (`ownerId`) gestiona quién entra. Las cuentas nacen del login: solo se
puede invitar a alguien que **ya haya iniciado sesión** alguna vez.

### `GET /api/diagrams/[id]/members` — rol `viewer`

- **200** `DiagramMember[]`: el propietario primero, luego editores, luego lectores;
  dentro de cada grupo por nombre.

### `PUT /api/diagrams/[id]/members` — mutante, rol `owner`

Añade a una persona por correo, o cambia el rol que ya tiene (upsert).

- **Cuerpo** (`MemberBodySchema`, _strict_):
  `{ "email": "grace@example.com", "role": "editor" }` — `role` ∈ `editor | viewer`
  (`owner` nunca se asigna por aquí). El correo se recorta; la búsqueda ignora
  mayúsculas.
- **200** `DiagramMember`.
- **404** `user_not_found` — nadie con ese correo ha iniciado sesión.
- **400** `bad_request` — el correo es el del propietario.
- **404** `not_found` · **403** `no_access` (`required: "owner"`).
- **Eventos**: `access { userId, role }`.

### `PATCH /api/diagrams/[id]/members/[userId]` — mutante, rol `owner`

- **Cuerpo** (`MemberRoleSchema`, _strict_): `{ "role": "viewer" }`.
- **200** `DiagramMember`.
- **400** `bad_request` — `userId` es el propietario, o no es miembro.
- **Eventos**: `access { userId, role }`.

### `DELETE /api/diagrams/[id]/members/[userId]` — mutante

El propietario quita a cualquiera menos a sí mismo; cualquier miembro puede quitarse a sí
mismo (salir del diagrama).

- **204** siempre que la petición sea legítima, haya o no fila que borrar.
- **400** `bad_request` — `userId` es el propietario.
- **403** `no_access` (`required: "owner"`) — no eres propietario e intentas quitar a
  otro.
- **Eventos**: `access { userId, role: null }` **solo** si se quitó una fila.

## Comentarios

Conversaciones ancladas al dibujo, fuera del modelo: no cambian `updatedAt` ni entran en
versiones, enlaces ni exportaciones. Quien puede leer puede abrir, responder y resolver.

### `GET /api/diagrams/[id]/comments` — rol `viewer`

- **200** `CommentThread[]`, más antiguo primero.

### `POST /api/diagrams/[id]/comments` — mutante, rol `viewer`

Abre un hilo con su primer comentario.

- **Cuerpo** (`ThreadBodySchema`, _strict_):
  ```json
  {
    "anchor": { "shapeId": "svc_ab12cd34ef", "x": 420, "y": 180 },
    "body": "¿Y la cola de reintentos?"
  }
  ```
  `body`: 1–4000 tras recortar. `shapeId` puede ser `null` (punto de la hoja).
- **201** `CommentThread` — el `author` es el usuario de la sesión.
- **Eventos**: `comment { threadId, action: "created" }`.

### `POST /api/diagrams/[id]/comments/[threadId]` — mutante, rol `viewer`

Responde en el hilo.

- **Cuerpo** (`ReplyBodySchema`, _strict_): `{ "body": "…" }`.
- **200** `CommentThread` completo.
- **404** `not_found` — el hilo no existe en ese diagrama.
- **Eventos**: `comment { action: "replied" }`.

### `PATCH /api/diagrams/[id]/comments/[threadId]` — mutante, rol `viewer`

Resuelve o reabre.

- **Cuerpo** (`ThreadPatchSchema`, _strict_): `{ "resolved": true }`.
- **200** `CommentThread` con `resolvedAt` / `resolvedBy` puestos (o `null` al reabrir).
- **Eventos**: `comment { action: "resolved" | "reopened" }`.

### `DELETE /api/diagrams/[id]/comments/[threadId]` — mutante

Solo el autor del primer comentario o el propietario del diagrama.

- **204**.
- **403** `forbidden` — ni autor ni propietario (nótese: `forbidden`, no `no_access`).
- **404** `not_found`.
- **Eventos**: `comment { action: "deleted" }`.

## Presencia y eventos

### `POST /api/diagrams/[id]/presence` — mutante, miembro

Latido y estado del cursor de **esta pestaña** (identificada por el `sessionKey`
derivado de la cookie). Los campos omitidos conservan su valor anterior.

- **Cuerpo** (`PresenceBodySchema`, _strict_):
  `{ "cursor"?: { "x": number, "y": number } | null, "editing"?: boolean }` —
  `cursor: null` oculta el cursor.
- **204**.
- **403** `no_access` (`required: "viewer"`) — no eres miembro. **También si el diagrama
  no existe** (esta ruta no distingue, a diferencia del resto).
- **Eventos**: reenvía el roster `presence` a la sala.

Basta con mantener abierto el stream de eventos para figurar como presente (el latido del
stream refresca la presencia cada 15 s); esta ruta añade posición y estado de edición.

### `GET /api/diagrams/[id]/events` — rol `viewer` — Server-Sent Events

Abre el stream de la sala. Ver [Server-Sent Events](#server-sent-events).

- **200** `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-store`,
  `Connection: keep-alive`, `X-Accel-Buffering: no`.
- **404** `not_found` · **403** `no_access` — como JSON, antes de abrir el stream.

## Iconos

La biblioteca de iconos propios **del workspace**: una sola para todos los usuarios;
cualquiera añade o quita. Detalle en [`BACKEND.md` §10](BACKEND.md#10-biblioteca-de-iconos-del-workspace).

### `GET /api/icons`

- **200** `CustomIcon[]`, más reciente primero.

### `POST /api/icons` — mutante

Sube un icono. La biblioteca deduplica por el **dibujo** (hash de `svg.viewBox + body` o
de `image`), no por `key` ni `name`.

- **Cuerpo** (`IconBodySchema`): un `CustomIcon` completo (_strict_) con **exactamente
  uno** de `svg` / `image`. El SVG debe llegar ya saneado: el servidor no tiene DOM.
- **201** `CustomIcon` — nuevo; el mismo que se envió.
- **200** `CustomIcon` — **otro** icono que ya contenía el mismo dibujo (puede tener otra
  `key` y otro `name`). El cliente debe usar el devuelto.
- Re-subir con una `key` ya existente **reemplaza** ese icono: responde **200** con el
  enviado y no cuenta contra la cuota.
- **409** `library_full` `{ count, bytes }` — 200 iconos o 16 MiB.
- **400** `bad_request`.

### `DELETE /api/icons/[key]` — mutante

- **204**.
- **404** `not_found`.

Los documentos que embebían el icono siguen dibujándolo (`model.customIcons`).

## Workspace

### `GET /api/workspace/export`

Volcado completo de lo que el usuario puede leer.

- **200** `WorkspaceExport` = `{ exportedAt, diagrams: DiagramRecord[], versions: DiagramVersion[] }`.
  Los diagramas van en orden de creación; **no** incluye miembros, hilos ni iconos del
  workspace.

### `POST /api/workspace/import` — mutante

Fusiona un volcado: todo se valida antes de escribir, cada diagrama recibe un **id
nuevo** (y sus versiones también), el importador queda como `owner`. Una transacción:
si algo falla, no queda nada.

- **Cuerpo** (`WorkspaceImportSchema`): un `WorkspaceExport`. Recordar el tope de 5 MiB.
- **200** `{ "imported": <número de diagramas> }`.
- **400** `bad_request` · **413** `payload_too_large`.

## IA

Disponibles en ambos modos, **sin autenticación**, con un limitador por proceso y
visitante (IP + cabecera opcional `x-studio-session`). Sin `ANTHROPIC_API_KEY` responden
`503`. Los errores tienen la forma `{ code, message }` (sin los `details` de la API de
servidor).

Códigos propios: `not_configured` 503 · `rate_limited` 429 (+ `retry-after`) ·
`bad_request` 400 · `empty_diagram` 400 · `refused` 422 · `unparseable` 502; y los que
traducen el SDK (`src/lib/ai/errors.ts`): `bad_key` 500 · `no_permission` 500 ·
`upstream_rate_limit` 429 · `unreachable` 503 · `api_error` 502/400 · `unknown` 500.

### `POST /api/ai/generate`

Genera, modifica o cambia de nube un diagrama a partir de un texto. Límite: 5 de ráfaga,
3 por minuto.

- **Cuerpo**:
  ```json
  {
    "operation": "generate",       // "generate" (defecto) | "modify" | "retarget"
    "prompt": "Un API gateway delante de tres microservicios con una cola",  // 3..4000
    "model": { … },                // el diagrama actual, para modify / retarget
    "locale": "es"                 // idioma de los subtítulos; defecto "en"
  }
  ```
- **200**:
  ```json
  {
    "title": "…", "summary": "…", "cloud": "aws",
    "model": { … },                // DiagramModel compilado
    "dropped": [ … ],              // elementos de la respuesta que no se pudieron mapear
    "diagnostics": [ … ],          // avisos del compilador del DSL
    "usage": { "input": 1234, "output": 567, "cacheRead": 1000 }
  }
  ```
- **422** `refused` `{ detail }` — el modelo declinó.
- **502** `unparseable` — la respuesta no siguió el schema.

### `POST /api/ai/explain`

Respuesta en prosa sobre el diagrama actual, en **streaming** de texto plano. Límite: 8
de ráfaga, 6 por minuto.

- **Cuerpo**: `{ "question": "¿Qué falta para alta disponibilidad?", "model": { … } }`
  (`question` 3–2000; `model` debe ser un diagrama válido).
- **200** `text/plain; charset=utf-8`, cuerpo en trozos según llega. Si el modelo
  declina o falla a mitad, el texto termina con una línea en cursiva que lo dice
  (`_…_`); el status ya fue 200.
- **400** `bad_request` (cuerpo o diagrama inválidos) · **400** `empty_diagram` (sin
  formas).

## Server-Sent Events

Un stream por espectador y diagrama. Se abre con `EventSource` (GET con cookie; no
necesita cabeceras CSRF). Abrirlo une al espectador a la sala y **publica el roster a
todos**, incluido él (así recibe su lista inicial); cerrarlo lo saca.

### Formato

Cada mensaje es `event: <type>` seguido de `data: <JSON completo del evento>` (el JSON
repite `type`). Cada 15 s llega un comentario `: ping` que no es un evento. No hay
campo `id:`, por lo que **no hay reanudación por `Last-Event-ID`**: al reconectar, el
cliente debe volver a pedir el diagrama (y los hilos, si los muestra).

```
event: presence
data: {"type":"presence","users":[{"id":"usr_a","name":"Ada","color":"#7c5cff","cursor":null,"editing":false,"self":true}]}

: ping

event: saved
data: {"type":"saved","updatedAt":"2026-09-16T10:20:30.123Z","by":{"id":"usr_b","name":"Grace"}}
```

### Eventos

| `type`     | Cuándo                                                                 | Carga                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `presence` | Alguien entra, sale, mueve el cursor o cambia `editing`; al conectar   | `users: [{ id, name, color, cursor: {x,y} \| null, editing, self }]` — `self` marca la fila de **esta** conexión                               |
| `saved`    | `PUT`, `PATCH` o `restore` sobre el diagrama                           | `updatedAt` (la nueva revisión), `by: { id, name }`                                                                                            |
| `meta`     | Cambió el título (junto con `saved`)                                   | `title`                                                                                                                                        |
| `deleted`  | El propietario borró el diagrama                                       | —                                                                                                                                              |
| `access`   | Alguien fue invitado, cambió de rol o fue quitado (también si eres tú) | `userId`, `role: Role \| null` (`null` = quitado), `by`                                                                                        |
| `comment`  | Un hilo se abrió, respondió, resolvió, reabrió o borró                 | `threadId`, `action: 'created' \| 'replied' \| 'resolved' \| 'reopened' \| 'deleted'`, `by` — **sin el contenido**: volver a pedir `/comments` |

Los eventos incluyen los de la propia sesión (`by.id === mi id`): el cliente decide si
los ignora.

### Reacción esperada del cliente

- `saved` con `updatedAt` distinto del propio → adoptar la nueva revisión (GET) o avisar
  de que hay cambios; el siguiente `PUT` con el `If-Match` viejo dará 412.
- `deleted` → cerrar el editor.
- `access` con `role: null` y `userId` propio → salir; con otro rol → ajustar solo
  lectura.
- `presence` → redibujar cursores / avatares; las entradas caducan por sí solas a los 15 s
  sin latido, sin evento de salida garantizado.

### Infraestructura

- Proxies: `X-Accel-Buffering: no` (nginx); en ALB el `idle_timeout` debe superar los
  15 s del latido (el Terraform lo fija en 3600).
- Con varias réplicas, los eventos cruzan por el bus `LISTEN/NOTIFY` de forma _best
  effort_ ([`BACKEND.md` §9](BACKEND.md#9-colaboración-en-vivo)).
- Métricas: `acgraph_sse_connections`, `acgraph_sse_events_published_total{type}`.

## Sesión de ejemplo con `curl`

```bash
APP=http://localhost:3080          # debe ser exactamente APP_URL
MUT=(-H 'x-requested-with: ac-graph' -H "Origin: $APP" -H 'Content-Type: application/json')

# 0. ¿En qué modo está?
curl -s $APP/api/config
# {"mode":"server","auth":{"provider":"local","signup":true,"loginUrl":"/api/auth/login","logoutUrl":"/api/auth/logout"}}

# 1. Entrar (guarda la cookie en jar.txt)
curl -s -c jar.txt "${MUT[@]}" -d '{"email":"ada@example.com","password":"correct horse battery"}' $APP/api/auth/login
# {"user":{"id":"usr_…","name":"Ada","email":"ada@example.com"}}

# 2. Quién soy
curl -s -b jar.txt $APP/api/auth/me

# 3. Crear un diagrama
curl -s -b jar.txt "${MUT[@]}" \
  -d '{"title":"Demo","model":{"canvas":{"w":1600,"h":900},"shapes":[],"connectors":[]}}' \
  $APP/api/diagrams
# 201 {"id":"dgm_…","updatedAt":"2026-…","role":"owner",…}
ID=dgm_…; REV=2026-…

# 4. Guardar con control de revisión y snapshot
curl -s -b jar.txt "${MUT[@]}" -X PUT -H "If-Match: $REV" \
  -d '{"model":{"canvas":{"w":1600,"h":900},"shapes":[],"connectors":[]},"options":{"snapshot":true,"label":"inicio"}}' \
  $APP/api/diagrams/$ID
# 200 {… "updatedAt":"<nuevo>" …}

# 5. Repetir con la revisión vieja → conflicto
curl -s -b jar.txt "${MUT[@]}" -X PUT -H "If-Match: $REV" -d '{"model":{…}}' $APP/api/diagrams/$ID -o /dev/null -w '%{http_code}\n'
# 412   (cuerpo: {"code":"conflict","message":"…","current":{…}})

# 6. Invitar a alguien que ya inició sesión
curl -s -b jar.txt "${MUT[@]}" -X PUT -d '{"email":"grace@example.com","role":"editor"}' $APP/api/diagrams/$ID/members

# 7. Escuchar la sala (Ctrl-C para salir)
curl -N -b jar.txt $APP/api/diagrams/$ID/events

# 8. Sin cabecera CSRF → 403
curl -s -b jar.txt -X DELETE $APP/api/diagrams/$ID
# {"code":"forbidden","message":"Missing the same-origin request marker."}

# 9. Salir
curl -s -i -b jar.txt -H 'x-requested-with: ac-graph' -H "Origin: $APP" -X POST $APP/api/auth/logout | head -5
```

## Mantener este documento

Al tocar una ruta: actualizar su sección aquí, el índice si cambia método o rol, la
tabla de errores si aparece un `ErrorCode` nuevo, y la prueba correspondiente en
`src/server/api.pg.test.ts`. El cliente `src/lib/store/httpRepository.ts` es el otro
extremo del contrato: un cambio de forma se hace en los dos lados a la vez.
