# Running AC Graph on AWS

The reference deployment: one container service behind a load balancer, one
managed PostgreSQL, secrets in Secrets Manager, logs in CloudWatch, and a
GitHub Actions workflow that ships every push to `main`. Everything is
declared in [`deploy/aws/terraform`](../deploy/aws/terraform) and applied
with Terraform; nothing is clicked together in the console.

There is a step-by-step version of this page in Spanish, written for whoever
sets it up for the first time: [GUIA_RAPIDA_AWS.md](GUIA_RAPIDA_AWS.md).

## What gets created

```
browser ──HTTPS──▶ Application Load Balancer (443 with an ACM certificate; 80 → 301 to 443)
                    │  idle timeout 3600 s: the editor holds a Server-Sent Events stream
                    ▼ :3000
               ECS Fargate service, 1 task by default (512 CPU / 1024 MiB), X86_64
               image from the stack's own ECR repository
                    │  DATABASE_URL and the optional keys arrive from Secrets Manager
                    ▼ :5432, TLS verified against Amazon's RDS CA bundle
               RDS PostgreSQL 17, db.t4g.micro, gp3 20 GiB, encrypted,
               nightly backups kept 7 days, private subnets, no public address
```

| Piece             | Resource                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| Network           | VPC `10.20.0.0/16`, 2 public subnets (ALB + tasks), 2 private subnets (database), no NAT gateway       |
| Security groups   | world → ALB (80/443) → tasks (3000) → database (5432); nothing else is open                            |
| Registry          | ECR repository, scan on push, last 10 images kept                                                      |
| Compute           | ECS cluster + Fargate service with a deployment circuit breaker (a broken image rolls back on its own) |
| Database          | RDS PostgreSQL with `deletion_protection` and a final snapshot                                         |
| Secrets           | `<project>/database-url`, and `<project>/anthropic-api-key`, `<project>/metrics-token` if given        |
| Logs              | CloudWatch group `/ecs/<project>`, one JSON line per request, 30 days                                  |
| DNS + certificate | Route 53 A record and a DNS-validated ACM certificate, when `hosted_zone_id` is given                  |
| Deployments       | IAM OIDC provider for GitHub + a role that may push the one image and roll the one service             |

**Server mode is on** because the task receives `DATABASE_URL` and `APP_URL`
(see `README.md` and [AUTHENTIK.md](AUTHENTIK.md) §0). People sign in with an
e-mail and a password kept in that database. `AUTH_SIGNUP` starts `open` so
the team can create their own accounts; set it to `closed` afterwards.

Cost, on purpose: no NAT gateways (the tasks have public IPs and a security
group that admits only the load balancer), the smallest RDS class, one task.
About **45–60 USD a month** in `us-east-1` (ALB ≈ 16–20, RDS ≈ 13 + storage,
Fargate ≈ 15, the rest cents). A second task adds ≈ 15.

## Prerequisites

- An AWS account and credentials on your machine (`aws sts get-caller-identity`
  answers). The user or role applying needs to create VPC, ECS, RDS, ALB, IAM,
  ECR, Secrets Manager, CloudWatch, ACM and Route 53 resources —
  `AdministratorAccess` for the first apply is the honest answer.
- Terraform ≥ 1.6 (`brew install terraform` or from hashicorp.com).
- Docker, to build and push the first image.
- A domain name. HTTPS is not optional: the session cookie is marked `Secure`
  and browsers refuse it over plain HTTP. Either the domain's zone is in
  Route 53 (the stack does everything), or you bring an ACM certificate and
  create one CNAME by hand.

## First deployment

```bash
cd deploy/aws/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in domain_name and hosted_zone_id (or certificate_arn)
terraform init
terraform plan                                  # read it once; ~45 resources
terraform apply
```

The first `apply` takes 10–15 minutes (RDS is the slow part) and ends with the
outputs. The service comes up **unhealthy** at this point because the
repository is empty: build and push the first image with the commands the
`first_deploy_commands` output prints, then let ECS pick it up:

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ecr_repository_url>
docker build --platform linux/amd64 -t <ecr_repository_url>:latest .
docker push <ecr_repository_url>:latest
aws ecs update-service --cluster ac-graph --service ac-graph --force-new-deployment
```

Two or three minutes later `https://<domain_name>/api/health` answers `200`
and `https://<domain_name>/` shows the sign-in page. The first person to
open it creates the first account. Migrations run themselves on the first
authenticated request (advisory-locked, so several tasks may start at once).

## Deployments from GitHub

`.github/workflows/deploy-aws.yml` builds the image on every push to `main`,
pushes it tagged with the commit SHA (and `latest`), registers a task
definition revision with it, rolls the service and waits for it to settle,
then checks `/api/health`. It uses no access keys: the job assumes the role
the stack created through GitHub's OIDC provider.

The workflow stays idle until three **repository variables** exist (Settings →
Secrets and variables → Actions → Variables):

| Variable              | Value                                    |
| --------------------- | ---------------------------------------- |
| `AWS_DEPLOY_ROLE_ARN` | the `github_actions_role_arn` output     |
| `AWS_REGION`          | the `aws_region` you applied with        |
| `APP_URL`             | the `app_url` output, for the smoke test |

The role trusts only `repo:<github_repository>:ref:refs/heads/<github_branch>`
— the values in `terraform.tfvars`. If the account already has an OIDC provider
for GitHub, import it before the first apply:

```bash
terraform import 'aws_iam_openid_connect_provider.github[0]' arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com
```

Terraform owns the _shape_ of the task definition (CPU, memory, environment,
secrets) and the workflow owns the _image tag_; the service ignores changes to
its task definition revision so the two never fight. After changing an
environment variable in Terraform, `terraform apply` registers a new revision
but does **not** roll the service — run the workflow (or
`aws ecs update-service --force-new-deployment`) to pick it up.

## Operating it

**Logs.** `aws logs tail /ecs/ac-graph --follow --format short`. Every request
is one JSON line with `requestId`, `route` (the template, never an id),
`status`, `durationMs`, `userId` when signed in; the same id comes back to the
browser as `x-request-id`. `LOG_LEVEL=debug` in `service.tf` if you need more.

**Metrics.** `https://<domain>/api/metrics` is Prometheus text; set
`metrics_token` to demand a bearer token. `acgraph_logins_total{result}`,
`acgraph_sessions_created_total`, `acgraph_http_requests_total{route,status}`
are the ones to graph first. Metrics are per task.

**A shell in the running task.** `enable_execute_command` is on:

```bash
TASK=$(aws ecs list-tasks --cluster ac-graph --service-name ac-graph --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster ac-graph --task "$TASK" --container app --interactive --command sh
```

(Needs the [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
for the AWS CLI.) The image is the standalone Next build: it has Node and the
app, not the repository, so `npm run users` is run from your machine instead —
see the next point.

**Accounts from a terminal.** The database is private, so run the users CLI
from somewhere inside the VPC, or through a temporary tunnel. The simplest
honest path for a small team:

```bash
# On your machine, with the repository checked out and `npm ci` done:
export DATABASE_URL="$(aws secretsmanager get-secret-value --secret-id ac-graph/database-url --query SecretString --output text)"
# …reachable only from inside the VPC. Options, cheapest first:
#  a) temporarily set publicly_accessible = true on the RDS instance and add your IP
#     to the db security group (terraform apply, do the work, revert, apply again);
#  b) an SSM-managed bastion or an EC2 instance in a public subnet with the app security group;
#  c) AWS Client VPN.
npm run users -- list
npm run users -- create ada@example.com "Ada Lovelace"     # asks for the password
npm run users -- passwd ada@example.com
```

`sslrootcert` in the secret points at `/app/certs/rds-global-bundle.pem`, a
path inside the image; from your machine replace it with
`deploy/aws/rds-global-bundle.pem`.

**Closing sign-up.** Set `auth_signup = "closed"` in `terraform.tfvars`,
`terraform apply`, then roll the service (workflow or `--force-new-deployment`).
From then on the sign-in page only signs in; accounts come from the CLI.

**Updating the app.** Push to `main`. To ship a specific commit by hand, build
and push it with a tag and run `aws ecs update-service --force-new-deployment`
after pointing the task definition at it (the workflow's last three steps).

**Scaling.** `desired_count = 2` gives zero-blip deployments and survives a
task failure; the live-collaboration bus (`LISTEN/NOTIFY`) already spans
tasks. Bigger `container_cpu`/`container_memory` are Fargate's usual pairs
(1024/2048, 2048/4096). The database scales with `db_instance_class`; RDS
applies it in the maintenance window unless you set `apply_immediately`.

**Backups.** RDS keeps 7 nightly snapshots (`db_backup_retention_days`);
point-in-time recovery is on with them. Take a manual snapshot before a
schema-changing deployment if you want a named restore point:
`aws rds create-db-snapshot --db-instance-identifier ac-graph-db --db-snapshot-identifier before-x`.
The application also keeps every diagram's version history in the
`diagram_versions` table and can export the whole workspace as JSON from the
home page (Export).

**Rotating the database password.** Change it in RDS (`aws rds modify-db-instance
--master-user-password`), update the secret (`aws secretsmanager put-secret-value`),
roll the service. Or taint `random_password.db` and apply — Terraform rewrites
both.

**TLS between the app and the database** is `verify-full`: the image carries
Amazon's RDS CA bundle (`deploy/aws/rds-global-bundle.pem`, from
`https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`) and the
connection string names it. Refresh the file when Amazon rotates its CAs
(they announce it years ahead).

**Tearing it down.** `db_deletion_protection = false`, apply, then
`terraform destroy`. RDS takes a final snapshot (`ac-graph-db-final`) on the
way out; delete it by hand if you really mean it.

## Troubleshooting

| Symptom                                                                    | Cause and fix                                                                                                                                                              |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service stays at 0 running tasks after the first apply                     | The registry is empty. Push the first image (`first_deploy_commands` output).                                                                                              |
| Tasks start and stop every minute                                          | `aws ecs describe-services` → events; then `aws logs tail`. Usually the image cannot reach the database (security group) or `DATABASE_URL` is unreadable (execution role). |
| Health check red, logs say `server started`                                | The target group probes `/api/health` on 3000; check the container port and that the task has a public IP (no NAT).                                                        |
| Sign-in form says "The server refused the request"                         | `APP_URL` must be exactly what the browser shows (`https://<domain_name>`): the CSRF check compares origins. Change `domain_name`, apply, roll.                            |
| `self signed certificate in certificate chain` in the logs                 | The connection string's `sslrootcert` path is wrong or the bundle is missing from the image. It is copied by the Dockerfile from `deploy/aws/rds-global-bundle.pem`.       |
| GitHub workflow: `Not authorized to perform sts:AssumeRoleWithWebIdentity` | The repository variable `AWS_DEPLOY_ROLE_ARN` or `github_repository`/`github_branch` do not match the branch that pushed.                                                  |
| Certificate stuck in `PENDING_VALIDATION`                                  | With `hosted_zone_id`: the zone must be the one that serves `domain_name` publicly. Without it: validate the certificate in ACM yourself before applying.                  |

## What this stack does not do (yet)

- No WAF, no rate limiting at the edge (the app throttles sign-in attempts
  itself). Add AWS WAF to the ALB if the URL is public to the world.
- One region, one AZ for the database (`multi_az = false`). Flip it for
  production-grade availability; it doubles the RDS cost.
- No custom alarms. CloudWatch has the metrics; wire an alarm on the target
  group's `UnHealthyHostCount` and RDS `FreeStorageSpace` as a first pair.
- Sessions are in the database, so several tasks share them; the sign-in rate
  limiter is per task (by design; see `src/lib/ai/rateLimit.ts`).
