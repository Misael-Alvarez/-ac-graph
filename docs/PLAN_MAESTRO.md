# Plan Maestro

**Producto:** AC Graph.
**Fecha:** 2026-09-08.
**Base de codigo:** `e28174b`, rama `main`.
**Estado:** plan de trabajo en ejecucion. El avance real por fase se registra en `docs/CHECKPOINTS.md`; este documento conserva el plan completo.
**Alcance de la primera entrega (2026-09-08):** analisis, instalacion de skills y documentacion. La segunda (2026-09-09) cerro F0 y la parte Docker de F1. La tercera (2026-09-09, CP3-interno) entrego el modo servidor con PostgreSQL y Authentik, la colaboracion en vivo con deteccion de conflictos, el rediseno visual, los iconos oficiales, la barra de exportacion y el registro de atajos. Siguen sin construir: editor general (F2), roles, CRDT, bus multi-replica e infraestructura AWS.

## 1. Objetivo

Convertir AC Graph en una plataforma de diagramacion que combine facilidad de dibujo, precision tecnica, trabajo en equipo y portabilidad. El diferencial no debe ser tener mas iconos: debe ser que una arquitectura pueda dibujarse, describirse como codigo, verificarse, revisarse y mantenerse actualizada desde el mismo modelo.

Tres usuarios prioritarios:

- Arquitectos y desarrolladores: C4, cloud, redes, datos, documentacion y reglas verificables.
- Analistas y equipos de producto: flujos, procesos, mapas mentales y organigramas sin conceptos cloud obligatorios.
- Equipos: compartir, comentar, revisar, recuperar versiones y editar con permisos y trazabilidad.

"La mejor plataforma" se convierte en objetivos medibles: completar tareas sin ayuda, no perder cambios confirmados, mantener fidelidad al exportar, responder con fluidez y demostrar aislamiento entre equipos. No se presenta como una superioridad competitiva ya comprobada.

## 2. Punto Actual

Ya existen Next.js 16.3.3, React 19.2.8, TypeScript, Zod, Immer, un motor SVG propio, catalogo de 572 servicios, YAML, Mermaid parcial, importadores de infraestructura, IA, analisis, reglas, CLI/MCP y multiples vistas. IndexedDB conserva diagramas e historial; no existe persistencia remota ni autenticacion real.

La comprobacion de la base en esta sesion produjo 791 pruebas aprobadas en 48 archivos, TypeScript y lint correctos. El formato falla en nueve archivos preexistentes. Build y E2E no se ejecutaron. La referencia local `origin/main` esta cinco commits por detras; no se consulto el remoto.

| Hallazgo estatico                                                                      | Consecuencia para el plan                                                                          | Referencia actual                                                                                                         |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| El autosave cancela el temporizador al desmontar y no serializa todas las escrituras   | Cerrar navegacion rapida, respuestas fuera de orden y recuperacion antes de anadir latencia remota | `src/components/app/useDiagramDocument.ts`                                                                                |
| `load` reinicia undo; hay importaciones que lo utilizan                                | Definir reemplazo seguro, confirmacion y recuperacion                                              | `src/lib/editor/reducer.ts`, `src/components/editor/DiagramEditor.tsx`                                                    |
| El modelo distingue `boundary/group/container/item`; un grupo genera una tarjeta cloud | Generalizar semantica y figuras, no agregar solo plantillas                                        | `src/lib/domain/diagram.ts`, `src/lib/engine/model.ts`                                                                    |
| Drag/resize conocen vistas, pero varias acciones y exportaciones usan el modelo base   | Unificar alcance modelo/vista/seleccion y evitar filtraciones al compartir                         | `src/lib/editor/reducer.ts`, `src/components/editor/hooks/useCommands.ts`, `src/components/editor/chrome/ShareDialog.tsx` |
| Repositorio sin revision, tenant, paginacion ni errores de conflicto                   | Evolucionar su contrato; no basta sustituir IndexedDB por `fetch`                                  | `src/lib/store/types.ts`                                                                                                  |
| Enlaces con payload completo y rate limiting IA en memoria                             | No equivalen a comparticion privada ni control de gasto distribuido                                | `src/lib/share/codec.ts`, `src/lib/ai/rateLimit.ts`                                                                       |
| CI no ejecuta E2E; sus pruebas requieren un servidor externo                           | Automatizar pruebas de navegador y contenedores                                                    | `.github/workflows/ci.yml`, `playwright.config.ts`                                                                        |

Los riesgos funcionales anteriores provienen de lectura de codigo; F0 incluye reproducirlos y fijar regresiones. No se ha realizado una auditoria visual en navegador ni una prueba de carga.

## 3. Decisiones Base

| Decision recomendada                                             | Motivo y condicion                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Conservar React, Next y SVG inicialmente                         | Reutilizar motor, exportacion, pruebas y conocimiento; evitar una reescritura sin evidencia                         |
| Registro de notaciones y estrategias de layout                   | Flowchart, ER y secuencia no comparten todas sus reglas; una notacion no es un `ViewKind`                           |
| Monolito modular con Next como web/BFF                           | Un despliegue inicial, servicios de aplicacion testeables y sin microservicios prematuros                           |
| PostgreSQL con metadatos relacionales y documento en JSONB       | Transacciones, permisos, membresias, versiones y consultas; no normalizar cada punto del dibujo                     |
| OIDC para identidad; permisos propios por workspace              | Cognito en AWS sin acoplar toda la aplicacion a sus grupos; proveedor local para Docker                             |
| Revision optimista antes de CRDT                                 | Primero varios usuarios sin sobrescrituras; luego edicion simultanea con garantias propias                          |
| Docker desde el inicio                                           | Entorno reproducible y artefacto portable, no una tarea final de empaquetado                                        |
| ECS Fargate antes que EKS                                        | Menor carga operativa para esta escala; Kubernetes solo con una necesidad demostrada                                |
| RDS y S3 fuera de los contenedores de aplicacion en AWS          | Los contenedores son reemplazables; el estado durable no puede depender de su disco                                 |
| Redis, worker y realtime por necesidad                           | Anadirlos al implementar cuotas de alto volumen, trabajos durables o colaboracion, no por apariencia de complejidad |
| Mantener editor local sin IA                                     | Cuenta y proveedor externo no deben ser requisitos para dibujar localmente                                          |
| Un formato nativo completo y conversiones con limites declarados | No prometer round-trip perfecto de YAML, Mermaid, BPMN o draw.io por defecto                                        |

PostgreSQL cambia la intencion futura de DynamoDB escrita en comentarios. La decision se debe registrar en un ADR antes de implementar. No hay datos remotos existentes que migrar de DynamoDB; si aparecen necesidades de escala concretas, se reevaluara con mediciones.

No se seleccionan a ciegas React Flow, tldraw, ELK, Yjs, un ORM o una biblioteca de autenticacion. Las pruebas de concepto verificaran licencia, mantenimiento, compatibilidad y coste de integracion. Se elegira una alternativa por responsabilidad, no varias soluciones paralelas.

## 4. Producto Frontend

### Identidad Visual

- Conservar la identidad AC Graph: neutros, acento violeta funcional, Plus Jakarta Sans y JetBrains Mono. Evolucionar los tokens, no cambiar de marca otra vez.
- El canvas es el centro. Evitar convertir el editor en un dashboard de tarjetas o llenar la pantalla de controles flotantes.
- Densidad configurable, contraste verificado y jerarquia clara; el color del proveedor no debe competir con seleccion, error o foco.
- Separar tema de interfaz, tema del documento y apariencia de exportacion. Mantener el documento coherente entre pantalla y archivo.
- Unificar botones, tooltips, formularios, menus, dialogos, tabs, skeletons y estados de error. Adoptar primitivas accesibles donde reduzcan codigo, sin reemplazar todo el sistema visual.

### Espacio De Trabajo

| Zona                     | Experiencia objetivo                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Cabecera                 | Nombre, ubicacion, revision/sincronizacion, undo/redo, colaboradores, compartir y exportar                     |
| Lateral izquierdo        | Pestanas de figuras, servicios cloud, plantillas y estructura/capas con busqueda contextual                    |
| Canvas central           | Edicion directa de texto, conexion/reconexion, guias, seleccion y herramientas predecibles                     |
| Inspector derecho        | Propiedades editables, estilos, geometria, metadatos y edicion multiple; panel redimensionable                 |
| Area de trabajo auxiliar | Codigo, insights, comentarios e historial sin superposiciones bloqueantes; apertura y cierre conservan trabajo |
| Navegacion documental    | Paginas y vistas diferenciadas, breadcrumbs, enlaces internos y modo presentacion                              |
| Biblioteca               | Recientes, favoritos, busqueda, carpetas, filtros, plantillas con preview, papelera y permisos visibles        |

No mostrar simultaneamente todos los paneles. Persistir preferencias de disposicion, ofrecer restablecerlas y garantizar un area util minima del canvas.

### Edicion General

- Figuras libres: rectangulo, rectangulo redondeado, elipse, rombo, texto, nota, imagen, linea y contenedor.
- Texto in situ, multilines, estilos y ajuste de dimensiones sin obligar a usar el inspector.
- Puertos y anclajes persistentes; flechas en ambos extremos, lineas rectas/ortogonales/curvas, etiquetas y waypoints manuales diferenciados de rutas derivadas.
- Agrupar/desagrupar, bloquear, ocultar, ordenar, capas, multiseleccion, copiar estilo, geometria numerica, alineacion y distribucion coherentes con la vista.
- Paginas para composiciones independientes; vistas para diferentes lecturas del mismo modelo. No utilizar una como sustituto de la otra.
- Mano alzada y rotacion en una entrega posterior de pizarras, con su propio presupuesto de rendimiento y exportacion.
- Clipboard, undo y cambios masivos consistentes. Una interaccion completada equivale a una operacion recuperable.

### Accesibilidad Y Dispositivos

- Objetivo WCAG 2.2 AA para interfaz y recorridos soportados; combinar pruebas automaticas con teclado y lector de pantalla.
- Foco visible, confinamiento/restauracion en dialogos, etiquetas, avisos accesibles y alternativas a acciones exclusivas de arrastre.
- Panel de estructura navegable para operar sobre nodos sin depender exclusivamente del SVG.
- ES/EN completos, `lang` correcto, fechas con `Intl`, atajos coherentes con la plataforma y documentacion generada desde el registro real de comandos.
- Desktop: experiencia completa. Tablet: edicion tactil con gestion de punteros y pinch real. Movil: biblioteca, visualizar, comentar, compartir y edicion ligera; no prometer paridad de precision con desktop en la primera version.
- Validacion a 375/390, 768, 1024 y 1440 px, zoom del navegador, safe areas, textos largos, ambos temas y movimiento reducido. Objetivos tactiles de 44 px donde corresponda.

### Rendimiento

Perfilar antes de optimizar. Separar suscripciones del documento, seleccion, viewport y preferencias para no repintar todos los paneles con cada movimiento. Cargar codigo, importadores y notaciones pesadas bajo demanda; virtualizar catalogos y listas grandes cuando lo justifique el perfil.

Usar `startTransition` y `useDeferredValue` para busqueda o resultados no urgentes cuando resulte apropiado; el seguimiento del puntero no debe retrasarse. No anadir `useMemo`/`useCallback` de forma indiscriminada. Evaluar culling de conectores, indices espaciales y workers de layout/analisis con mediciones. Una respuesta calculada para una revision antigua no debe reemplazar la actual.

## 5. Modelo Extensible

Definir un contrato versionado con estas responsabilidades, sin exigir una reescritura completa de una vez:

- Documento: identidad, version de esquema, familia/capacidades y contenido portable.
- Entidades y relaciones semanticas opcionales: servicios, clases, atributos, procesos o nodos de arbol con IDs estables.
- Representacion: figuras, texto, puertos, estilos, orden y geometria. Una figura decorativa no tiene que ser un servicio.
- Paginas y vistas: composicion, pertenencia y overrides, distinguiendo contencion visual de jerarquia semantica.
- Notacion: schema adicional, paleta, inspector, validadores, layout y capacidades de importacion/exportacion.
- Estado efimero: seleccion, cursor, paneles, presencia y viewport fuera del documento compartido, salvo preferencias explicitas.

La siguiente version del schema se asignara al cerrar F2. Separar siempre `schemaVersion`, `revision` del documento y version del protocolo de colaboracion.

**Migracion obligatoria:** fixtures de documentos antiguos, backups y enlaces existentes; preservar IDs, servicios, notas, estilos, vistas y reglas. Una version futura desconocida se rechaza o abre sin escritura, nunca se reduce silenciosamente. Mantener importacion del formato anterior porque existen datos persistidos reales.

El DSL debe conservar identidades al recompilar y declarar su cobertura. No inventar fidelidad que hoy no tiene: los formatos semanticos pueden necesitar una seccion de presentacion o un archivo nativo complementario. El diff no debe depender solamente del nombre visible de una entidad.

### Familias Y Orden

| Orden | Familia               | Soporte minimo verificable                                                                                            |
| ----- | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1     | Arquitectura y C4     | Mejorar lo existente: niveles explicitos, relaciones tipadas, metadatos, vistas, reglas y consistencia de exportacion |
| 2     | Flowchart             | Terminal, proceso, decision, documento, ramas etiquetadas, ciclos y routing util                                      |
| 3     | Mindmap y organigrama | Jerarquia semantica, hijo/hermano, reparentar, plegado y layout de arbol/radial                                       |
| 4     | ER                    | Entidades, atributos tipados, PK/FK, cardinalidades y conexiones ancladas a atributos                                 |
| 5     | UML de clases         | Compartimentos, miembros, interfaces, herencia, agregacion/composicion y multiplicidades                              |
| 6     | Secuencia             | Lifelines, orden temporal, activaciones, self-messages y fragmentos; layout especializado                             |
| 7     | BPMN                  | Subconjunto definido de tareas/eventos/gateways/pools/lanes, validacion y round-trip XML probado                      |
| 8     | Ampliaciones          | Estados, actividad, casos de uso, DFD, pizarras y bibliotecas especificas segun uso real                              |

No anunciar "UML completo", conformidad BPMN o motor de ejecucion de procesos por disponer de sus simbolos. Secuencia y BPMN requieren decisiones independientes; evaluar adaptadores especializados en lugar de forzarlos al layout de arquitectura.

## 6. Backend Objetivo

```text
Editor web / cliente autorizado
        |
Next.js: interfaz + Route Handlers/BFF
        |
Sesion verificada + autorizacion por workspace
        |
Servicios de aplicacion compartidos
        |
PostgreSQL: datos, revisiones, permisos y transacciones
        |
Adaptadores opcionales: objetos S3, trabajos, cuotas y notificaciones

Motor / dominio / DSL / importadores / reglas
        -> reutilizados por web, servidor y CLI/MCP locales
```

Los servicios iniciales son modulos en el mismo proceso, no microservicios de red. Los handlers se encargan del transporte; los servicios aplican permisos e invariantes; los adaptadores realizan I/O. Mantener el motor libre de navegador y de credenciales.

### Datos E Identidad

- Workspace como frontera tenant, incluido el espacio personal. Usuarios, identidades OIDC, sesiones, membresias e invitaciones.
- Roles iniciales: propietario, administrador, editor, comentarista y lector, con matriz explicita de permisos.
- Diagramas y carpetas con `workspaceId`; modelo JSONB, revision monotona y metadatos consultables.
- Snapshots/checkpoints, publicaciones, comentarios, assets, auditoria e idempotencia con referencias consistentes.
- Indices por tenant y orden de listado; paginacion por cursor. El historial lista metadatos y descarga el contenido bajo demanda.
- PostgreSQL con consultas parametrizadas, limites de pool y transacciones cortas. RLS como defensa adicional, rol sin bypass y contexto local a la transaccion para evitar fugas en el pool.
- OIDC Authorization Code con PKCE mediante biblioteca mantenida. Vincular identidad por issuer/subject, no por email. Sesiones revocables; cookies seguras/HttpOnly; tokens fuera de localStorage.
- Autorizacion en cada lectura, mutacion, exportacion, version, asset, llamada IA y canal realtime. Ocultar controles o validar solo en layout/proxy no proporciona seguridad.
- Invitaciones de un uso y expirables, recuperacion y MFA mediante el proveedor, auditoria de cambios de permisos y revocacion de sesiones.

El perfil local y el campo `meta.owner` de un servicio arquitectonico no son identidades autenticadas ni autorizan acceso.

### Contrato Documental

| Operacion        | Garantia propuesta                                                                    |
| ---------------- | ------------------------------------------------------------------------------------- |
| Listar/leer      | Tenant autorizado, paginacion, revision actual y capacidades efectivas                |
| Guardar          | Revision esperada, ID de mutacion idempotente, validacion y confirmacion atomica      |
| Renombrar        | Actualizacion acotada; no reescribir inadvertidamente el JSON del diagrama            |
| Crear checkpoint | Marcar la revision actual confirmada; distinguirlo de autosnapshot anterior al cambio |
| Restaurar        | Nueva revision desde snapshot, sin rebobinar el contador ni eliminar historia         |
| Importar         | Validacion previa, ID de migracion, correspondencia de IDs y resultado verificable    |
| Eliminar         | Papelera y politica de purga; coordinar publicaciones, assets y retencion             |

Usar `If-Match` o una precondicion equivalente: ausencia `428`, revision obsoleta `412`. La revision no es un timestamp. Dos clientes con la misma revision no pueden confirmar ambos una sustitucion completa.

Actualizar documento, snapshot necesario, idempotencia y auditoria en una transaccion. No mantener transacciones abiertas mientras responde un proveedor IA o S3. La miniatura deriva de una revision y no debe sobrescribir el modelo ni una miniatura mas nueva.

### Guardado Y Migracion

- Un coordinador por documento: una escritura en vuelo, pendiente mas reciente, reintentos con backoff y errores tipados.
- Estados diferenciados: cambiado, guardado localmente, sincronizando, sincronizado, sin conexion, conflicto y error. No llamar "guardado" a una edicion aun pendiente.
- Persistir borradores durante la edicion y proteger navegacion. No confiar en terminar una peticion de red durante el cierre de una pestana; si falla la persistencia local, avisar y ofrecer exportar.
- En conflictos, conservar ambas versiones y permitir comparar/copiar/resolver. No sobrescribir silenciosamente.
- Migrar IndexedDB desde el navegador con consentimiento, backup, workspace destino y deduplicacion. Conservar el original hasta verificar documentos, versiones, reglas y vistas.
- El almacenamiento depende del origen web: cambiar de localhost a un dominio requiere exportar/importar o un puente explicito desde el origen anterior.
- Separar borradores por cuenta/workspace; logout o cambio de usuario nunca reenvian cambios con la identidad nueva. Sincronizacion offline completa queda para la etapa colaborativa.

### Comparticion Y Assets

Tres modos diferentes: privado con ACL; enlace de lectura revocable; archivo portable no revocable. Un enlace actual con payload no es privado ni cifrado.

Publicar un snapshot de una revision confirmada, con seleccion explicita de vista y metadatos. Eliminar realmente datos excluidos del payload, no esconderlos mediante CSS. Tokens aleatorios de alta entropia almacenados con hash, expiracion, revocacion y auditoria.

Aplicar permisos a visor, JSON, SVG y descargas. Evitar cache publica inmutable en contenido revocable. Definir el limite de revocacion de cualquier URL prefirmada y dejar claro que no se recuperan copias ya descargadas.

Assets en almacenamiento S3 compatible, claves por tenant y descargas autorizadas. Limites de bytes, tipo real, dimensiones y complejidad; saneamiento de SVG y tratamiento seguro de archivos hostiles. Ninguna importacion de Terraform ejecuta Terraform; ningun render debe cargar URLs arbitrarias con acceso a la red interna.

### IA E Integraciones

- Mantener Anthropic como primer proveedor y contratos propios finos; no crear una abstraccion multiproveedor grande sin un segundo caso concreto.
- Mostrar propuesta/diff antes de aplicar cambios; seleccionar contexto y mantener una operacion de undo. No reemplazar indiscriminadamente el documento completo.
- Validar estructura, referencias, notacion y limites. Tratar texto importado como datos, no como instrucciones autorizadas para el agente.
- Cuotas por usuario/workspace, presupuesto de gasto, reservas atomicas, cancelacion y telemetria sin prompts completos por defecto. Fallar cerrado para IA si no se pueden verificar cuotas, sin bloquear el editor.
- Imports con preview y advertencias. Reimportacion de infraestructura con procedencia e IDs externos estables para comparar cambios sin borrar anotaciones manuales.
- Integracion Git/PR para DSL, diff y reglas, seguida de una GitHub App con scopes minimos y webhooks verificados si hay demanda.
- Publicar CLI/MCP con nombre, version, runtime soportado y pruebas de instalacion limpia. El MCP remoto futuro consume recursos autorizados, no expone rutas arbitrarias del filesystem del servidor.
- Diferenciar comparacion contra IaC de drift real de recursos desplegados. Este ultimo exige conectores cloud read-only, permisos y una fase especifica.

## 7. Docker Y AWS

### Entorno Local

Contrato objetivo: un clon limpio puede levantar la plataforma de desarrollo con Docker Compose, sin instalar PostgreSQL ni credenciales AWS en el host. El editor debe funcionar sin una clave de IA.

| Componente               | Desarrollo/self-hosting                                       | AWS                                                    |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------------------------ |
| Web/BFF                  | Imagen Node/Next                                              | ECR + servicio ECS Fargate                             |
| Base de datos            | PostgreSQL y volumen                                          | RDS PostgreSQL privado                                 |
| Identidad                | Perfil OIDC local, inicialmente Keycloak, o issuer externo    | Cognito u otro OIDC aprobado                           |
| Entrada HTTPS            | Proxy inverso para self-hosting; localhost en desarrollo      | ALB + ACM + DNS                                        |
| Objetos                  | Perfil de almacenamiento S3 compatible, con licencia revisada | S3 privado                                             |
| Cuotas/presencia rapidas | Redis opcional                                                | ElastiCache si se necesita                             |
| Trabajos                 | Worker opcional y cola durable inicial en PostgreSQL          | Servicio/tarea ECS; SQS solo si se adopta su adaptador |
| Colaboracion             | Proceso realtime tras F7                                      | Servicio ECS especifico tras F7                        |
| Correo                   | Capturador SMTP local cuando se incorporen invitaciones       | SES o proveedor elegido                                |

"Todo contenerizado" significa que la aplicacion y sus dependencias locales se pueden ejecutar de forma reproducible. En AWS se recomienda sustituir PostgreSQL y almacenamiento locales por servicios gestionados, no ejecutar una base de produccion en un contenedor efimero. Anthropic/Cognito son servicios externos, no componentes que se puedan empaquetar dentro de la imagen.

### Artefactos Previos

Archivos a crear en las fases de implementacion, no presentes por este plan:

- `Dockerfile` multi-stage: dependencias, build y runtime con artefactos minimos.
- `.dockerignore`: excluir Git, skills, secretos, outputs locales, coverage y material no necesario para compilar.
- `compose.yaml`: base reproducible y dependencias necesarias; perfiles opcionales declarados.
- `compose.dev.yaml`: desarrollo/hot reload y herramientas locales.
- `compose.selfhost.yaml`: imagen de produccion, TLS, limites, politicas de reinicio y configuracion sin valores inseguros por defecto.
- `.env.example` versionado y documentacion diferenciada entre variables publicas de build y secretos de runtime.
- Migraciones SQL y tarea de migracion controlada; comandos de backup/restauracion y smoke tests.
- `infra/terraform/`: ambientes separados, variables, outputs, estado remoto protegido y runbooks AWS.

### Garantias Del Contenedor

- `output: 'standalone'`, incluyendo `public` y `.next/static`. Consultar siempre las guias de la version Next instalada.
- Base Node LTS soportada por app y CLI, fijada por version/digest; compatibilidad Linux amd64/arm64 validada, no asumida por funcionar en macOS.
- No root, permisos minimos, limites de recursos y filesystem de solo lectura donde resulte compatible; caches/tmp explicitos y efimeros.
- Secretos fuera de imagen y build args. BuildKit secrets cuando el build los necesite. No incluir `.env.local` en ninguna capa.
- Imagen construida una vez y promovida por digest. Los `NEXT_PUBLIC_*` quedan fijados en build; configuracion variable por entorno debe resolverse por un mecanismo de runtime adecuado.
- Readiness y liveness diferentes, cierre ordenado con SIGTERM y prueba de reinicio. Una caida de IA no debe reiniciar el editor sano.
- Migraciones como tarea unica antes del cambio de trafico, no una carrera en cada replica. Cambios expand/contract compatibles con rollback de aplicacion.
- Misma version de despliegue entre replicas, version skew y cache de Next contemplados. No cachear informacion privada entre usuarios.
- SBOM, escaneo de dependencias/imagen y secretos. Volumen persistente no equivale a backup.

### Topologia AWS

```text
DNS + TLS
    |
ALB (+ WAF segun politica de exposicion)
    |
ECS Fargate: web/BFF [replicas segun SLO]
    |                         |
RDS PostgreSQL privado        S3 privado
    |
Worker / realtime / Redis solamente si la fase los requiere

OIDC: Cognito
Secretos: Secrets Manager o Parameter Store segun sensibilidad
Observabilidad: OpenTelemetry + CloudWatch
Entrega: GitHub Actions OIDC -> ECR -> ECS
```

Terraform debe cubrir red, security groups, roles por tarea, certificados, secretos referenciados, registro de imagen, servicios, DB, buckets, alarmas y backups. Credenciales AWS temporales en CI mediante OIDC; no claves permanentes guardadas en GitHub.

Base de datos sin exposicion publica. Elegir salida por NAT/endpoints segun conectividad y coste; la app necesita acceso autorizado al proveedor IA/OIDC. Limitar el pool considerando el numero maximo de tareas, no solo una instancia.

Preparar staging desde F1/F4 y endurecer produccion en F8. Aplicar Terraform y crear recursos con coste requiere aprobacion explicita de cuenta, region y presupuesto; este documento no ejecuta un despliegue.

## 8. Colaboracion

La primera version multiusuario incluye permisos, comentarios, checkpoints y conflictos detectados. Eso no significa que dos personas puedan arrastrar el mismo nodo simultaneamente sin conflicto.

Para edicion simultanea, hacer un spike CRDT con una implementacion mantenida, inicialmente Yjs como candidato. Validar antes de decidir:

- IDs estables al crear, importar, recompilar YAML y aceptar una propuesta IA.
- Una sola autoridad de escritura: no competir entre autosave JSON completo y updates CRDT.
- Undo por contribucion local; no aplicar parches posicionales antiguos sobre cambios ajenos.
- Presencia y cursores efimeros separados de cambios durables.
- Salas autorizadas por documento/tenant, revocacion durante conexion y limites por mensaje.
- Reconexion, eventos duplicados/fuera de orden, compactacion, checkpoints y recuperacion tras caida del proceso.
- Politica explicita para borrar, mover, reparentar y editar texto concurrentemente.
- Redis Pub/Sub no es un log durable. El servidor confirma solo cuando cumple la garantia de persistencia definida.

Un spike fallido no autoriza a presentar "colaboracion en tiempo real". Mantener el modo multiusuario con control optimista hasta superar las pruebas.

## 9. Fases Y Checkpoints

Duraciones orientativas por frente con dedicacion relevante, no sumas automaticas ni fechas comprometidas. Los trabajos en paralelo dependen de cerrar primero los contratos comunes. Estado por checkpoint en `docs/CHECKPOINTS.md`: CP0 cerrado, CP1 cerrado en su parte Docker y abierto en diseno/ADR, el resto **pendiente**.

| Fase | Prioridad           | Entrega                                      | Dependencias                     | Ventana orientativa                          | Responsable principal        |
| ---- | ------------------- | -------------------------------------------- | -------------------------------- | -------------------------------------------- | ---------------------------- |
| F0   | P0                  | Base confiable y regresiones                 | Ninguna                          | 1-2 semanas                                  | Full-stack + QA              |
| F1   | P0                  | Sistema UX, contratos y Docker base          | F0 baseline                      | 2-3 semanas                                  | Frontend/diseno + plataforma |
| F2   | P0                  | Modelo extensible y editor general           | Contratos F1                     | 4-6 semanas                                  | Frontend/motor               |
| F3   | P0                  | Backend multiusuario y sincronizacion        | Contratos F1; F0 guardado        | 4-6 semanas, paralelo a F2                   | Backend                      |
| F4   | P1                  | Producto de equipo y distribucion            | F2 + F3                          | 3-4 semanas                                  | Full-stack                   |
| F5   | P1                  | Arquitectura profesional e interoperabilidad | F2; F3 para cuotas               | 3-5 semanas, solapable con F4                | Motor/integraciones          |
| F6   | P1                  | Familias generales estructuradas             | F2; exportacion F4               | 4-8 semanas por lotes                        | Frontend/motor + QA          |
| F7   | P1                  | Edicion simultanea y offline controlado      | Identidad estable F2 + F3/F4     | 4-6 semanas                                  | Backend/realtime + frontend  |
| F8   | P0 para lanzamiento | AWS y operacion de produccion                | Release candidato; base desde F1 | 2-4 semanas finales, trabajo continuo previo | Plataforma + QA              |
| F9   | P2                  | Enterprise y notaciones avanzadas            | V1 medida en uso                 | 6-12 semanas por lote elegido                | Producto + equipo            |

### F0: Confianza

- Reproducir autosave, navegacion antes del debounce, cuota local agotada, respuestas invertidas, error de parseo y reemplazo del modelo.
- Implementar guardado local recuperable y ordenar mutaciones; proteccion de acciones destructivas.
- Corregir coherencia modelo/vista/seleccion, incluyendo exportacion y aviso de contenido compartido.
- Cerrar nueve problemas de formato preexistentes y versionar el ejemplo de entorno sin secretos.
- Hacer E2E autocontenidos en CI, fijar runtime y establecer fixtures de migracion y benchmark.

**CP0:** unitarias, tipos, lint, formato, build y E2E criticos verdes desde un clon limpio. Navegacion y errores no pierden cambios ya confirmados; cambios pendientes no se anuncian como persistidos.

### F1: Fundaciones

- Disenar recorridos y prototipos de biblioteca, editor, inspector, importacion y compartir; validar con usuarios representativos.
- Documentar tokens y componentes, responsive y accesibilidad sin rehacer la marca.
- Spike de una semana para SVG/layout: flowchart ciclico, ER con puertos por atributo y secuencia pequena. Comparar esfuerzo, exportacion y rendimiento.
- ADR de modelo, PostgreSQL/OIDC, revisiones y alcance de publicacion. Prototipo temprano de identidad/undo colaborativo para no hipotecar F7.
- Imagen standalone, Compose base y perfiles; preparar PostgreSQL local y smoke del contenedor antes de terminar el backend.

**CP1:** decisiones registradas, prototipos revisados y aplicacion actual ejecutable en Docker con assets, rutas IA deshabilitables y embed funcional. No se requiere AWS para desarrollar.

### F2: Editor General

- Implementar migradores y registro de capacidades/notaciones.
- Figuras libres, puertos, texto in situ, inspector multiple, estilos, agrupacion, estructura/capas y geometria editable.
- Unificar acciones por alcance e incorporar paginas sin confundirlas con vistas.
- Flowchart como primera familia general completa; paleta contextual y plantillas propias.
- Optimizar los cuellos medidos, completar operaciones por teclado y soporte tablet prioritario.

**CP2:** crear, editar, guardar, deshacer y exportar un flowchart sin tarjetas cloud forzadas. Fixtures antiguos conservan datos, estilos, vistas y reglas. Importacion de version desconocida nunca sobrescribe silenciosamente.

### F3: Backend Real

- Implementar tablas, migraciones, servicios de aplicacion, adaptador PostgreSQL y cliente HTTP.
- OIDC, sesiones, workspaces, roles, invitaciones y autorizacion en cada operacion.
- Revisiones optimistas, idempotencia, checkpoints y restauracion transaccional.
- Integrar coordinador de guardado, errores tipados y migracion local con consentimiento.
- Pruebas de contratos contra IndexedDB y PostgreSQL, con diferencias de capacidad explicitas.

**CP3:** dos clientes que parten de una revision no se sobrescriben; reintentar tras perder la respuesta no duplica operaciones. Pruebas negativas de lectura/escritura/historial entre tenants pasan. Migracion local puede reanudarse sin duplicar ni borrar originales.

### F4: Equipo Y Portabilidad

- Biblioteca con carpetas, favoritos, papelera, filtros y paginacion; administracion de miembros y permisos.
- Comentarios anclados a figuras/revision, menciones, resolucion y notificaciones basicas.
- Publicaciones privadas o por enlace revocable; previews que muestran exactamente los datos incluidos.
- Importacion unificada con preview y advertencias, opcion nuevo/reemplazar y recuperacion.
- Exportacion nativa, SVG/PNG y PDF/impresion con alcance, tema y calidad; Mermaid con cobertura declarada.
- Adjuntos S3, politicas de retencion y primera distribucion CLI/MCP instalable. Completar perfil self-hosting con auth y backups.

**CP4:** un equipo crea, encuentra, comenta, restaura y publica un documento. Revocar impide nuevas lecturas de visor, JSON y SVG segun politica de cache; exportar una vista no incluye datos ocultos. El paquete nativo vuelve a abrirse sin perdidas.

### F5: Arquitectura Diferencial

- Mejorar C4, vistas de despliegue/datos/seguridad y relaciones tipadas sin forzar semantica cloud sobre figuras generales.
- Editor y diagnosticos de reglas, pruebas de reglas inertes y ejecucion consistente en UI, CLI y CI.
- Catalogo con procedencia/licencias de iconos, lista maestra versionada, plantillas verificadas y equivalencias cloud explicadas como aproximaciones cuando lo sean.
- Mejorar importadores con fixtures reales, cobertura declarada y reimportacion con diff; HCL no se anuncia como evaluador completo de Terraform.
- IA con preview/diff, contexto autorizado, cuotas compartidas y presupuesto; el editor sigue operativo cuando IA falla.
- Primera integracion Git/PR y documentacion de metadatos, vistas, reglas y formatos.

**CP5:** un caso de referencia IaC -> modelo -> vistas -> reglas -> diff/PR -> exportacion pasa end-to-end. UI/CLI producen hallazgos equivalentes para el mismo modelo; la IA no modifica sin validacion y consentimiento.

### F6: Notaciones Generales

- Lote A: mindmap y organigrama con jerarquia, reparentado, plegado y layout.
- Lote B: ER y UML de clases con atributos/miembros estables, cardinalidades y relaciones especificas.
- Lote C: secuencia con layout temporal y cobertura declarada; comienza como beta si su spike revela limites.
- Ampliar accesibilidad, miniaturas, clipboard, plantillas, importacion/exportacion y tests por cada notacion.

**CP6:** cada familia publicada supera crear -> editar -> undo -> guardar -> recargar -> exportar, con fixtures semanticos y visuales. Renombrar o reordenar atributos no rompe relaciones. Un simbolo nuevo sin estas garantias no cuenta como familia terminada.

### F7: Colaboracion

- Implementar la decision CRDT del spike, protocolo versionado y proceso realtime cuando se justifique.
- Presencia, cursores, permisos activos, sincronizacion durable y checkpoints compatibles.
- Undo local en documento compartido, conflictos semanticos y tratamiento de reemplazos por DSL/IA.
- Borradores offline, reconexion y cambio de cuenta seguros; compactacion y recuperacion.

**CP7:** tres clientes concurrentes, uno desconectado temporalmente, convergen tras reconectar. Reiniciar el servidor no pierde updates confirmados. Undo no borra aportaciones ajenas y revocar permisos corta la capacidad de editar.

### F8: Produccion AWS

- Completar Terraform, staging/produccion aislados, pipeline por digest, OIDC CI y migracion previa al despliegue.
- Revisar multiinstancia Next, conexiones DB, limites, autoscaling y cache de publicaciones.
- Pruebas de seguridad/carga, observabilidad, dashboards, alertas y respuesta a incidentes.
- Backups, PITR, restauracion ensayada y rollback de aplicacion con esquema compatible.
- Documentar costes estimados con carga real y aceptar presupuesto antes de crear produccion.

**CP8:** release candidato desplegado en staging autorizado, smoke/migracion/restore/rollback probados, sin hallazgos criticos abiertos y con responsables operativos. F8 es requisito de disponibilidad general, no una tarea opcional posterior al lanzamiento.

### F9: Expansion

- BPMN interoperable tras evaluar un adaptador especializado y su licencia; no incluir ejecucion de procesos por defecto.
- Importacion draw.io priorizada por casos reales y reporte de fidelidad; evaluar Visio/PlantUML despues, no prometer soporte completo inicial.
- Pizarras, mano alzada, formas propias, librerias de equipo y extension mediante adaptadores seguros.
- SSO empresarial/SCIM, auditoria avanzada, aprobaciones, retencion y politicas organizacionales.
- Facturacion/entitlements si se elige SaaS comercial, con webhooks idempotentes, cuotas y limites transparentes.
- Conectores cloud read-only para drift real; API publica con tokens acotados, webhooks y gobierno de integraciones.

**CP9:** cada lote tiene demanda validada, alcance y pruebas propios. Las extensiones no incorporan ejecucion arbitraria en el navegador o servidor ni comprometen portabilidad/licencias.

## 10. Calidad Y Operacion

### Metricas Propuestas

Son metas a calibrar en F0/F1, no rendimiento actual ni SLA contractual. Fijar hardware, navegador, red, dataset y concurrencia para comparar resultados.

| Area           | Objetivo inicial y metodo                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activacion     | Al menos 80% de una muestra de cinco usuarios representativos completa crear un flujo, guardarlo y compartirlo sin ayuda; registrar tiempo y errores |
| Integridad     | Cero perdidas de cambios confirmados en la matriz de fallos; 100% de fixtures nativos soportados conservados tras migracion                          |
| Interaccion    | Fixture de 200 nodos/400 relaciones: feedback de edicion p95 <= 50 ms y pan/zoom objetivo >= 50 FPS en equipo de referencia                          |
| Escala         | Fixtures adicionales de 1.000 y 5.000 nodos para encontrar limites; no anunciar soporte ilimitado si no pasan                                        |
| API            | Lectura/guardado p95 <= 500 ms para documentos <= 500 KB y 50 escritores concurrentes en staging, excluyendo proveedor IA; recalibrar segun medidas  |
| Accesibilidad  | Sin fallos graves/criticos automaticos en recorridos y sin bloqueos manuales de teclado/lector; WCAG no se certifica con axe solamente               |
| Disponibilidad | Objetivo inicial de produccion 99,9% mensual, condicionado a topologia y presupuesto aceptados                                                       |
| Recuperacion   | Objetivo inicial RPO <= 15 min y RTO <= 2 h para modo gestionado, demostrado con simulacro; self-hosting declara su propio nivel                     |
| IA             | Gasto y cuota trazables por workspace, cortes verificables y cero uso de datos de otro tenant                                                        |

### Matriz De Pruebas

- Unitarias y propiedades del modelo: IDs, referencias, ciclos de contencion, migracion, operaciones y serializacion. Los ciclos de relaciones pueden ser validos.
- Integracion PostgreSQL real: autorizacion, RLS, concurrencia, idempotencia, rollback y migraciones.
- E2E: Chromium, Firefox y WebKit para recorridos criticos; viewport/touch, dark/light, ES/EN y teclado.
- Regresion visual del canvas y exportaciones; fixtures por notacion y casos de texto largo/fuentes/iconos.
- Fallos: offline, storage lleno, doble pestana, respuesta perdida tras commit, peticiones invertidas, caida de worker/realtime y cambio de permisos.
- Seguridad: IDOR entre tenants, CSRF, sesiones, XSS/SVG, descompresion limitada, payloads enormes, SSRF, tokens compartidos, cuotas IA y dependencias.
- Imagen: build limpio, assets presentes, usuario no root, arranque saludable, SIGTERM, reinicio y restauracion de volumen/backup.

La pipeline no debe marcar el producto listo por mantener un numero de tests. Debe ejecutar los recorridos y fallos asociados a cada nueva garantia.

### Observabilidad Y Backups

Logs estructurados, trazas OpenTelemetry y correlacion de peticion/mutacion/job. Medir latencias, errores, conflictos, pendientes antiguos, pools DB, edad de cola y gasto IA. No usar IDs arbitrarios como etiquetas metricas de cardinalidad ilimitada.

No registrar documentos, cookies, tokens de enlace o prompts completos por defecto. Auditoria de acciones sensible separada de diagnostico, con acceso y retencion limitados.

RDS con backup/PITR; self-hosting con backups fuera del host y WAL si exige el RPO. S3 con versionado/retencion coherentes. Simular recuperacion de un workspace sin rebobinar todos; contemplar revocacion de sesiones/enlaces tras restaurar un estado anterior. Historial de documento y backups son mecanismos distintos.

Estimar por separado coste fijo de DB/ALB/conectividad, replicas, objetos/versiones, observabilidad y consumo IA. No incorporar Redis o workers permanentes sin una necesidad y presupuesto. No hay datos suficientes para una cifra AWS fiable hoy.

## 11. Ejecucion Inicial

Primer sprint propuesto de diez dias laborables; ajustar al tamano real del equipo. No significa que este trabajo se haya iniciado.

| ID  | Prioridad | Trabajo                                           | Evidencia de cierre                                                   |
| --- | --------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| T01 | P0        | Baseline reproducible, formato, entorno y runtime | Clon limpio ejecuta checks y documenta limites                        |
| T02 | P0        | Regresiones de autosave y coordinador local       | Navegacion rapida, respuestas invertidas y fallo de storage cubiertos |
| T03 | P0        | Reemplazos/importacion JSON seguros               | Archivo invalido no cambia el documento; reemplazo recuperable        |
| T04 | P0        | Contrato y pruebas de alcance de vistas           | Alinear/encuadrar/exportar/compartir respetan su alcance declarado    |
| T05 | P0        | E2E gestionados por CI                            | Servidor de pruebas automatico y recorridos criticos reproducibles    |
| T06 | P0        | Benchmark del canvas y exportacion                | Dataset y baseline publicados, no una cifra inferida                  |
| T07 | P0        | Prototipo de shell e inspector                    | Recorridos desktop/tablet/mobile revisados y backlog de accesibilidad |
| T08 | P0        | Spike modelo/layout e identidad                   | ADR con migracion, puertos y restricciones CRDT                       |
| T09 | P0        | Docker standalone y Compose base                  | Arranque limpio sin dependencias locales salvo Docker                 |
| T10 | P0        | ADR de datos/auth/guardado                        | Contrato revisado y pruebas de concurrencia/tenant definidas          |

No cerrar T02 por agregar solamente `beforeunload`: persistir borradores y comprobar fallos es parte del trabajo.

### Dependencias Y Calendario

Ruta principal: F0 -> contratos F1 -> F2 y F3 en paralelo -> F4 -> F7 -> F8. F5 y los lotes F6 se incorporan sin bloquear la base; Docker empieza en F1 y AWS se prepara progresivamente, no al final.

Con dos desarrolladores senior full-stack, apoyo de diseno y QA, una beta profesional con arquitectura, flowchart y backend seguro puede presupuestarse inicialmente en **12-18 semanas**. Una V1 colaborativa con los lotes generales prioritarios y operacion de produccion necesita aproximadamente **24-36 semanas**, sujeto a los spikes de motor/CRDT. La vision avanzada es un programa de **9-12 meses o mas**, no una promesa de completar todos los estandares en un sprint.

Un unico desarrollador no debe asumir las mismas fechas. IA y skills ayudan a ejecutar, pero no eliminan validacion, migraciones, pruebas de usuario y operacion. Reestimar tras CP1 y despues de las primeras mediciones reales.

### Definicion De Terminado

Una entrega esta terminada cuando tiene recorrido usable, persistencia/migracion, permisos, errores y recuperacion, accesibilidad del alcance soportado, pruebas, documentacion y observabilidad pertinente. Una notacion necesita ademas fidelidad de exportacion. Una entrega de infraestructura necesita restauracion y rollback, no solo un contenedor que arranca.

Tras cada fase crear un checkpoint versionado con: commit base/final, alcance, decisiones, pruebas realmente ejecutadas, resultados, limitaciones y siguiente tarea exacta. No marcar una fase completa basandose solo en su commit o en una captura de pantalla.

### Decisiones Del Usuario

Este plan usa valores recomendados para no bloquear su entrega. Antes de comprometer costes o fechas confirmar:

- Equipo disponible, presupuesto operativo y si el objetivo inicial es SaaS, self-hosting o ambos. Recomendacion: ambos mediante la misma imagen; una instalacion de referencia mantenida por el equipo.
- Arquitectura y flowchart como primeras familias; elegir ER o mindmap como siguiente lote segun usuarios reales.
- Region AWS, residencia de datos y requisitos legales; sin region asumida ni recursos creados.
- Usuarios concurrentes, tamanos de diagramas, retencion, disponibilidad y gasto IA aceptables.
- Licencia del producto, condiciones de iconos/adaptadores y necesidades de facturacion empresarial.

## 12. Skills Y Fuentes

Se instalaron cuatro skills a nivel de proyecto en `.agents/skills/`, con procedencia y hashes en `skills-lock.json`. No son dependencias del runtime. La skill UI/UX ya existia y no se duplico.

| Skill                              | Fuente                         | Uso aplicado al plan                                                                      |
| ---------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `ui-ux-pro-max`                    | Existente en `.claude/skills/` | Consulta de sistema visual, accesibilidad, touch y estado React                           |
| `vercel-react-best-practices`      | `vercel-labs/agent-skills`     | Suscripciones acotadas, carga diferida y presupuestos de rendimiento                      |
| `web-design-guidelines`            | `vercel-labs/agent-skills`     | Foco, teclado, formularios, gestos alternativos, i18n y estados de error                  |
| `supabase-postgres-best-practices` | `supabase/agent-skills`        | Aislamiento tenant, RLS, pooling, esquema y transacciones; no obliga a contratar Supabase |
| `multi-stage-dockerfile`           | `github/awesome-copilot`       | Separacion build/runtime, minimo privilegio y artefactos reproducibles                    |

Antes de instalar se consultaron fuentes, contenido y popularidad: aproximadamente 698K, 618K, 392K y 23,4K instalaciones respectivamente segun skills.sh; repositorios con aproximadamente 31K, 2,6K y 38,8K estrellas segun GitHub. Estas cifras cambian y no constituyen auditoria de seguridad. `awesome-copilot` contiene aportaciones comunitarias, no una garantia formal de GitHub.

La consulta automatica de UI/UX sugirio tambien tipografia sobredimensionada y estructura de landing. Se descarto para el editor por no encajar con una herramienta densa ni con la identidad existente. Las recomendaciones de skills se contrastan con el proyecto y con las guias locales de Next; no se aplican mecanicamente. El contenido de terceros en `.agents/skills` se excluye de Prettier para no reescribirlo ni alterar sus hashes.

Las skills nuevas se leyeron para elaborar este plan. Reiniciar OpenCode para que su descubrimiento automatico en sesiones posteriores recoja la instalacion; no hace falta reinstalarlas globalmente.

Fuentes consultadas:

- [Directorio de skills](https://skills.sh/).
- [React de Vercel](https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices).
- [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).
- [PostgreSQL de Supabase](https://skills.sh/supabase/agent-skills/supabase-postgres-best-practices).
- [Docker multi-stage](https://skills.sh/github/awesome-copilot/multi-stage-dockerfile).
- [Docker: multi-stage builds](https://docs.docker.com/build/building/multi-stage/).
- [AWS: Fargate para ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html).
- Guia local Next: `node_modules/next/dist/docs/01-app/02-guides/self-hosting.md`.
- Guia local Next: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`.

No se encontro el estudio de mercado citado por commits anteriores. Este plan deriva del codigo actual, el objetivo del usuario y las fuentes tecnicas anteriores; no atribuye prioridades a un estudio que no se ha podido consultar.
