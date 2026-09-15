# Managed PostgreSQL: encrypted at rest, TLS on the wire, backed up nightly,
# reachable only from the application's security group.

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "postgres" {
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = "${local.name}-db" }
}

resource "aws_db_instance" "postgres" {
  identifier = "${local.name}-db"

  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 5
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = local.db_name
  username = local.db_user
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period   = var.db_backup_retention_days
  backup_window             = "03:00-04:00"
  maintenance_window        = "sun:04:30-sun:05:30"
  copy_tags_to_snapshot     = true
  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-db-final"
  apply_immediately         = false

  # Minor versions arrive on their own during the maintenance window; a major
  # version is a decision, made by changing db_engine_version.
  auto_minor_version_upgrade = true

  performance_insights_enabled = false

  tags = { Name = "${local.name}-db" }
}

# ---------------------------------------------------------------------------
# What the app reads: the whole connection string, as one secret. The task
# execution role may read it; nothing else needs to.
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${local.name}/database-url"
  description             = "DATABASE_URL for the ${local.name} tasks: user, password, host and verified TLS."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = local.database_url
}

resource "aws_secretsmanager_secret" "anthropic_api_key" {
  count = var.anthropic_api_key != "" ? 1 : 0

  name                    = "${local.name}/anthropic-api-key"
  description             = "ANTHROPIC_API_KEY for the ${local.name} tasks; enables the AI features."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "anthropic_api_key" {
  count = var.anthropic_api_key != "" ? 1 : 0

  secret_id     = aws_secretsmanager_secret.anthropic_api_key[0].id
  secret_string = var.anthropic_api_key
}

resource "aws_secretsmanager_secret" "metrics_token" {
  count = var.metrics_token != "" ? 1 : 0

  name                    = "${local.name}/metrics-token"
  description             = "Bearer token /api/metrics demands."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "metrics_token" {
  count = var.metrics_token != "" ? 1 : 0

  secret_id     = aws_secretsmanager_secret.metrics_token[0].id
  secret_string = var.metrics_token
}
