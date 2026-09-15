# Guía rápida: montar AC Graph en AWS

Para quien lo despliega por primera vez. Son unos 45 minutos, la mayoría de
espera. Todo lo que hay que crear en AWS está declarado en
`deploy/aws/terraform`; no hay que hacer clics en la consola salvo para
apuntar la cuenta y, si acaso, el dominio. La referencia completa (qué se
crea, cuánto cuesta, cómo se opera) está en inglés en [AWS.md](AWS.md).

## Qué vas a montar

- La aplicación en un contenedor (ECS Fargate) detrás de un balanceador con
  HTTPS.
- Una base de datos PostgreSQL gestionada (RDS), privada, con copias de
  seguridad diarias.
- Un repositorio de imágenes (ECR), los secretos en Secrets Manager y los
  registros en CloudWatch.
- Un despliegue automático: cada `git push` a `main` construye la imagen y la
  publica.

Coste aproximado: **45–60 USD al mes** con los valores por defecto.

La aplicación arranca en **modo servidor**: la gente entra con **correo y
contraseña** (se guardan cifradas en la base de datos). La página de acceso
permite **crear cuenta** hasta que la cierres (paso 7).

## Antes de empezar (10 min)

1. **Cuenta de AWS** con permisos de administrador para el primer despliegue y
   la CLI configurada: `aws sts get-caller-identity` debe responder con tu
   cuenta. Si no tienes la CLI: <https://aws.amazon.com/cli/>.
2. **Terraform** (≥ 1.6): en Mac `brew install terraform`; en otros sistemas
   <https://developer.hashicorp.com/terraform/install>.
3. **Docker** en marcha (Docker Desktop vale).
4. **Un dominio**, por ejemplo `graph.tuempresa.com`. HTTPS es obligatorio: la
   cookie de sesión no viaja por HTTP.
   - Si el dominio está en **Route 53**, apunta el **Hosted zone ID** (en la
     consola de Route 53 → tu zona → «Hosted zone details»). Terraform emite el
     certificado y crea el registro DNS por ti.
   - Si el DNS está en otro sitio (Cloudflare, GoDaddy…), pide un certificado
     en **AWS Certificate Manager** para ese nombre, valídalo por DNS y apunta
     su ARN. Al final crearás un registro CNAME a mano.
5. El repositorio clonado y las dependencias instaladas:
   ```bash
   git clone https://github.com/Misael-Alvarez/-ac-graph.git ac-graph
   cd ac-graph
   npm ci
   ```

## Paso 1 — Rellenar las variables (3 min)

```bash
cd deploy/aws/terraform
cp terraform.tfvars.example terraform.tfvars
```

Abre `terraform.tfvars` y cambia:

| Variable            | Qué poner                                                                          |
| ------------------- | ---------------------------------------------------------------------------------- |
| `aws_region`        | La región (por ejemplo `us-east-1`). Todo se crea ahí.                             |
| `domain_name`       | El nombre que escribirá la gente: `graph.tuempresa.com`.                           |
| `hosted_zone_id`    | El ID de la zona de Route 53. **O bien** déjalo vacío y rellena `certificate_arn`. |
| `github_repository` | `Misael-Alvarez/-ac-graph` (para que GitHub pueda desplegar).                      |
| `auth_signup`       | Deja `open` para empezar; en el paso 7 lo cierras.                                 |

El resto puede quedarse como está. No subas `terraform.tfvars` a Git (ya está
ignorado).

## Paso 2 — Crear la infraestructura (15 min, casi todo espera)

```bash
terraform init
terraform plan      # léelo por encima: unos 45 recursos, ninguno destruido
terraform apply     # escribe "yes"
```

La base de datos tarda ~10 minutos. Al terminar verás los **outputs**:
guárdalos (`terraform output` los vuelve a mostrar cuando quieras).

> El servicio aparecerá como «no saludable» porque todavía no hay ninguna
> imagen publicada. Es normal: viene en el paso 3.

## Paso 3 — Publicar la primera imagen (5 min)

Desde la raíz del repositorio, con los valores del output
`first_deploy_commands` (Terraform los imprime ya rellenos):

```bash
cd ../../..   # a la raíz del repositorio
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ecr_repository_url>
docker build --platform linux/amd64 -t <ecr_repository_url>:latest .
docker push <ecr_repository_url>:latest
aws ecs update-service --cluster ac-graph --service ac-graph --force-new-deployment
```

Dos o tres minutos después:

```bash
curl -I https://graph.tuempresa.com/api/health     # debe decir 200
```

Si `hosted_zone_id` estaba vacío, crea antes el CNAME en tu DNS:
`graph.tuempresa.com → <alb_dns_name>` (output de Terraform).

## Paso 4 — Primera entrada (2 min)

Abre `https://graph.tuempresa.com`. Verás la página de acceso. Pulsa **¿Aún no
tienes cuenta? Créala**, pon tu nombre, tu correo y una contraseña de al menos
10 caracteres. Entras directamente a la portada. Las tablas de la base de
datos se crean solas en ese primer acceso.

Cada compañero hace lo mismo desde la misma página. Para compartir un
diagrama: abrirlo → **Compartir** → «Personas» → su correo (tiene que haber
creado su cuenta antes).

## Paso 5 — Activar el despliegue automático desde GitHub (5 min)

En GitHub: **Settings → Secrets and variables → Actions → pestaña Variables →
New repository variable**, tres veces:

| Nombre                | Valor                                               |
| --------------------- | --------------------------------------------------- |
| `AWS_DEPLOY_ROLE_ARN` | el output `github_actions_role_arn`                 |
| `AWS_REGION`          | la región del paso 1                                |
| `APP_URL`             | el output `app_url` (`https://graph.tuempresa.com`) |

Desde ese momento, cada `push` a `main` ejecuta el workflow **Deploy to AWS**:
construye la imagen, la publica, la pone en marcha sin cortar el servicio y
comprueba `/api/health`. Se puede lanzar a mano en la pestaña **Actions** →
«Deploy to AWS» → **Run workflow**. No hay claves de AWS guardadas en GitHub:
el workflow entra con un rol temporal que solo puede publicar esa imagen y
reiniciar ese servicio.

## Paso 6 — Comprobar que todo funciona (5 min)

- `https://graph.tuempresa.com/api/health` → `{"status":"ok"…}` con código 200.
- Entrar, crear un diagrama, cerrar sesión (botón de salida en la cabecera),
  volver a entrar: el diagrama sigue ahí.
- Abrir el mismo diagrama en dos navegadores con dos cuentas (una invitada
  como editora): se ven los cursores y los comentarios en vivo.
- Registros: `aws logs tail /ecs/ac-graph --follow --format short`.

## Paso 7 — Cerrar el registro de cuentas (cuando el equipo ya esté dentro)

En `deploy/aws/terraform/terraform.tfvars` cambia `auth_signup = "closed"`,
luego:

```bash
cd deploy/aws/terraform
terraform apply
aws ecs update-service --cluster ac-graph --service ac-graph --force-new-deployment
```

A partir de entonces la página solo deja **entrar**. Las cuentas nuevas (o una
contraseña olvidada) se hacen desde un terminal con acceso a la base de datos
(ver «Cuentas desde el terminal» en [AWS.md](AWS.md)):

```bash
export DATABASE_URL="…"    # el secreto ac-graph/database-url, con sslrootcert apuntando a deploy/aws/rds-global-bundle.pem
npm run users -- list
npm run users -- create ana@tuempresa.com "Ana Torres"   # pide la contraseña
npm run users -- passwd ana@tuempresa.com
```

La base de datos es privada: hace falta estar dentro de la VPC (un bastión,
una VPN, o abrirla temporalmente a tu IP). Está explicado en AWS.md.

## Si algo falla

| Síntoma                                                 | Qué mirar                                                                                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terraform falla al crear el certificado                 | `hosted_zone_id` no es la zona que sirve ese dominio, o el dominio no está delegado a Route 53.                                                                  |
| El servicio no arranca / las tareas se reinician        | `aws ecs describe-services --cluster ac-graph --services ac-graph` (sección _events_) y `aws logs tail /ecs/ac-graph`. Casi siempre: no hay imagen aún (paso 3). |
| La página dice «El servidor rechazó la petición»        | `APP_URL` no coincide exactamente con lo que ves en el navegador. Corrige `domain_name`, `terraform apply` y reinicia el servicio.                               |
| «Demasiados intentos»                                   | Diez contraseñas falladas seguidas desde la misma IP; espera un par de minutos.                                                                                  |
| El workflow de GitHub falla en «Assume the deploy role» | Las variables del paso 5 no están, o `github_repository` en Terraform no coincide con el repositorio real.                                                       |
| `terraform destroy` se niega a borrar la base de datos  | Es a propósito (`db_deletion_protection = true`). Ponlo en `false`, `apply`, y entonces `destroy`. Queda una copia final `ac-graph-db-final`.                    |

## Resumen en una pantalla

```bash
# 1. variables
cd deploy/aws/terraform && cp terraform.tfvars.example terraform.tfvars && $EDITOR terraform.tfvars
# 2. infraestructura
terraform init && terraform apply
# 3. primera imagen (comandos exactos en: terraform output first_deploy_commands)
cd ../../.. && aws ecr get-login-password --region <región> | docker login --username AWS --password-stdin <ecr>
docker build --platform linux/amd64 -t <ecr>:latest . && docker push <ecr>:latest
aws ecs update-service --cluster ac-graph --service ac-graph --force-new-deployment
# 4. https://<dominio> → crear cuenta
# 5. GitHub → Variables: AWS_DEPLOY_ROLE_ARN, AWS_REGION, APP_URL
# 7. cuando el equipo esté dentro: auth_signup = "closed" → terraform apply → force-new-deployment
```
