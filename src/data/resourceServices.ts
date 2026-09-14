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

/**
 * CloudFormation resource types, SAM's included.
 *
 * Named one by one, never by family: the service is the cache cluster, and the
 * subnet group and parameter group beside it in the same `AWS::ElastiCache::`
 * namespace are configuration. The reader drops what a family has left over.
 */
export const CLOUDFORMATION_SERVICES: Record<string, string> = {
  // Compute
  'AWS::Lambda::Function': 'aws-lambda',
  'AWS::Serverless::Function': 'aws-lambda',
  'AWS::EC2::Instance': 'aws-ec2',
  'AWS::AutoScaling::AutoScalingGroup': 'aws-ec2',
  'AWS::ECS::Cluster': 'aws-ecs',
  'AWS::ECS::Service': 'aws-ecs',
  'AWS::ECS::TaskDefinition': 'aws-ecs',
  'AWS::EKS::Cluster': 'aws-eks',
  'AWS::Batch::JobQueue': 'aws-batch',
  'AWS::Batch::JobDefinition': 'aws-batch',
  'AWS::StepFunctions::StateMachine': 'aws-stepfunctions',
  'AWS::Serverless::StateMachine': 'aws-stepfunctions',
  'AWS::AppSync::GraphQLApi': 'aws-appsync',
  'AWS::Serverless::GraphQLApi': 'aws-appsync',
  'AWS::AppRunner::Service': 'aws-apprunner',
  'AWS::ElasticBeanstalk::Environment': 'aws-elasticbeanstalk',

  // Storage and data
  'AWS::S3::Bucket': 'aws-s3',
  'AWS::DynamoDB::Table': 'aws-dynamodb',
  'AWS::DynamoDB::GlobalTable': 'aws-dynamodb',
  'AWS::Serverless::SimpleTable': 'aws-dynamodb',
  'AWS::RDS::DBInstance': 'aws-rds',
  'AWS::RDS::DBProxy': 'aws-rds',
  'AWS::RDS::DBCluster': 'aws-aurora',
  'AWS::RDS::GlobalCluster': 'aws-aurora',
  'AWS::ElastiCache::CacheCluster': 'aws-elasticache',
  'AWS::ElastiCache::ReplicationGroup': 'aws-elasticache',
  'AWS::ElastiCache::GlobalReplicationGroup': 'aws-elasticache',
  'AWS::ElastiCache::ServerlessCache': 'aws-elasticache',
  'AWS::MemoryDB::Cluster': 'aws-memorydb',
  'AWS::Redshift::Cluster': 'aws-redshift',
  'AWS::EFS::FileSystem': 'aws-efs',
  'AWS::Kinesis::Stream': 'aws-kinesis',
  'AWS::KinesisFirehose::DeliveryStream': 'aws-kinesis',
  'AWS::Glue::Job': 'aws-glue',
  'AWS::Glue::Crawler': 'aws-glue',
  'AWS::Glue::Workflow': 'aws-glue',
  'AWS::Glue::Database': 'aws-glue',
  'AWS::Glue::Table': 'aws-glue',
  'AWS::Athena::WorkGroup': 'aws-athena',
  'AWS::Athena::DataCatalog': 'aws-athena',
  'AWS::OpenSearchService::Domain': 'aws-opensearch',
  'AWS::Elasticsearch::Domain': 'aws-opensearch',
  'AWS::DocDB::DBCluster': 'aws-documentdb',
  'AWS::Neptune::DBCluster': 'aws-neptune',

  // Networking and delivery
  'AWS::ApiGateway::RestApi': 'aws-apigateway',
  'AWS::ApiGatewayV2::Api': 'aws-apigateway',
  'AWS::Serverless::Api': 'aws-apigateway',
  'AWS::Serverless::HttpApi': 'aws-apigateway',
  'AWS::ElasticLoadBalancingV2::LoadBalancer': 'aws-elasticloadbalancing',
  'AWS::ElasticLoadBalancing::LoadBalancer': 'aws-elb',
  'AWS::CloudFront::Distribution': 'aws-cloudfront',
  'AWS::Route53::HostedZone': 'aws-route53',
  'AWS::Route53::RecordSet': 'aws-route53',
  'AWS::Route53::RecordSetGroup': 'aws-route53',
  'AWS::EC2::VPC': 'aws-vpc',
  'AWS::EC2::TransitGateway': 'aws-transitgateway',
  'AWS::WAFv2::WebACL': 'aws-waf',

  // Integration, identity and operations
  'AWS::SQS::Queue': 'aws-sqs',
  'AWS::SNS::Topic': 'aws-sns',
  'AWS::Events::Rule': 'aws-eventbridge',
  'AWS::Events::EventBus': 'aws-eventbridge',
  'AWS::Scheduler::Schedule': 'aws-eventbridge',
  'AWS::Cognito::UserPool': 'aws-cognito',
  'AWS::SecretsManager::Secret': 'aws-secretsmanager',
  'AWS::KMS::Key': 'aws-kms',
  'AWS::SES::EmailIdentity': 'aws-ses',
  'AWS::SES::ReceiptRule': 'aws-ses',
  'AWS::SES::ReceiptRuleSet': 'aws-ses',
  'AWS::CloudWatch::Alarm': 'aws-cloudwatch',
  'AWS::CloudWatch::Dashboard': 'aws-cloudwatch',
  'AWS::ECR::Repository': 'aws-ecr',
  'AWS::AmazonMQ::Broker': 'aws-mq',
  'AWS::MSK::Cluster': 'aws-msk',
  'AWS::CodeBuild::Project': 'aws-codebuild',
  'AWS::CodePipeline::Pipeline': 'aws-codepipeline',
  'AWS::CloudFormation::Stack': 'aws-cloudformation',
  'AWS::Serverless::Application': 'aws-cloudformation',
};

/**
 * Pulumi resource types that the Terraform-shaped fallback gets wrong.
 *
 * Most Pulumi types are the Terraform ones in different clothes —
 * `aws:lambda/function:Function` is `aws_lambda_function` — and
 * `serviceForPulumiType` undresses them. The ones here are the exceptions:
 * providers whose names never matched Terraform's (`azure-native`), types
 * Terraform abbreviates (`aws_instance`, `aws_lb`), and things Pulumi has
 * that Terraform does not (`awsx`, `docker`).
 */
export const PULUMI_SERVICES: Record<string, string> = {
  // AWS, where the Terraform name is not the module name
  'aws:ec2/instance:Instance': 'aws-ec2',
  'aws:ec2/vpc:Vpc': 'aws-vpc',
  'aws:apigateway/restApi:RestApi': 'aws-apigateway',
  'aws:lb/loadBalancer:LoadBalancer': 'aws-elb',
  'aws:alb/loadBalancer:LoadBalancer': 'aws-elb',
  'aws:elb/loadBalancer:LoadBalancer': 'aws-elb',
  'aws:rds/instance:Instance': 'aws-rds',
  'aws:rds/cluster:Cluster': 'aws-aurora',
  'aws:s3/bucketV2:BucketV2': 'aws-s3',
  'aws:cloudwatch/eventRule:EventRule': 'aws-eventbridge',
  'aws:cloudwatch/eventBus:EventBus': 'aws-eventbridge',
  'aws:appsync/graphQLApi:GraphQLApi': 'aws-appsync',
  'aws:ecr/repository:Repository': 'aws-ecr',
  'aws:mq/broker:Broker': 'aws-mq',
  'aws:msk/cluster:Cluster': 'aws-msk',
  'aws:codebuild/project:Project': 'aws-codebuild',
  'aws:codepipeline/pipeline:Pipeline': 'aws-codepipeline',
  'aws:cloudformation/stack:Stack': 'aws-cloudformation',
  'aws:opensearch/domain:Domain': 'aws-opensearch',

  // Azure Native, whose names are the ARM ones
  'azure-native:web:WebApp': 'az-appservice',
  'azure-native:web:AppServicePlan': 'az-appservice',
  'azure-native:web:StaticSite': 'az-staticwebapps',
  'azure-native:storage:StorageAccount': 'az-blob',
  'azure-native:app:ContainerApp': 'az-containerapps',
  'azure-native:containerservice:ManagedCluster': 'az-aks',
  'azure-native:containerinstance:ContainerGroup': 'az-containerapps',
  'azure-native:compute:VirtualMachine': 'az-vm',
  'azure-native:documentdb:DatabaseAccount': 'az-cosmosdb',
  'azure-native:sql:Server': 'az-sqldb',
  'azure-native:sql:Database': 'az-sqldb',
  'azure-native:dbforpostgresql:Server': 'az-postgresql',
  'azure-native:dbformysql:Server': 'az-mysql',
  'azure-native:cache:Redis': 'az-redis',
  'azure-native:servicebus:Namespace': 'az-servicebus',
  'azure-native:eventhub:Namespace': 'az-eventhub',
  'azure-native:eventgrid:Topic': 'az-eventgrid',
  'azure-native:keyvault:Vault': 'az-keyvault',
  'azure-native:network:VirtualNetwork': 'az-vnet',
  'azure-native:network:ApplicationGateway': 'az-applicationgateway',
  'azure-native:network:LoadBalancer': 'az-loadbalancer',
  'azure-native:cdn:Profile': 'az-cdn',
  'azure-native:apimanagement:ApiManagementService': 'az-apim',
  'azure-native:containerregistry:Registry': 'az-containerregistry',
  'azure-native:logic:Workflow': 'az-logicapps',
  'azure-native:signalrservice:SignalR': 'az-signalr',
  // Azure Classic, where the module is not the Terraform name
  'azure:appservice/functionApp:FunctionApp': 'az-functions',
  'azure:appservice/linuxFunctionApp:LinuxFunctionApp': 'az-functions',
  'azure:appservice/linuxWebApp:LinuxWebApp': 'az-appservice',
  'azure:appservice/appService:AppService': 'az-appservice',
  'azure:containerservice/kubernetesCluster:KubernetesCluster': 'az-aks',
  'azure:keyvault/keyVault:KeyVault': 'az-keyvault',
  'azure:network/virtualNetwork:VirtualNetwork': 'az-vnet',

  // Google Cloud, where Terraform spells the module differently
  'gcp:cloudrun/service:Service': 'gcp-cloudrun',
  'gcp:cloudrunv2/service:Service': 'gcp-cloudrun',
  'gcp:cloudrunv2/job:Job': 'gcp-cloudrun',
  'gcp:cloudfunctionsv2/function:Function': 'gcp-cloudfunctions',
  'gcp:firestore/database:Database': 'gcp-firestore',
  'gcp:redis/instance:Instance': 'gcp-memorystore',
  'gcp:cloudtasks/queue:Queue': 'gcp-cloudtasks',
  'gcp:cloudscheduler/job:Job': 'gcp-scheduler',
  'gcp:secretmanager/secret:Secret': 'gcp-secretmanager',
  'gcp:kms/cryptoKey:CryptoKey': 'gcp-cloudkms',
  'gcp:artifactregistry/repository:Repository': 'gcp-artifactregistry',
  'gcp:cloudbuild/trigger:Trigger': 'gcp-cloudbuild',
  'gcp:spanner/instance:Instance': 'gcp-cloudspanner',
  'gcp:bigtable/instance:Instance': 'gcp-bigtable',
  'gcp:dataflow/job:Job': 'gcp-dataflow',
  'gcp:eventarc/trigger:Trigger': 'gcp-eventarc',
  'gcp:workflows/workflow:Workflow': 'gcp-workflows',
  'gcp:appengine/application:Application': 'gcp-appengine',
  'gcp:apigateway/api:Api': 'gcp-apigateway',
  'gcp:dns/managedZone:ManagedZone': 'gcp-dns',
  'gcp:compute/globalForwardingRule:GlobalForwardingRule': 'gcp-cloudloadbalancing',
  'gcp:compute/forwardingRule:ForwardingRule': 'gcp-cloudloadbalancing',

  // Pulumi's own components, and things people run anywhere
  'awsx:ecs:FargateService': 'aws-fargate',
  'awsx:ecs:EC2Service': 'aws-ecs',
  'awsx:lb:ApplicationLoadBalancer': 'aws-elb',
  'awsx:lb:NetworkLoadBalancer': 'aws-elb',
  'awsx:ec2:Vpc': 'aws-vpc',
  'awsx:apigateway:API': 'aws-apigateway',
  'eks:index:Cluster': 'aws-eks',
  'docker:index/container:Container': 'gen-docker',
  'docker:index/service:Service': 'gen-docker',
  'kubernetes:helm.sh/v3:Release': 'gen-kubernetes',
  'kubernetes:helm.sh/v3:Chart': 'gen-kubernetes',
  'kubernetes:helm.sh/v4:Chart': 'gen-kubernetes',
  'kubernetes:yaml:ConfigFile': 'gen-kubernetes',
  'kubernetes:yaml:ConfigGroup': 'gen-kubernetes',
  'kubernetes:yaml/v2:ConfigFile': 'gen-kubernetes',
  'kubernetes:yaml/v2:ConfigGroup': 'gen-kubernetes',
  'kubernetes:kustomize:Directory': 'gen-kubernetes',
};

/** The catalogue key for a Terraform resource type, or undefined. */
export function serviceForResource(type: string): string | undefined {
  return TERRAFORM_SERVICES[type];
}

/** The catalogue key for a CloudFormation resource type, or undefined. */
export function serviceForCloudFormationType(type: string): string | undefined {
  return CLOUDFORMATION_SERVICES[type];
}

/** `lowerCamel` or `UpperCamel` to `snake_case`, the way Terraform spells things. */
const snake = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

const TERRAFORM_PROVIDER: Record<string, string> = {
  aws: 'aws',
  azure: 'azurerm',
  azuread: 'azuread',
  gcp: 'google',
  google: 'google',
  kubernetes: 'kubernetes',
  docker: 'docker',
};

/**
 * The Terraform resource type a Pulumi type would have, or undefined.
 *
 * Pulumi's classic providers are generated from Terraform's, so the name is
 * still in there: `aws:lambda/function:Function` is `aws_lambda_function`,
 * `gcp:storage/bucket:Bucket` is `google_storage_bucket`. Azure Native has no
 * Terraform ancestor and gets nothing from this; its common types are listed.
 */
export function terraformTypeForPulumi(type: string): string | undefined {
  const match = type.match(/^([a-z][a-z0-9-]*):([^:]+):([^:]+)$/);
  if (!match) return undefined;
  const [, provider, path, name] = match;
  const prefix = TERRAFORM_PROVIDER[provider];
  if (!prefix) return undefined;
  const [module, resource = name] = path.split('/');
  return `${prefix}_${snake(module)}_${snake(resource)}`;
}

/**
 * The catalogue key for a Pulumi resource type, or undefined.
 *
 * Kubernetes types say the kind in their last segment, and the kind is a
 * question the Kubernetes reader has already answered.
 */
export function serviceForPulumiType(type: string): string | undefined {
  const explicit = PULUMI_SERVICES[type];
  if (explicit) return explicit;
  if (type.startsWith('kubernetes:')) {
    return KUBERNETES_SERVICES[type.slice(type.lastIndexOf(':') + 1)] ?? 'gen-kubernetes';
  }
  const terraform = terraformTypeForPulumi(type);
  return terraform ? serviceForResource(terraform) : undefined;
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
