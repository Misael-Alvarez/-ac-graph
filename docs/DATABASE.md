# Base de datos de AC Graph

> Esquema, migraciones, ciclo de vida de los datos y consultas de operación del modo
> servidor. El código que manda es `src/server/schema.ts` (DDL) y
> `src/server/diagrams/repository.ts`, `src/server/icons/repository.ts`,
> `src/server/auth/*.ts` (DML). Contexto general en [`BACKEND.md`](BACKEND.md); contrato
> HTTP en [`API.md`](API.md).

## 1. Resumen

- **PostgreSQL 17** (imagen `postgres:17.11-bookworm` en Compose; RDS 17 en AWS). Sin
  extensiones. Todo en el esquema `public`.
- **SQL a mano** con el driver `pg`; sin ORM ni generador de consultas. Toda consulta va
  parametrizada (`$1`, `$2`…).
- **10 migraciones embebidas** en `MIGRATIONS` (`src/server/schema.ts`), que crean **9
  tablas** más la tabla de control `schema_migrations`. Se aplican solas en el primer
  acceso autenticado de cada proceso.
- **Un solo workspace**: no hay columna de tenant. Todo usuario que inicia sesión ve la
  misma biblioteca de iconos y puede ser invitado a cualquier diagrama.
- **Lo que hay dentro**: quién existe (`users`), cómo está conectado (`sessions`,
  `auth_states`), qué diagramas hay y de quién son (`diagrams`, `diagram_members`), su
  historial (`diagram_versions`), sus conversaciones (`comment_threads`) y los iconos
  propios del workspace (`icons`).

## 2. Conexión

Configurada en `poolConfig()` (`src/server/db.ts`) a partir de `DATABASE_URL`:

| Parámetro                 | Valor                      | Motivo                                                                      |
| ------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| `max`                     | `PGPOOL_MAX` (10)          | Conexiones del pool por proceso                                             |
| `statement_timeout`       | 15 000 ms                  | Largo para un import de workspace, corto para parar una consulta loca       |
| `idleTimeoutMillis`       | 30 000                     | Devuelve conexiones ociosas al servidor                                     |
| `connectionTimeoutMillis` | 10 000                     | Falla rápido si la BD no responde                                           |
| `application_name`        | `ac-graph`                 | Para reconocer las conexiones en `pg_stat_activity`                         |
| TLS                       | lo que diga `DATABASE_URL` | En AWS: `?sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem` |

Además del pool, cada réplica en modo servidor abre **una conexión dedicada** para el bus
de colaboración (`LISTEN acgraph_collab`), con `application_name = 'ac-graph-bus'` y
`keepAlive`. Presupuesto de conexiones: **N réplicas × (PGPOOL_MAX + 1)**, más las de
scripts (`users.mjs` usa un pool de 2).

**Pooler externo (PgBouncer, RDS Proxy)**: el pool de la app funciona en modo
_transaction_, pero la conexión del bus necesita **modo _session_** o conexión directa,
porque `LISTEN` es por sesión. Si el pooler es obligatorio, apuntar solo el pool a él y
el bus a la BD directa (hoy ambos leen `DATABASE_URL`: sería un cambio en
`collaboration.ts`).

**Permisos del rol**: el que migra necesita `CREATE` en el esquema `public` (crea tablas
e índices y queda como propietario); en operación normal, `SELECT / INSERT / UPDATE /
DELETE` sobre todas las tablas. `LISTEN`, `pg_notify` y `pg_advisory_xact_lock` no
requieren privilegios especiales. Con Compose el rol es `acgraph`, dueño de la base
`acgraph`; en RDS, el usuario maestro definido en Terraform.

## 3. Migraciones

### Mecanismo (`runMigrations`, `ensureSchema`)

1. `withUser()` / `withServerMode()` llaman a `ensureSchema()` antes de leer la sesión.
   La promesa se **memoriza por proceso**: la primera petición migra, las demás esperan
   esa misma promesa. Si falla, el memo se olvida y la siguiente petición reintenta.
2. `runMigrations()` abre **una transacción**, toma
   `pg_advisory_xact_lock(7364281045)` (clave arbitraria pero fija: todas las réplicas
   piden la misma), crea `schema_migrations` si no existe, lee los `id` aplicados y
   ejecuta en orden las migraciones que falten, insertando una fila por cada una.
   `COMMIT` libera el lock.
3. Con N réplicas arrancando a la vez, una migra y las otras esperan al lock; al
   obtenerlo ven las filas nuevas y no hacen nada.
4. Si una migración falla, **todo el lote** hace `ROLLBACK` (el DDL de PostgreSQL es
   transaccional): el esquema nunca queda a medias entre dos versiones.
5. No hay migraciones "hacia abajo". Para volver atrás: restaurar un backup.

Verlo: `select id, name, applied_at from schema_migrations order by id;` — debe listar
1..10 con los nombres de la tabla siguiente.

### Historial

| id  | Nombre             | Qué hace                                                                     |
| --- | ------------------ | ---------------------------------------------------------------------------- |
| 1   | `users`            | Tabla de personas, identificadas por `(issuer, subject)`                     |
| 2   | `sessions`         | Sesiones por cookie (solo el hash del id)                                    |
| 3   | `auth_states`      | Estado efímero de un login OIDC en curso                                     |
| 4   | `diagrams`         | El diagrama: metadatos + `model jsonb`                                       |
| 5   | `diagram_versions` | Historial de modelos                                                         |
| 6   | `diagram_members`  | Roles por diagrama. **Rellena** una fila `owner` por cada diagrama existente |
| 7   | `diagram_template` | Columna `diagrams.template` (plantilla propia)                               |
| 8   | `icons`            | Biblioteca de iconos del workspace                                           |
| 9   | `comment_threads`  | Hilos de comentarios                                                         |
| 10  | `local_accounts`   | Columna `users.password_hash` (cuentas con contraseña)                       |

### Cómo añadir una migración

```ts
// src/server/schema.ts — al FINAL del array MIGRATIONS
{
  id: 11,
  name: 'diagram_archived',
  // Una frase que diga por qué existe; el "qué" ya lo dice el SQL.
  sql: `
    alter table diagrams add column if not exists archived_at text;
    create index if not exists diagrams_archived_at_idx
      on diagrams (archived_at) where archived_at is not null;
  `,
},
```

Lista de comprobación:

1. **Solo al final, con el `id` siguiente.** Nunca editar, reordenar ni borrar una
   migración que ya haya corrido en algún entorno: `schema_migrations` guarda ids, no
   contenidos, y una migración cambiada no se re-ejecuta.
2. **Idempotente**: `create table if not exists`, `add column if not exists`,
   `create index if not exists`, `insert … on conflict do nothing`. Aunque el control
   evita repetir, la idempotencia es lo que hace seguro un rollback de la app con la BD
   ya migrada.
3. **Un cambio lógico por migración**, con un nombre que lo diga.
4. **Tipos de fecha**: los sellos que el dominio compara o expone (`createdAt`,
   `updatedAt`, `resolvedAt`) son `text` ISO; los internos del servidor,
   `timestamptz`. Ver [§6](#6-convenciones).
5. **Solo cambios aditivos** mientras conviva código viejo con esquema nuevo (durante un
   despliegue rodante siempre pasa). Renombrar o borrar una columna exige dos
   despliegues: primero dejar de usarla, después quitarla.
6. **Índices grandes**: `create index` normal bloquea escrituras en la tabla mientras se
   construye; a los tamaños de hoy es instantáneo. `create index concurrently` **no puede
   correr dentro de una transacción**, así que no encaja en este mecanismo: si algún día
   hace falta, se hace a mano fuera de la app.
7. **Datos**: si la migración rellena filas (como la 6), hacerlo en el mismo SQL, con
   `on conflict do nothing`.
8. **Código que la acompaña**: repositorio (leer/escribir la columna), schema Zod en
   `src/lib/domain/project.ts` con `.default()` u `.optional()` para que las filas
   antiguas sigan parseando, cliente `httpRepository.ts` y, si aplica al modo local,
   `localRepository.ts` (IndexedDB tiene su propia versión de esquema).
9. **Pruebas**: `src/server/testing/pg.ts` → añadir la tabla nueva a `dropSchema()` (en
   orden inverso de dependencias); `src/server/schema.pg.test.ts` comprueba que se aplican
   todas. Correr con `TEST_DATABASE_URL`.
10. **Documentar**: fila en el historial de arriba y la tabla en [§5](#5-tablas).

## 4. Diagrama entidad-relación

```mermaid
erDiagram
  users ||--o{ sessions : "user_id"
  users ||--o{ diagrams : "owner_id (sin cascade)"
  users ||--o{ diagram_members : "user_id"
  users o|--o{ diagram_members : "added_by (set null)"
  users o|--o{ icons : "created_by (set null)"
  users o|--o{ comment_threads : "created_by (set null)"
  diagrams ||--o{ diagram_versions : "diagram_id"
  diagrams ||--o{ diagram_members : "diagram_id"
  diagrams ||--o{ comment_threads : "diagram_id"

  users {
    text id PK
    text issuer
    text subject
    text name
    text email
    text picture
    text password_hash
    timestamptz created_at
    timestamptz updated_at
  }
  sessions {
    text id_hash PK
    text user_id FK
    timestamptz created_at
    timestamptz expires_at
  }
  auth_states {
    text state PK
    text code_verifier
    text nonce
    text next_path
    timestamptz created_at
    timestamptz expires_at
  }
  diagrams {
    text id PK
    text owner_id FK
    text title
    text description
    text folder
    text created_at
    text updated_at
    text thumbnail
    boolean template
    jsonb model
  }
  diagram_versions {
    text id PK
    text diagram_id FK
    text created_at
    text label
    jsonb model
  }
  diagram_members {
    text diagram_id PK
    text user_id PK
    text role
    text added_by FK
    timestamptz created_at
  }
  icons {
    text key PK
    jsonb icon
    text content_hash
    text created_by FK
    timestamptz created_at
  }
  comment_threads {
    text id PK
    text diagram_id FK
    jsonb anchor
    text created_by FK
    text created_at
    text resolved_at
    jsonb resolved_by
    jsonb comments
  }
  schema_migrations {
    integer id PK
    text name
    timestamptz applied_at
  }
```

`auth_states` y `schema_migrations` no se relacionan con nada: la primera es efímera, la
segunda es control.

## 5. Tablas

Para cada tabla: DDL efectivo tras las 10 migraciones, quién la escribe y qué hay que
saber. Las columnas `jsonb` se validan con Zod **al leer** (`*.parse` en el
repositorio): una fila editada a mano que no pase el schema hace fallar la petición que
la lee, no el resto.

### `schema_migrations`

```sql
create table schema_migrations (
  id          integer     primary key,
  name        text        not null,
  applied_at  timestamptz not null default now()
);
```

Una fila por migración aplicada. La escribe `runMigrations`. No tocar a mano salvo para
una recuperación consciente.

### `users`

```sql
create table users (
  id             text        primary key,          -- usr_…
  issuer         text        not null,             -- 'local' o el iss del proveedor OIDC
  subject        text        not null,             -- lower(email) si local; sub del proveedor si OIDC
  name           text        not null,
  email          text,
  picture        text,                             -- URL del avatar (claim picture)
  password_hash  text,                             -- scrypt$N$r$p$sal$hash; null si vino por OIDC
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint users_issuer_subject_key unique (issuer, subject)
);
```

- **Identidad = `(issuer, subject)`**, nunca el correo. Una cuenta local usa
  `issuer = 'local'` y `subject = lower(email)`: la constraint única es lo que impide dos
  cuentas locales con el mismo correo. **No añadir un índice único por `email`**: una
  misma persona puede existir como cuenta OIDC y como cuenta local (dos filas), y el
  correo de un proveedor puede ser nulo.
- Escriben: `upsertUser` (callback OIDC; actualiza `name`, `email`, `picture`,
  `updated_at` en cada login), `createLocalUser` (alta o CLI), `setPassword` (CLI).
- Leen: `getSessionUser` (join con `sessions`), `authenticate`, `setMember` (busca por
  `lower(email)`), listados de miembros, `owner_name` en los errores de acceso.
- **Nunca la borra la app.** `scripts/users.mjs delete` lo hace, y rehúsa si la persona
  es propietaria de algún diagrama (la FK `diagrams.owner_id` no tiene cascade y fallaría
  igualmente). Al borrar caen en cascada sus sesiones y sus membresías; `added_by`,
  `icons.created_by` y `comment_threads.created_by` pasan a `null`. Los comentarios
  conservan su nombre dentro del `jsonb`.

### `sessions`

```sql
create table sessions (
  id_hash     text        primary key,             -- sha256(hex) del id que viaja en la cookie
  user_id     text        not null references users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index sessions_user_id_idx    on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);
```

- El valor de la cookie `acg_session` **no está en la BD**; solo su SHA-256. Un volcado
  no permite fabricar cookies.
- `expires_at = now() + SESSION_TTL_HOURS` al crear; **no se renueva**.
- Escriben: `createSession` (login), `destroySession` (logout). Ambas barren además
  `where expires_at <= now()`, así la tabla se mantiene sola sin cron.
- Para expulsar a alguien: borrar sus filas (ver [§8](#8-consultas-de-operación)). El
  efecto es inmediato: la siguiente petición con esa cookie es 401.

### `auth_states`

```sql
create table auth_states (
  state          text        primary key,          -- state OIDC (aleatorio)
  code_verifier  text        not null,             -- PKCE
  nonce          text        not null,
  next_path      text        not null,             -- adónde volver tras el login
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null              -- now() + 10 min
);
create index auth_states_expires_at_idx on auth_states (expires_at);
```

- Vive **10 minutos** y se **consume una sola vez** (`delete … returning` en el
  callback). Solo se usa con la cara `oidc`; en un despliegue con contraseñas está vacía.
- `beginLogin` barre las caducadas antes de insertar.

### `diagrams`

```sql
create table diagrams (
  id           text    primary key,                 -- dgm_…
  owner_id     text    not null references users (id),   -- SIN on delete: un propietario no se borra
  title        text    not null,
  description  text    not null default '',
  folder       text,
  created_at   text    not null,                    -- ISO-8601 (texto, ver §6)
  updated_at   text    not null,                    -- ISO-8601: LA REVISIÓN
  thumbnail    text,                                -- SVG inline dibujado por el servidor
  template     boolean not null default false,     -- migración 7
  model        jsonb   not null                     -- DiagramModelSchema (src/lib/domain/diagram.ts)
);
create index diagrams_owner_id_idx   on diagrams (owner_id);
create index diagrams_updated_at_idx on diagrams (updated_at desc);
```

- `updated_at` es lo que el cliente manda en `If-Match`; se compara por **igualdad exacta
  de texto**. Lo produce `serverClock()`: estrictamente creciente y siempre posterior al
  valor leído bajo lock.
- El propietario tiene además su fila `owner` en `diagram_members`; el join con esa tabla
  es lo que responde "qué diagramas ve X" (`list`, `exportWorkspace`). `owner_id` se usa
  para las reglas de membresía ("la fila del propietario es intocable") y para
  `owner_name` en los 403.
- `template = true` marca una plantilla propia: misma tabla, mismo historial, mismos
  miembros; la portada las separa por esta columna.
- `model` de un diagrama de 50 formas ocupa ~17 KB; el tope del cuerpo HTTP (5 MiB) es el
  techo práctico. `thumbnail` es un SVG completo (decenas de KB).
- Escrituras: siempre dentro de `withTransaction`, tras `select … for update of d`
  (`change()` en el repositorio). Borrar el diagrama arrastra versiones, miembros e hilos
  por cascade.

### `diagram_versions`

```sql
create table diagram_versions (
  id          text  primary key,                    -- ver_…
  diagram_id  text  not null references diagrams (id) on delete cascade,
  created_at  text  not null,                       -- ISO-8601
  label       text,                                 -- 'before restore', etiqueta del usuario, o null
  model       jsonb not null
);
create index diagram_versions_diagram_id_created_at_idx
  on diagram_versions (diagram_id, created_at desc);
```

- Modelos completos, no diffs. Se crea una fila al guardar con `snapshot` /
  `snapshotModel`, antes de cada restauración, y al importar un workspace (las versiones
  del volcado, con ids nuevos).
- **Tope 50 por diagrama** (`MAX_VERSIONS_PER_DIAGRAM`): en la misma transacción del
  snapshot se borran las que sobran, de la más antigua en adelante. Por tanto el tamaño
  de esta tabla está acotado a ~50 × (diagramas) modelos.
- `created_at` sale de `clock(record.updatedAt)`: posterior al `updated_at` del diagrama
  en ese momento, así el orden por texto coincide con el cronológico.

### `diagram_members`

```sql
create table diagram_members (
  diagram_id  text        not null references diagrams (id) on delete cascade,
  user_id     text        not null references users (id) on delete cascade,
  role        text        not null check (role in ('owner', 'editor', 'viewer')),
  added_by    text        references users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (diagram_id, user_id)
);
create index diagram_members_user_id_idx on diagram_members (user_id);
```

- **Exactamente una fila `owner` por diagrama**, igual a `diagrams.owner_id`, creada en
  la misma transacción que el diagrama (o rellenada por la migración 6 para los
  anteriores). No hay constraint que lo imponga: lo garantiza el repositorio (`setMember`
  y `setMemberRole` rehúsan tocar al propietario, `removeMember` rehúsa quitarlo).
- `added_by` = quién invitó o cambió el rol la última vez.
- Toda lectura de un diagrama hace `left join diagram_members m on m.diagram_id = d.id
and m.user_id = <actor>`; toda escritura lo hace bajo `for update of d`. Es **la** tabla
  de autorización.

### `icons`

```sql
create table icons (
  key           text        primary key,           -- custom-[a-z0-9][a-z0-9-]*
  icon          jsonb       not null,              -- CustomIconSchema completo (incluye key, name, svg/image…)
  content_hash  text        not null,              -- sha256 del dibujo (svg.viewBox+body, o image)
  created_by    text        references users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index icons_content_hash_idx on icons (content_hash);
create index icons_created_at_idx   on icons (created_at desc);
```

- Una biblioteca para todo el workspace. `content_hash` es lo que deduplica: antes de
  insertar se busca otra `key` con el mismo hash y, si existe, se devuelve esa.
- Cuota **200 filas / 16 MiB** (`sum(octet_length(icon::text))`), comprobada bajo
  `lock table icons in share row exclusive mode` en la transacción que inserta, así dos
  subidas simultáneas no la superan.
- Borrar una fila no afecta a los diagramas: el icono está embebido en `model.customIcons`
  de cada documento que lo usó.
- **No entra en la exportación del workspace.** Para migrar la biblioteca entre entornos
  hay que copiar la tabla.

### `comment_threads`

```sql
create table comment_threads (
  id           text  primary key,                   -- thr_…
  diagram_id   text  not null references diagrams (id) on delete cascade,
  anchor       jsonb not null,                      -- { shapeId: string|null, x, y }
  created_by   text  references users (id) on delete set null,
  created_at   text  not null,                      -- ISO-8601
  resolved_at  text,                                -- ISO-8601 o null
  resolved_by  jsonb,                               -- { id, name } o null
  comments     jsonb not null                       -- [{ id: cmt_…, author: { id, name }, body, createdAt }, …] nunca vacío
);
create index comment_threads_diagram_id_created_at_idx
  on comment_threads (diagram_id, created_at);
```

- Un hilo con sus respuestas dentro: se lee y escribe **entero**, bajo `for update`.
  Simplifica el modelo; un hilo es pequeño (cada `body` ≤ 4 000 caracteres).
- El autor del hilo para efectos de permiso de borrado es `comments[0].author.id` (no
  `created_by`, que puede quedar en `null` si la cuenta se borra).
- No toca `diagrams.updated_at`: comentar no es editar.

## 6. Convenciones

### Identificadores

`text` con prefijo semántico y 10 caracteres de `nanoid`: `usr_`, `dgm_`, `ver_`,
`thr_`, `cmt_` (`uid()` en `src/lib/engine/ids.ts`). Los ids de formas dentro del modelo
(`svc_`, `grp_`, …) siguen la misma regla pero viven en el `jsonb`. Los ids de sesión no
se guardan (solo su hash). El `state` OIDC lo genera `openid-client`.

### Fechas: `text` frente a `timestamptz`

| Tablas                                                                              | Columnas                                               | Tipo          | Por qué                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diagrams`, `diagram_versions`, `comment_threads`                                   | `created_at`, `updated_at`, `resolved_at`              | `text` ISO    | Son sellos del **dominio**: el cliente los compara por igualdad exacta (`If-Match`) y un viaje por `timestamptz` los reformatearía (precisión, zona). Formato fijo `YYYY-MM-DDTHH:mm:ss.sssZ` de `Date.toISOString()`, así el orden alfabético es el cronológico |
| `users`, `sessions`, `auth_states`, `diagram_members`, `icons`, `schema_migrations` | `created_at`, `updated_at`, `expires_at`, `applied_at` | `timestamptz` | Internos del servidor; se comparan con `now()` en SQL                                                                                                                                                                                                            |

Al consultar a mano, `updated_at::timestamptz` convierte sin problema; al **escribir** a
mano, respetar el formato exacto o el cliente verá conflictos falsos.

### `jsonb` y sus schemas

| Columna                                    | Schema Zod                       | Archivo                     |
| ------------------------------------------ | -------------------------------- | --------------------------- |
| `diagrams.model`, `diagram_versions.model` | `DiagramModelSchema`             | `src/lib/domain/diagram.ts` |
| `icons.icon`                               | `CustomIconSchema`               | `src/lib/domain/diagram.ts` |
| `comment_threads.anchor`                   | `CommentAnchorSchema`            | `src/lib/domain/project.ts` |
| `comment_threads.resolved_by`              | `CommentAuthorSchema` (nullable) | `src/lib/domain/project.ts` |
| `comment_threads.comments`                 | `z.array(CommentSchema).min(1)`  | `src/lib/domain/project.ts` |

`DiagramModelSchema` lleva `schemaVersion`: toda versión ≤ la actual se lee y se resella
con la actual (los cambios han sido aditivos); una mayor se **rechaza** ("Written by a
newer version"). Bajar de versión la app con datos escritos por una más nueva hace que
esos diagramas no se puedan abrir hasta volver a subirla.

### Borrados en cascada

| Al borrar…                 | Cae con ello                                                                          | Queda con `null`                                                             |
| -------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| un `diagrams`              | `diagram_versions`, `diagram_members`, `comment_threads` del diagrama                 |                                                                              |
| un `users`                 | `sessions`, `diagram_members` de la persona                                           | `diagram_members.added_by`, `icons.created_by`, `comment_threads.created_by` |
| un `users` **propietario** | **Falla** (`diagrams.owner_id` sin cascade). Primero reasignar o borrar sus diagramas |                                                                              |

## 7. Ciclo de vida de los datos

| Dato               | Nace                                    | Muere                                                                 | Quién limpia                    |
| ------------------ | --------------------------------------- | --------------------------------------------------------------------- | ------------------------------- |
| `sessions`         | Login (contraseña, alta, callback OIDC) | `expires_at` (TTL fijo) o logout                                      | La app, en cada login / logout  |
| `auth_states`      | `GET /api/auth/login` (OIDC)            | Al completarse el callback, o a los 10 min                            | La app, en cada inicio de login |
| `diagram_versions` | Snapshot, restauración, import          | Cuando hay más de 50 por diagrama (las más antiguas); con el diagrama | La app, en cada snapshot        |
| `icons`            | `POST /api/icons`                       | `DELETE /api/icons/[key]`                                             | Las personas                    |
| `comment_threads`  | `POST …/comments`                       | `DELETE …/comments/[threadId]`; con el diagrama                       | Las personas                    |
| `diagrams`         | `POST /api/diagrams`, duplicado, import | `DELETE /api/diagrams/[id]` (solo el propietario)                     | Las personas                    |
| `users`            | Primer login OIDC, alta local, CLI      | Nunca desde la app; `users.mjs delete` con condiciones                | El operador                     |

No hay tareas programadas ni `pg_cron`: todo el mantenimiento que la app necesita lo hace
de paso en sus propias escrituras. `VACUUM` y estadísticas quedan al autovacuum por
defecto; a los tamaños esperados no requiere ajuste.

## 8. Consultas de operación

Todas son de solo lectura salvo las marcadas. Ejecutar con `psql "$DATABASE_URL"` o, con
Compose, `docker compose -p <proyecto> exec postgres psql -U acgraph -d acgraph`.

```sql
-- Estado de las migraciones (deben ser 10, ids 1..10)
select id, name, applied_at from schema_migrations order by id;

-- Cuentas y cómo entra cada una
select email, name,
       case when issuer = 'local'
            then case when password_hash is null then 'local sin contraseña' else 'contraseña' end
            else 'proveedor ' || issuer end as acceso,
       created_at
  from users
 order by created_at;

-- Sesiones vivas por persona
select u.email, count(*) as sesiones, max(s.expires_at) as expira_la_ultima
  from sessions s join users u on u.id = s.user_id
 where s.expires_at > now()
 group by u.email
 order by sesiones desc;

-- [ESCRIBE] Expulsar a alguien: sus cookies dejan de valer en la siguiente petición
delete from sessions
 where user_id = (select id from users where lower(email) = lower('ada@example.com'));

-- Diagramas por propietario, con tamaño del modelo
select u.email as propietario, d.id, d.title, d.template, d.updated_at,
       octet_length(d.model::text) as model_bytes,
       coalesce(length(d.thumbnail), 0) as thumbnail_chars
  from diagrams d join users u on u.id = d.owner_id
 order by d.updated_at desc;

-- Quién ve un diagrama
select m.role, u.name, u.email, m.created_at as desde, a.name as invitado_por
  from diagram_members m
  join users u on u.id = m.user_id
  left join users a on a.id = m.added_by
 where m.diagram_id = 'dgm_xxxxxxxxxx'
 order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end, u.name;

-- Diagramas cuyo propietario no tiene fila owner (no debería devolver nada)
select d.id, d.title
  from diagrams d
  left join diagram_members m on m.diagram_id = d.id and m.user_id = d.owner_id and m.role = 'owner'
 where m.diagram_id is null;

-- Versiones por diagrama (tope 50)
select diagram_id, count(*) as versiones, min(created_at) as mas_antigua, max(created_at) as mas_reciente
  from diagram_versions
 group by diagram_id
 order by versiones desc;

-- Cuota de la biblioteca de iconos (límites: 200 iconos, 16 MiB)
select count(*) as iconos,
       pg_size_pretty(coalesce(sum(octet_length(icon::text)), 0)::bigint) as ocupado
  from icons;

-- Hilos abiertos y totales por diagrama
select diagram_id,
       count(*) filter (where resolved_at is null) as abiertos,
       count(*) as total
  from comment_threads
 group by diagram_id;

-- Tamaño de cada tabla (datos + índices + TOAST)
select relname as tabla, pg_size_pretty(pg_total_relation_size(oid)) as total
  from pg_class
 where relkind = 'r' and relnamespace = 'public'::regnamespace
 order by pg_total_relation_size(oid) desc;

-- Conexiones de la app, por réplica y estado
select application_name, client_addr, state, count(*)
  from pg_stat_activity
 where application_name in ('ac-graph', 'ac-graph-bus')
 group by 1, 2, 3
 order by 1, 2;

-- ¿Qué réplicas escuchan el bus de colaboración? (una fila por réplica sana)
select pid, client_addr, backend_start
  from pg_stat_activity
 where application_name = 'ac-graph-bus';

-- [ESCRIBE] Limpieza manual de caducados (la app ya lo hace de paso; inofensivo repetirlo)
delete from sessions    where expires_at <= now();
delete from auth_states where expires_at <= now();
```

## 9. Copias de seguridad y restauración

La base de datos es **el único estado** del modo servidor (la presencia y los limitadores
son efímeros por diseño). Un backup lógico basta.

```bash
# Con Compose (el servicio se llama postgres; usuario y base, acgraph)
docker compose -p acgraph-foundation exec -T postgres \
  pg_dump -U acgraph -d acgraph --format=custom > acgraph-$(date +%F).dump

# Restaurar (con la app PARADA para no competir con escrituras)
docker compose -p acgraph-foundation stop app
docker compose -p acgraph-foundation exec -T postgres \
  pg_restore -U acgraph -d acgraph --clean --if-exists < acgraph-2026-09-16.dump
docker compose -p acgraph-foundation start app

# Contra cualquier DATABASE_URL (RDS a través de un bastión, etc.)
pg_dump "$DATABASE_URL" --format=custom --file acgraph.dump
pg_restore --dbname "$DATABASE_URL" --clean --if-exists acgraph.dump
```

- **Restaurar un volcado antiguo sobre una app nueva es seguro**: `schema_migrations`
  viaja en el volcado y la app aplica las migraciones que falten en el primer acceso.
- **Restaurar un volcado nuevo sobre una app antigua** puede dejar diagramas ilegibles si
  su `schemaVersion` es mayor que el que esa app conoce.
- En AWS, RDS hace snapshots automáticos; el procedimiento está en
  [`AWS.md` § Operating it](AWS.md#operating-it). Con Compose, el volumen es
  `<proyecto>_postgres-data`; detalles en [`DOCKER.md` § PostgreSQL](DOCKER.md#postgresql).
- Exportación **por usuario** desde la app (`GET /api/workspace/export`): útil para
  mover el trabajo de una persona, no como backup (no incluye miembros, hilos ni iconos).

## 10. Pruebas contra PostgreSQL

Las pruebas `*.pg.test.ts` corren solo con `TEST_DATABASE_URL` y se saltan limpiamente
sin él (`pgAvailable()`).

```bash
docker run -d --rm --name acgraph-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=acgraph_test \
  -p 127.0.0.1:55433:5432 postgres:17.11-bookworm
TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55433/acgraph_test npm test
docker stop acgraph-test-pg
```

- Cada archivo de prueba trabaja en **su propio esquema** de PostgreSQL (`testPool(schema)`
  crea `create schema if not exists <schema>` y fija `search_path` por la URL), así
  Vitest puede ejecutarlos en paralelo sin pisarse.
- `freshSchema(pool)` borra las tablas (`dropSchema`, lista en orden inverso de
  dependencias) y vuelve a correr `runMigrations`; comprueba que se aplican exactamente
  `MIGRATIONS.length`. **Al añadir una tabla, añadirla a esa lista.**
- `testEnv(schema, 'local' | 'oidc')` devuelve las variables que encienden el modo
  servidor para las pruebas de rutas; `resetServerSingletons()` limpia pool, memo del
  esquema, reloj, presencia, métricas, etc. entre archivos.
- Qué cubre cada archivo: `schema.pg.test.ts` (migraciones, idempotencia, lock),
  `diagrams/repository.pg.test.ts` (roles, revisiones, versiones, miembros, hilos,
  export/import), `icons/repository.pg.test.ts` (dedupe, cuota), `auth/password.pg.test.ts`
  (alta, login, límites), `collab/bus.pg.test.ts` (LISTEN/NOTIFY real entre dos buses),
  `api.pg.test.ts` (las rutas de punta a punta).

## 11. Capacidad y rendimiento

- **Volumen esperado**: decenas de usuarios, cientos a miles de diagramas. Un diagrama
  de 50 formas ocupa ~17 KB de `model` más una miniatura SVG; con 50 versiones, del orden
  de 1 MB por diagrama en el peor caso. Nada de esto necesita particionado.
- **Índices**: los de `diagrams (owner_id)`, `diagrams (updated_at desc)` y
  `diagram_members (user_id)` sirven al listado de la biblioteca (`list`,
  `exportWorkspace`); `diagram_versions (diagram_id, created_at desc)` al historial y a
  la poda; `sessions (expires_at)` y `auth_states (expires_at)` a los barridos;
  `icons (content_hash)` a la deduplicación. La clave primaria compuesta de
  `diagram_members` sirve al join de autorización.
- **Bloqueos**: cada escritura de diagrama toma `for update` sobre **su** fila; dos
  guardados del mismo diagrama se serializan (el segundo verá un 412 si su revisión ya
  no vale). La subida de iconos toma un lock de tabla (`share row exclusive`) breve. Las
  migraciones toman un advisory lock global solo al arrancar.
- **Timeouts**: `statement_timeout` 15 s por conexión. Un import de workspace muy grande
  (miles de versiones) podría acercarse; es la única operación con esa forma.
- **LISTEN/NOTIFY**: `pg_notify` tiene un tope de 8 000 bytes por mensaje (la app se
  queda en 7 900) y una cola compartida de 8 GB por defecto; a unas centenas de mensajes
  por segundo es irrelevante.
