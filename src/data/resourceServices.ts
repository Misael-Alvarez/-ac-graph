/**
 * What an infrastructure resource is, in catalogue terms.
 *
 * Terraform says `aws_lambda_function`, Kubernetes says `Deployment`, and the
 * catalogue says `aws-lambda` and `gen-container`. Every importer needs the same
 * translation, so it lives here rather than three times over.
 *
 * Deliberately not exhaustive and never fatal. A provider ships new resource
 * types constantly; an importer that refused anything it did not recognise would
 * drop half of a real `main.tf` on the floor. Anything unmatched becomes a plain
 * server and is reported as a warning, so the diagram is complete and the reader
 * can see what the tool had to guess at.
 */

/** Terraform and OpenTofu resource types, across the providers people mix. */
export const TERRAFORM_SERVICES: Record<string, string> = {
  // AWS — compute
  aws_lambda_function: 'aws-lambda',
  aws_instance: 'aws-ec2',
  aws_autoscaling_group: 'aws-ec2',
  aws_ecs_service: 'aws-ecs',
  aws_ecs_cluster: 'aws-ecs',
  aws_ecs_task_definition: 'aws-fargate',
  aws_eks_cluster: 'aws-eks',
  aws_eks_node_group: 'aws-eks',
  aws_batch_job_definition: 'aws-batch',
  aws_sfn_state_machine: 'aws-stepfunctions',

  // AWS — storage and data
  aws_s3_bucket: 'aws-s3',
  aws_dynamodb_table: 'aws-dynamodb',
  aws_db_instance: 'aws-rds',
  aws_rds_cluster: 'aws-rds',
  aws_elasticache_cluster: 'aws-elasticache',
  aws_elasticache_replication_group: 'aws-elasticache',
  aws_redshift_cluster: 'aws-redshift',
  aws_efs_file_system: 'aws-efs',
  aws_kinesis_stream: 'aws-kinesis',
  aws_glue_job: 'aws-glue',
  aws_athena_workgroup: 'aws-athena',

  // AWS — networking and delivery
  aws_api_gateway_rest_api: 'aws-apigateway',
  aws_apigatewayv2_api: 'aws-apigateway',
  aws_cloudfront_distribution: 'aws-cloudfront',
  aws_lb: 'aws-elb',
  aws_alb: 'aws-elb',
  aws_elb: 'aws-elb',
  aws_route53_zone: 'aws-route53',
  aws_route53_record: 'aws-route53',
  aws_vpc: 'aws-vpc',
  aws_nat_gateway: 'aws-vpc',
  aws_subnet: 'aws-vpc',

  // AWS — integration, identity and operations
  aws_sqs_queue: 'aws-sqs',
  aws_sns_topic: 'aws-sns',
  aws_cloudwatch_log_group: 'aws-cloudwatch',
  aws_cloudwatch_metric_alarm: 'aws-cloudwatch',
  aws_cognito_user_pool: 'aws-cognito',
  aws_secretsmanager_secret: 'aws-secretsmanager',
  aws_kms_key: 'aws-kms',
  aws_iam_role: 'aws-iam',

  // Azure
  azurerm_linux_function_app: 'az-functions',
  azurerm_function_app: 'az-functions',
  azurerm_app_service: 'az-appservice',
  azurerm_linux_web_app: 'az-appservice',
  azurerm_kubernetes_cluster: 'az-aks',
  azurerm_container_group: 'az-containerapps',
  azurerm_storage_account: 'az-blob',
  azurerm_cosmosdb_account: 'az-cosmosdb',
  azurerm_mssql_server: 'az-sqldb',
  azurerm_mssql_database: 'az-sqldb',
  azurerm_servicebus_namespace: 'az-servicebus',
  azurerm_key_vault: 'az-keyvault',
  azurerm_virtual_network: 'az-vnet',

  // Google Cloud
  google_cloudfunctions_function: 'gcp-cloudfunctions',
  google_cloudfunctions2_function: 'gcp-cloudfunctions',
  google_cloud_run_service: 'gcp-cloudrun',
  google_cloud_run_v2_service: 'gcp-cloudrun',
  google_container_cluster: 'gcp-gke',
  google_compute_instance: 'gcp-computeengine',
  google_storage_bucket: 'gcp-cloudstorage',
  google_sql_database_instance: 'gcp-cloudsql',
  google_bigquery_dataset: 'gcp-bigquery',
  google_pubsub_topic: 'gcp-pubsub',
  google_compute_network: 'gcp-vpc',

  // Things people run anywhere
  kubernetes_deployment: 'gen-container',
  kubernetes_service: 'gen-loadbalancer',
  helm_release: 'gen-kubernetes',
  docker_container: 'gen-docker',
};

/** Kubernetes kinds. Workloads are containers; the rest is what surrounds them. */
export const KUBERNETES_SERVICES: Record<string, string> = {
  Deployment: 'gen-container',
  StatefulSet: 'gen-database',
  DaemonSet: 'gen-container',
  ReplicaSet: 'gen-container',
  Pod: 'gen-container',
  Job: 'gen-server',
  CronJob: 'gen-server',
  Service: 'gen-loadbalancer',
  Ingress: 'gen-nginx',
  Gateway: 'gen-nginx',
  ConfigMap: 'gen-server',
  Secret: 'gen-shield',
  PersistentVolumeClaim: 'gen-database',
  HorizontalPodAutoscaler: 'gen-monitoring',
};

/**
 * Images whose name says what the workload really is.
 *
 * A StatefulSet running `postgres:16` is a database, not a generic box, and the
 * image is the only place that says so. Checked as a substring of the image
 * reference, longest match first, so `postgres` does not shadow `postgresql`.
 */
export const IMAGE_SERVICES: Record<string, string> = {
  postgres: 'gen-postgresql',
  postgresql: 'gen-postgresql',
  mysql: 'gen-mysql',
  mariadb: 'gen-mysql',
  mongo: 'gen-mongodb',
  mongodb: 'gen-mongodb',
  redis: 'gen-redis',
  memcached: 'gen-cache',
  rabbitmq: 'gen-rabbitmq',
  kafka: 'gen-kafka',
  elasticsearch: 'gen-elasticsearch',
  opensearch: 'gen-elasticsearch',
  nginx: 'gen-nginx',
  traefik: 'gen-nginx',
  haproxy: 'gen-loadbalancer',
  prometheus: 'gen-prometheus',
  grafana: 'gen-grafana',
};

/** The catalogue key for a Terraform resource type, or undefined. */
export function serviceForResource(type: string): string | undefined {
  return TERRAFORM_SERVICES[type];
}

/** The catalogue key for a container image reference, or undefined. */
export function serviceForImage(image: string): string | undefined {
  const name = image.toLowerCase();
  let best: { key: string; length: number } | undefined;
  for (const [needle, key] of Object.entries(IMAGE_SERVICES)) {
    if (!name.includes(needle)) continue;
    if (!best || needle.length > best.length) best = { key, length: needle.length };
  }
  return best?.key;
}
