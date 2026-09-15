# AC Graph on AWS: one container service behind a load balancer, one managed
# PostgreSQL, secrets where secrets go, logs where logs go.
#
#   browser ──HTTPS──▶ ALB (443, ACM certificate; 80 redirects)
#                       │
#                       ▼ 3000
#                  ECS Fargate service (the Docker image from ./Dockerfile)
#                       │
#                       ▼ 5432, TLS verified with Amazon's CA bundle
#                  RDS PostgreSQL 17 (private subnets, no public address)
#
# The app needs two settings to run in server mode — DATABASE_URL and APP_URL —
# and both are produced here: the URL from the domain, the connection string
# from the database this stack creates, handed to the task as a secret.
#
# Cost, on purpose: no NAT gateways (the tasks sit in public subnets with a
# public IP and a security group that admits only the load balancer), the
# smallest RDS class, one task. Roughly 45–60 USD a month in us-east-1.

locals {
  name    = var.project_name
  app_url = "https://${var.domain_name}"

  # DNS-managed by this stack, or brought by hand.
  manage_dns      = var.hosted_zone_id != ""
  certificate_arn = local.manage_dns ? aws_acm_certificate_validation.app[0].certificate_arn : var.certificate_arn

  container_name = "app"
  container_port = 3000

  db_name = "acgraph"
  db_user = "acgraph"

  # Verified TLS to the database: the bundle is copied into the image by the
  # Dockerfile, so the URL can point at it.
  database_url = "postgres://${local.db_user}:${urlencode(random_password.db.result)}@${aws_db_instance.postgres.address}:${aws_db_instance.postgres.port}/${local.db_name}?sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem"
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

resource "terraform_data" "certificate_check" {
  lifecycle {
    precondition {
      condition     = local.manage_dns || var.certificate_arn != ""
      error_message = "Set hosted_zone_id (Route 53 manages DNS and the certificate) or certificate_arn (you bring the certificate)."
    }
  }
}
