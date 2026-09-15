# The application: a Fargate service running the image from the registry,
# with its settings as environment and its secrets read from Secrets Manager
# at start — nothing sensitive ever sits in the task definition.

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name}"
  retention_in_days = var.log_retention_days

  tags = { Name = local.name }
}

resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "disabled" # a line item; turn on when you want per-task graphs
  }

  tags = { Name = local.name }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# ---------------------------------------------------------------------------
# Two roles. The execution role is ECS itself, pulling the image, writing
# logs and fetching the secrets. The task role is the app, which needs only
# what `aws ecs execute-command` requires to open a shell in it.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_default" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = concat(
      [aws_secretsmanager_secret.database_url.arn],
      aws_secretsmanager_secret.anthropic_api_key[*].arn,
      aws_secretsmanager_secret.metrics_token[*].arn,
    )
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-app-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

resource "aws_iam_role" "task" {
  name               = "${local.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "task_exec" {
  statement {
    sid = "ExecuteCommand"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "task_exec" {
  name   = "execute-command"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_exec.json
}

# ---------------------------------------------------------------------------
# The task definition. GitHub Actions registers a new revision of this same
# family with each commit's image, so the service ignores changes here to
# the revision it runs — Terraform owns the shape, the pipeline owns the tag.
# ---------------------------------------------------------------------------

locals {
  environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = tostring(local.container_port) },
    { name = "HOSTNAME", value = "0.0.0.0" },
    { name = "APP_URL", value = local.app_url },
    { name = "AUTH_SIGNUP", value = var.auth_signup },
    { name = "SESSION_TTL_HOURS", value = tostring(var.session_ttl_hours) },
    { name = "LOG_FORMAT", value = "json" },
    { name = "LOG_LEVEL", value = "info" },
    { name = "OTEL_SERVICE_NAME", value = local.name },
    { name = "NEXT_TELEMETRY_DISABLED", value = "1" },
  ]

  secrets = concat(
    [{ name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn }],
    [for s in aws_secretsmanager_secret.anthropic_api_key : { name = "ANTHROPIC_API_KEY", valueFrom = s.arn }],
    [for s in aws_secretsmanager_secret.metrics_token : { name = "METRICS_TOKEN", valueFrom = s.arn }],
  )
}

resource "aws_ecs_task_definition" "app" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.container_cpu)
  memory                   = tostring(var.container_memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64" # what the GitHub Actions runner builds
  }

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
      essential = true

      portMappings = [
        { containerPort = local.container_port, hostPort = local.container_port, protocol = "tcp" },
      ]

      environment = local.environment
      secrets     = local.secrets

      # The same probe the Dockerfile declares; ECS restarts a task that fails it.
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${local.container_port}/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "app"
        }
      }

      linuxParameters = {
        initProcessEnabled = true # reaps the shells execute-command opens
      }
    },
  ])

  tags = { Name = local.name }
}

resource "aws_ecs_service" "app" {
  name            = local.name
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  # A shell into a running task: `aws ecs execute-command … --command sh`.
  # This is how `npm run users` is run on AWS without exposing the database.
  enable_execute_command = true

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = local.container_name
    container_port   = local.container_port
  }

  # A broken image never replaces a working one: ECS stops the rollout and
  # puts the previous revision back.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60

  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener.https]

  tags = { Name = local.name }
}
