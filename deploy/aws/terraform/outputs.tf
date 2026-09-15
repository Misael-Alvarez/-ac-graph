output "app_url" {
  description = "Where the app lives once DNS points at the load balancer."
  value       = local.app_url
}

output "alb_dns_name" {
  description = "The load balancer's own host name. With hosted_zone_id empty, create a CNAME from domain_name to this."
  value       = aws_lb.app.dns_name
}

output "ecr_repository_url" {
  description = "Push the image here: <url>:<tag>."
  value       = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.app.name
}

output "task_definition_family" {
  value = aws_ecs_task_definition.app.family
}

output "log_group" {
  description = "CloudWatch log group with one JSON line per request."
  value       = aws_cloudwatch_log_group.app.name
}

output "database_endpoint" {
  description = "RDS host:port. Private: reachable from the tasks only."
  value       = "${aws_db_instance.postgres.address}:${aws_db_instance.postgres.port}"
}

output "database_url_secret_arn" {
  description = "Secrets Manager secret holding DATABASE_URL. Read it with `aws secretsmanager get-secret-value` when you need the string by hand."
  value       = aws_secretsmanager_secret.database_url.arn
}

output "github_actions_role_arn" {
  description = "Set this as the repository variable AWS_DEPLOY_ROLE_ARN in GitHub; the deploy workflow assumes it."
  value       = local.github_enabled ? aws_iam_role.github_deploy[0].arn : null
}

output "first_deploy_commands" {
  description = "Build and push the first image by hand, then let the service pick it up."
  value       = <<-EOT
    aws ecr get-login-password --region ${var.aws_region} | docker login --username AWS --password-stdin ${aws_ecr_repository.app.repository_url}
    docker build --platform linux/amd64 -t ${aws_ecr_repository.app.repository_url}:${var.image_tag} .
    docker push ${aws_ecr_repository.app.repository_url}:${var.image_tag}
    aws ecs update-service --region ${var.aws_region} --cluster ${aws_ecs_cluster.main.name} --service ${aws_ecs_service.app.name} --force-new-deployment
  EOT
}
