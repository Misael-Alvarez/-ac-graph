import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalCategory } from './categories.mjs';
import { readExistingServices, matchable } from './buildCatalog.mjs';
import { renderMark } from './glyphs.mjs';

/**
 * Rebuilds the icon sprite from the vendored icon packs.
 *
 * Run: node scripts/refreshIcons.mjs
 *
 * Sources, in order of preference for each service in the catalogue:
 *  1. The vendored pack of the service's own cloud (see vendor/icons/LEEME.md):
 *     `aws/architecture-service` (official AWS set via the `aws-icons` npm
 *     mirror), `gcp` (Google Cloud product icons, Iconify mirror), `ibm` (IBM
 *     Cloud architecture icons, official repository), `azure` (Microsoft's
 *     Azure Public Service Icons V24 plus the Entra ID icon, official
 *     downloads) and `oci` (Oracle's OCI Architecture Diagram Toolkit, official
 *     download, converted from draw.io stencils by scripts/ociDrawioToSvg.mjs).
 *  2. The symbol the app already ships, when the pack has nothing honest for
 *     the service (AION, generic, and the few Azure/OCI products without an
 *     official icon).
 *  3. A generated mark in the vendors' idiom, as the last resort.
 *
 * Matching is by normalised product name, never by fuzzy substring on short
 * names: an icon that says the wrong thing is worse than a generated mark that
 * says the category. Every decision is written to `src/data/iconSources.json`
 * so the provenance of each symbol can be audited.
 *
 * Every drawing goes through `symbolBody`, which keeps only static artwork:
 * scripts, event handlers, stylesheets, `<foreignObject>` and any reference
 * that leaves the file are grounds for rejecting it, and every `id` inside is
 * prefixed with the service key so that the hundreds of symbols sharing one
 * document never collide (Azure alone reuses gradient ids across files).
 */

const VENDOR = 'vendor/icons';
const SPRITE = 'src/components/icons/svgIconDefs.ts';
const PROVENANCE = 'src/data/iconSources.json';

/** App keys whose product name the official filenames spell differently. */
const AWS_ALIASES = {
  'aws-sqs': 'AmazonSimpleQueueService',
  'aws-sns': 'AmazonSimpleNotificationService',
  'aws-elb': 'ElasticLoadBalancing',
  'aws-ebs': 'AmazonElasticBlockStore',
  'aws-kms': 'AWSKeyManagementService',
  'aws-qldb': 'AmazonQuantumLedgerDatabase',
  'aws-cdk': 'AWSCloudDevelopmentKit',
  'aws-snowfamily': 'AWSSnowball',
  'aws-quicksight': 'AmazonQuickSight',
  'aws-ses': 'AmazonSimpleEmailService',
  'aws-vpc': 'AmazonVirtualPrivateCloud',
  'aws-iam': 'AWSIdentityandAccessManagement',
  'aws-rds': 'AmazonRDS',
  'aws-emr': 'AmazonEMR',
  'aws-msk': 'AmazonManagedStreamingforApacheKafka',
  'aws-waf': 'AWSWAF',
  'aws-ec2': 'AmazonEC2',
  'aws-s3': 'AmazonSimpleStorageService',
  'aws-efs': 'AmazonEFS',
  'aws-ecs': 'AmazonElasticContainerService',
  'aws-eks': 'AmazonElasticKubernetesService',
  'aws-ecr': 'AmazonElasticContainerRegistry',
  'aws-apigateway': 'AmazonAPIGateway',
  'aws-cloudfront': 'AmazonCloudFront',
  'aws-route53': 'AmazonRoute53',
  'aws-dynamodb': 'AmazonDynamoDB',
  'aws-aurora': 'AmazonAurora',
  'aws-elasticache': 'AmazonElastiCache',
  'aws-redshift': 'AmazonRedshift',
  'aws-opensearch': 'AmazonOpenSearchService',
  'aws-kinesis': 'AmazonKinesis',
  'aws-glue': 'AWSGlue',
  'aws-athena': 'AmazonAthena',
  'aws-lambda': 'AWSLambda',
  'aws-fargate': 'AWSFargate',
  'aws-stepfunctions': 'AWSStepFunctions',
  'aws-eventbridge': 'AmazonEventBridge',
  'aws-cognito': 'AmazonCognito',
  'aws-secretsmanager': 'AWSSecretsManager',
  'aws-cloudwatch': 'AmazonCloudWatch',
  'aws-cloudtrail': 'AWSCloudTrail',
  'aws-cloudformation': 'AWSCloudFormation',
  'aws-codepipeline': 'AWSCodePipeline',
  'aws-codebuild': 'AWSCodeBuild',
  'aws-codedeploy': 'AWSCodeDeploy',
  'aws-codecommit': 'AWSCodeCommit',
  'aws-sagemaker': 'AmazonSageMaker',
  'aws-bedrock': 'AmazonBedrock',
  'aws-guardduty': 'AmazonGuardDuty',
  'aws-shield': 'AWSShield',
  'aws-inspector': 'AmazonInspector',
  'aws-macie': 'AmazonMacie',
  'aws-directconnect': 'AWSDirectConnect',
  'aws-transitgateway': 'AWSTransitGateway',
  'aws-globalaccelerator': 'AWSGlobalAccelerator',
  'aws-appmesh': 'AWSAppMesh',
  'aws-xray': 'AWSXRay',
  'aws-systemsmanager': 'AWSSystemsManager',
  'aws-organizations': 'AWSOrganizations',
  'aws-backup': 'AWSBackup',
  'aws-datasync': 'AWSDataSync',
  'aws-transferfamily': 'AWSTransferFamily',
  'aws-storagegateway': 'AWSStorageGateway',
  'aws-fsx': 'AmazonFSx',
  'aws-documentdb': 'AmazonDocumentDB',
  'aws-neptune': 'AmazonNeptune',
  'aws-timestream': 'AmazonTimestream',
  'aws-keyspaces': 'AmazonKeyspaces',
  'aws-memorydb': 'AmazonMemoryDB',
  'aws-lakeformation': 'AWSLakeFormation',
  'aws-datapipeline': 'AWSDataPipeline',
  'aws-mq': 'AmazonMQ',
  'aws-appflow': 'AmazonAppFlow',
  'aws-appsync': 'AWSAppSync',
  'aws-amplify': 'AWSAmplify',
  'aws-iotcore': 'AWSIoTCore',
  'aws-greengrass': 'AWSIoTGreengrass',
  'aws-outposts': 'AWSOutposts',
  'aws-batch': 'AWSBatch',
  'aws-lightsail': 'AmazonLightsail',
  'aws-elasticbeanstalk': 'AWSElasticBeanstalk',
  'aws-apprunner': 'AWSAppRunner',
  'aws-controltower': 'AWSControlTower',
  'aws-config': 'AWSConfig',
  'aws-securityhub': 'AWSSecurityHub',
  'aws-certificatemanager': 'AWSCertificateManager',
  'aws-acm': 'AWSCertificateManager',
  'aws-privatelink': 'AWSPrivateLink',
  'aws-networkfirewall': 'AWSNetworkFirewall',
  'aws-verifiedaccess': 'AWSVerifiedAccess',
  'aws-firehose': 'AmazonDataFirehose',
  'aws-kinesisdatafirehose': 'AmazonDataFirehose',
  'aws-deepracerecosystem': 'AWSDeepRacer',
  'aws-outposts': 'AWSOutpostsfamily',
  'aws-vmwareon': 'AmazonElasticVMwareService',
  'aws-cli': 'AWSCommandLineInterface',
  'aws-sdks': 'AWSToolsandSDKs',
  'aws-vpn': 'AWSSitetoSiteVPN',
  'aws-s3glacier': 'AmazonSimpleStorageServiceGlacier',
  // QuickSight became Quick Suite in the 2026 set; QLDB was retired and has no
  // icon, so it keeps its existing mark (recorded as such in iconSources.json).
  'aws-quicksight': 'AmazonQuickSuite',
};

/** GCP filenames are kebab-case product names; a few differ from the app's labels. */
const GCP_ALIASES = {
  'gcp-gke': 'google-kubernetes-engine',
  'gcp-gcs': 'cloud-storage',
  'gcp-cloudstorage': 'cloud-storage',
  'gcp-computeengine': 'compute-engine',
  'gcp-cloudsql': 'cloud-sql',
  'gcp-cloudrun': 'cloud-run',
  'gcp-cloudfunctions': 'cloud-functions',
  'gcp-pubsub': 'pubsub',
  'gcp-bigquery': 'bigquery',
  'gcp-vertexai': 'vertexai',
  'gcp-firestore': 'firestore',
  'gcp-spanner': 'cloud-spanner',
  'gcp-memorystore': 'memorystore',
  'gcp-bigtable': 'bigtable',
  'gcp-dataflow': 'dataflow',
  'gcp-dataproc': 'dataproc',
  'gcp-composer': 'cloud-composer',
  'gcp-cloudarmor': 'cloud-armor',
  'gcp-cloudcdn': 'cloud-cdn',
  'gcp-clouddns': 'cloud-dns',
  'gcp-cloudnat': 'cloud-nat',
  'gcp-cloudvpn': 'cloud-vpn',
  'gcp-cloudinterconnect': 'cloud-interconnect',
  'gcp-loadbalancing': 'cloud-load-balancing',
  'gcp-apigee': 'apigee-api-platform',
  'gcp-secretmanager': 'secret-manager',
  'gcp-kms': 'key-management-service',
  'gcp-iam': 'identity-and-access-management',
  'gcp-cloudlogging': 'cloud-logging',
  'gcp-cloudmonitoring': 'cloud-monitoring',
  'gcp-cloudbuild': 'cloud-build',
  'gcp-artifactregistry': 'artifact-registry',
  'gcp-clouddeploy': 'cloud-deploy',
  'gcp-eventarc': 'eventarc',
  'gcp-workflows': 'workflows',
  'gcp-cloudscheduler': 'cloud-scheduler',
  'gcp-cloudtasks': 'cloud-tasks',
  'gcp-looker': 'looker',
  'gcp-datacatalog': 'data-catalog',
  'gcp-dataplex': 'dataplex',
  'gcp-datastream': 'datastream',
  'gcp-datafusion': 'cloud-data-fusion',
  'gcp-filestore': 'filestore',
  'gcp-persistentdisk': 'persistent-disk',
  'gcp-vpc': 'virtual-private-cloud',
  'gcp-iot': 'iot-core',
  'gcp-translation': 'cloud-translation-api',
  'gcp-translate': 'cloud-translation-api',
  'gcp-vision': 'cloud-vision-api',
  'gcp-speechtotext': 'speech-to-text',
  'gcp-texttospeech': 'text-to-speech',
  'gcp-naturallanguageapi': 'cloud-natural-language-api',
  'gcp-dialogflow': 'dialogflow',
  'gcp-documentai': 'document-ai',
  'gcp-automl': 'automl',
  'gcp-appengine': 'app-engine',
  'gcp-anthos': 'anthos',
  'gcp-cloudendpoints': 'cloud-endpoints',
  'gcp-identityplatform': 'identity-platform',
  'gcp-securitycommandcenter': 'security-command-center',
  'gcp-binaryauthorization': 'binary-authorization',
  'gcp-certificateauthorityservice': 'certificate-authority-service',
  'gcp-cloudshell': 'cloud-shell',
  'gcp-cloudtrace': 'trace',
  'gcp-errorreporting': 'error-reporting',
  'gcp-profiler': 'profiler',
  'gcp-debugger': 'debugger',
  'gcp-transferappliance': 'transfer-appliance',
  'gcp-storagetransfer': 'transfer',
  'gcp-migrate': 'migrate-for-compute-engine',
  'gcp-batch': 'batch',
  'gcp-tpu': 'cloud-tpu',
  'gcp-gpu': 'cloud-gpu',
  // Products the pack predates or names differently. The family icon is the
  // honest choice: it says "this is a Vertex AI / Looker / GKE thing", which is
  // what the artwork can convey at 24px; the label says which one.
  'gcp-geminionvertexai': 'vertexai',
  'gcp-vertexaiagentbuilder': 'vertexai',
  'gcp-vertexaiagentengine': 'vertexai',
  'gcp-vertexaifeaturestore': 'vertexai',
  'gcp-vertexaimodelmonitoring': 'vertexai',
  'gcp-vertexaimodelregistry': 'vertexai',
  'gcp-vertexaipipelines': 'vertexai',
  'gcp-vertexairagengine': 'vertexai',
  'gcp-vertexaivectorsearch': 'vertexai',
  'gcp-vertexaiworkbench': 'vertexai',
  'gcp-modelarmor': 'security',
  'gcp-biglake': 'bigquery',
  'gcp-lookerstudio': 'looker',
  'gcp-baremetalsolution': 'bare-metal-solutions',
  'gcp-managedinstancegroups': 'compute-engine',
  'gcp-soletenantnodes': 'compute-engine',
  'gcp-spotvms': 'compute-engine',
  'gcp-mesh': 'anthos-service-mesh',
  'gcp-gkeenterprise': 'google-kubernetes-engine',
  'gcp-alloydb': 'cloud-sql',
  'gcp-workstations': 'cloud-code',
  'gcp-cli': 'cloud-shell',
  'gcp-infrastructuremanager': 'cloud-deployment-manager',
  'gcp-securesourcemanager': 'cloud-code',
  'gcp-apigateway': 'cloud-api-gateway',
  'gcp-applicationintegration': 'connectors',
  'gcp-configcontroller': 'anthos-config-management',
  'gcp-organizationpolicy': 'policy-analyzer',
  'gcp-recommender': 'recommendations-ai',
  'gcp-resourcemanager': 'project',
  'gcp-ngfw': 'cloud-firewall-rules',
  'gcp-directory': 'service-discovery',
  'gcp-identity': 'identity-platform',
  'gcp-cloudkms': 'key-management-service',
  'gcp-sensitivedataprotection': 'data-loss-prevention-api',
  'gcp-archivestorage': 'cloud-storage',
  'gcp-backupdr': 'data-transfer',
  'gcp-hyperdisk': 'persistent-disk',
  'gcp-parallelstore': 'filestore',
};

/** IBM filenames are product names; kebab-case icons come from the Carbon set. */
const IBM_ALIASES = {
  'ibm-virtualserver': 'Virtual Server',
  'ibm-bareserver': 'Bare Metal Server',
  'ibm-kubernetesservice': 'Kubernetes Service',
  'ibm-openshift': 'Red Hat OpenShift',
  'ibm-codeengine': 'Code Engine',
  'ibm-cloudfunctions': 'Functions',
  'ibm-objectstorage': 'Object Storage',
  'ibm-blockstorage': 'Block Storage',
  'ibm-filestorage': 'File Storage',
  'ibm-db2': 'Db2',
  'ibm-cloudant': 'Cloudant',
  'ibm-eventstreams': 'Event Streams',
  'ibm-mq': 'MQ',
  'ibm-apiconnect': 'API Connect',
  'ibm-appid': 'App ID',
  'ibm-keyprotect': 'Key Protect',
  'ibm-secretsmanager': 'Secrets Manager',
  'ibm-loadbalancer': 'Load Balancer',
  'ibm-vpc': 'VPC',
  'ibm-directlink': 'Direct Link',
  'ibm-cis': 'Cloud Internet Services',
  'ibm-logging': 'cloud--logging',
  'ibm-monitoring': 'cloud--monitoring',
  'ibm-activitytracker': 'Activity Tracker',
  'ibm-continuousdelivery': 'Continuous Delivery',
  'ibm-watsonxai': 'watsonx.ai',
  'ibm-watsonxdata': 'watsonx.data',
  'ibm-watsonxgovernance': 'watsonx.governance',
  'ibm-watsonxassistant': 'watsonx Assistant',
  'ibm-watsonxdiscovery': 'watsonx Discovery',
  'ibm-watsonxorchestrate': 'watsonx Orchestrate',
  'ibm-schematics': 'Schematics',
  'ibm-databasesforpostgresql': 'Databases for PostgreSQL',
  'ibm-databasesformongodb': 'Databases for MongoDB',
  'ibm-databasesforredis': 'Databases for Redis',
  'ibm-databasesforelasticsearch': 'Databases for Elasticsearch',
  // The app's own keys for the same products, plus the closest family icon for
  // products the architecture set has no dedicated mark for.
  'ibm-granitemodels': 'machine-learning-model(1)',
  'ibm-maximovisualinspection': 'AI',
  'ibm-watsonnaturallanguageunderstanding': 'IBM WatsonX',
  'ibm-watsonspeechtotext': 'IBM WatsonX',
  'ibm-watsontexttospeech': 'IBM WatsonX',
  'ibm-watsonxassistant': 'IBM WatsonX',
  'ibm-watsonxdiscovery': 'IBM WatsonX',
  'ibm-watsonxorchestrate': 'IBM WatsonX',
  'ibm-analyticsengine': 'Process',
  'ibm-cognosanalytics': 'Process',
  'ibm-eventstreams': 'database--messaging',
  'ibm-knowledgecatalog': 'ibm-cloud-pak--data',
  'ibm-mq': 'message-queue',
  'ibm-planninganalytics': 'Process',
  'ibm-codeengine': 'Serverless Application',
  'ibm-satellite': 'CoudSatellite',
  'ibm-powervirtualserver': 'Virtual Server',
  'ibm-virtualserversvpc': 'Virtual Server',
  'ibm-vmwaresolutions': 'Virtual Application',
  'ibm-containerregistry': 'Cloud Registry',
  'ibm-redhatopenshifton': 'Open Shift',
  'ibm-databaseselasticsearch': 'database--elastic',
  'ibm-databasesmongodb': 'database--mongodb',
  'ibm-databasespostgresql': 'database--postgreSQL',
  'ibm-databasesredis': 'database--redis',
  'ibm-hyperprotectdbaasecosystem': 'ibm-cloud--hyper-protect-dbaas',
  'ibm-cli': 'CLI Application',
  'ibm-schematics': 'Automation Script',
  'ibm-sdk': 'code-signing-service',
  'ibm-shell': 'CLI Application',
  'ibm-tekton': 'continuous-integration',
  'ibm-toolchains': 'build-tool',
  'ibm-eventnotifications': 'cloud--alerting',
  'ibm-apiconnect': 'gateway--api',
  'ibm-appconnect': 'gateway--api',
  'ibm-aspera': 'data-accessor',
  'ibm-activitytracker': 'cloud--auditing',
  'ibm-logs': 'cloud--logging',
  'ibm-instana': 'cloud--monitoring',
  'ibm-turbonomic': 'cloud--service-management',
  'ibm-applicationloadbalancer': 'load-balancer--application',
  'ibm-dns': 'dns-services',
  'ibm-virtualprivateendpoint': 'vpc-endpoints',
  'ibm-appid': 'Identity and Access Management',
  'ibm-guardium': 'document--security',
  'ibm-hyperprotectcrypto': 'hardware-security-module',
  'ibm-iam': 'Identity and Access Management',
  'ibm-keyprotect': 'ibm-cloud--key-protect',
  'ibm-qradar': 'intrusion-prevention',
  'ibm-securitycompliancecenter': 'security-services',
  'ibm-blockstoragevpc': 'Block Volume',
  'ibm-backup': 'data-backup',
  'ibm-objectstorage': 'Object Bucket',
  'ibm-massdatamigration': 'data-blob',
};

/**
 * Azure filenames are `NNNNN-icon-service-<Product-Name>`; the number is dropped
 * before matching, so aliases name the product part. Microsoft names most
 * services by their portal resource ("Function Apps", "Key Vaults", "Virtual
 * Networks"), which is why so many need spelling out.
 */
const AZURE_ALIASES = {
  // AI: the portal keeps the pre-rebrand names for several of the AI services.
  'az-search': 'Cognitive-Search',
  'az-aicontentsafety': 'Content-Safety',
  'az-aidocumentintelligence': 'Form-Recognizers',
  'az-formrecognizer': 'Form-Recognizers',
  'az-aifoundryagent': 'Foundry-Agent-Service',
  'az-ailanguage': 'Language',
  'az-aispeech': 'Speech-Services',
  'az-speechservice': 'Speech-Services',
  'az-aitranslator': 'Translator-Text',
  'az-aivision': 'Computer-Vision',
  'az-ml': 'Azure-Machine-Learning',
  'az-openai2': 'Azure-OpenAI',
  'az-botservice': 'Bot-Services',
  // Analytics
  'az-hdinsight': 'HD-Insight-Clusters',
  'az-datafactory': 'Data-Factories',
  'az-powerbi': 'Power-BI-Embedded',
  'az-streamanalytics': 'Stream-Analytics-Jobs',
  'az-synapse': 'Azure-Synapse-Analytics',
  // Compute
  'az-appservice': 'App-Services',
  'az-batch': 'Batch-Accounts',
  'az-dedicatedhost': 'Hosts',
  'az-functions': 'Function-Apps',
  'az-fabric': 'Service-Fabric-Clusters',
  'az-spotvirtualmachines': 'Spot-VM',
  'az-staticwebapps': 'Static-Apps',
  'az-virtualmachinescalesets': 'VM-Scale-Sets',
  'az-vm': 'Virtual-Machine',
  // Containers
  'az-aks': 'Kubernetes-Services',
  'az-kubernetes': 'Kubernetes-Services',
  'az-arcenabledkubernetes': 'Arc-Kubernetes',
  'az-containerregistry': 'Container-Registries',
  'az-containerapps': 'Container-Apps-Environments',
  // Databases
  'az-dataexplorer': 'Azure-Data-Explorer-Clusters',
  'az-databasemysql': 'Azure-Database-MySQL-Server',
  'az-mysql': 'Azure-Database-MySQL-Server',
  'az-databasepostgresql': 'Azure-Database-PostgreSQL-Server',
  'az-postgresql': 'Azure-Database-PostgreSQL-Server',
  'az-redis': 'Cache-Redis',
  'az-sqlserveronvms': 'Azure-SQL-VM',
  'az-cosmosdb-mongo': 'Azure-Cosmos-DB',
  'az-database': 'Oracle-Database',
  // DevOps: Pipelines, Repos, Artifacts and Test Plans have no icon of their
  // own in the architecture set; the Azure DevOps mark says what family they
  // belong to, as the Vertex AI mark does for GCP above.
  'az-armtemplates': 'Templates',
  'az-artifacts': 'Azure-DevOps',
  'az-pipelines': 'Azure-DevOps',
  'az-repos': 'Azure-DevOps',
  'az-testplans': 'Azure-DevOps',
  // Integration
  'az-eventgrid': 'Event-Grid-Topics',
  'az-eventhub': 'Event-Hubs',
  // Management
  'az-automation': 'Automation-Accounts',
  'az-loganalytics': 'Log-Analytics-Workspaces',
  'az-resourcemanager': 'Resource-Groups',
  // Networking
  'az-apim': 'API-Management-Services',
  'az-appgateway': 'Application-Gateways',
  'az-applicationgateway': 'Application-Gateways',
  'az-cdn': 'CDN-Profiles',
  'az-ddosprotection': 'DDoS-Protection-Plans',
  'az-dns': 'DNS-Zones',
  'az-dnszone': 'DNS-Zones',
  'az-natgateway': 'NAT',
  'az-trafficmanager': 'Traffic-Manager-Profiles',
  'az-virtualwan': 'Virtual-WANs',
  'az-vpngateway': 'Virtual-Network-Gateways',
  'az-expressroute': 'ExpressRoute-Circuits',
  'az-frontdoor': 'Front-Door-and-CDN-Profiles',
  'az-loadbalancer': 'Load-Balancers',
  'az-vnet': 'Virtual-Networks',
  // Security. Entra ID is not in the Azure set any more; it comes from the
  // Microsoft Entra architecture icons (vendor/icons/azure/entra). Managed HSM
  // and RBAC have no icon of their own: the HSM and the roles marks say the
  // family, as the family marks do for GCP and IBM above.
  'az-firewall': 'Firewalls',
  'az-managedhsm': 'Dedicated-HSM',
  'az-rbac': 'Entra-Identity-Roles-and-Administrators',
  'az-webapplicationfirewall': 'Web-Application-Firewall-Policies(WAF)',
  'az-bastion': 'Bastions',
  'az-entraid': 'Microsoft Entra ID color icon',
  'az-entraexternalid': 'external-id',
  'az-keyvault': 'Key-Vaults',
  // Storage. Blob Storage has no service icon of its own: Microsoft's diagrams
  // draw it with the block-blob glyph, and the archive tier with the account.
  // Data Lake Storage Gen2 lives inside a storage account; the set only draws
  // the lake for Gen1, and that is the glyph Microsoft's own diagrams reuse.
  'az-archivestorage': 'Storage-Accounts',
  'az-backup': 'Azure-Backup-Center',
  'az-datalakestoragegen2': 'Data-Lake-Storage-Gen1',
  'az-files': 'Azure-Fileshares',
  'az-blob': 'Blob-Block',
  'az-blobindexer': 'Blob-Block',
  'az-disks': 'Disks',
};

/**
 * OCI filenames are the captions of Oracle's toolkit page ("OCI Functions",
 * "Oracle Base Database"); the two connector glyphs come from the 2022 library
 * under `oci/library-2022`. Family marks stand in for products the toolkit has
 * no icon for, when the family is real: a network load balancer is a load
 * balancer, the archive tier is Object Storage, steering policies live in DNS.
 */
const OCI_ALIASES = {
  'oci-ai': 'Artificial Intelligence',
  'oci-generativeaiagents': 'OCI Generative AI',
  'oci-searchwithopensearch': 'OpenSearch',
  'oci-analytics': 'Oracle Analytics Cloud',
  // Compute. The toolkit captions the server glyph "OCI Compute"; the 2022
  // library called the same drawing "Bare Metal Compute".
  'oci-compute': 'OCI Compute',
  'oci-baremetalinstances': 'OCI Compute',
  'oci-dedicatedvmhosts': 'OCI Compute',
  'oci-hpc': 'OCI Compute',
  'oci-preemptibleinstances': 'Virtual Machine',
  'oci-flexiblevms': 'Flex VM',
  'oci-customer': 'Oracle Compute Cloud@Customer',
  'oci-kubernetesengine': 'OCI Container Engine for Kubernetes',
  // Databases
  'oci-autonomoustransactionprocessing': 'Oracle Autonomous Transaction Processing ATP',
  'oci-globallydistributeddatabase': 'Database',
  'oci-database23ai': 'Database',
  // Management
  'oci-audit': 'Auditing',
  // Networking
  'oci-dynamicroutinggateway': 'DRG',
  'oci-fastconnect': 'Physical - Special Connectors - FastConnect - Vertical',
  'oci-sitetositevpn': 'Physical - Special Connectors - Site-to-site-VPN - Vertical',
  'oci-networkfirewall': 'Firewall',
  'oci-networkloadbalancer': 'Load Balancer',
  'oci-privateendpoint': 'Private Endpoint IP',
  'oci-trafficmanagement': 'DNS',
  'oci-virtualnetwork': 'VCN (Region Identifier)',
  'oci-webapplicationfirewall': 'WAF',
  // Security. Identity Cloud Service became Identity Domains.
  'oci-dedicatedkms': 'Key Management',
  'oci-identitydomains': 'Oracle Identity Cloud Service',
  'oci-securityzones': 'Maximum Security Zone',
  // Storage
  'oci-archivestorage': 'OCI Object Storage',
  'oci-blockvolume': 'Block Storage',
  'oci-datatransferappliance': 'Data Transfer',
};

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (entry.endsWith('.svg')) out.push(path);
  }
  return out;
}

/** Index of normalised filename → path for one pack. */
function indexPack(dir, nameOf = (base) => base) {
  const byName = new Map();
  for (const path of walk(dir)) {
    const base = nameOf(
      path
        .split('/')
        .pop()
        .replace(/\.svg$/, ''),
    );
    // Skip the structural helpers IBM ships alongside its icons.
    if (base.startsWith('_')) continue;
    const normal = matchable(base);
    if (normal && !byName.has(normal)) byName.set(normal, path);
  }
  return byName;
}

/** Azure files are numbered: `10029-icon-service-Function-Apps` names "Function-Apps". */
const azureName = (base) => base.replace(/^\d+ ?-icon-service-/, '');

/** Root attributes that children inherit and would lose when the root is dropped. */
const INHERITED = [
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'clip-rule',
  'color',
  'opacity',
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Prefixes every `id` in a drawing with the service key and points the
 * drawing's own references (`url(#id)`, `href="#id"`) at the new names.
 *
 * All 572 symbols share one document (`ServiceSprite`), so an `id` only has to
 * repeat across two files for the second gradient or clip path to resolve to
 * the first. The key contains no underscore and no `i-` prefix, so a namespaced
 * id can collide neither with another symbol's nor with a symbol id.
 */
function namespaceIds(body, key) {
  const ids = [...new Set([...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))];
  if (ids.length === 0) return body;
  let out = body;
  for (const id of ids.sort((a, b) => b.length - a.length)) {
    const safe = escapeRegExp(id);
    const renamed = `${key}_${id}`;
    out = out
      .replace(new RegExp(`(\\sid=")${safe}(")`, 'g'), `$1${renamed}$2`)
      .replace(new RegExp(`url\\(#${safe}\\)`, 'g'), `url(#${renamed})`)
      .replace(new RegExp(`url\\('#${safe}'\\)`, 'g'), `url('#${renamed}')`)
      .replace(new RegExp(`(\\s(?:xlink:)?href=")#${safe}(")`, 'g'), `$1#${renamed}$2`);
  }
  // A file that repeats an id is broken already; renumbering the repeats keeps
  // the sprite valid without changing which one the references resolve to.
  const taken = new Set([...out.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const seen = new Set();
  return out.replace(/(\sid=")([^"]+)(")/g, (whole, before, id, after) => {
    if (!seen.has(id)) {
      seen.add(id);
      return whole;
    }
    let n = 2;
    while (taken.has(`${id}-${n}`)) n++;
    taken.add(`${id}-${n}`);
    return `${before}${id}-${n}${after}`;
  });
}

/**
 * The drawing inside an SVG file, with its viewBox, ready to become a symbol.
 *
 * Only static artwork gets through: a file with a script, an event handler, a
 * stylesheet (its classes would be global to the sprite), a `<foreignObject>`
 * or a reference that leaves the file is rejected and the service keeps the
 * symbol it had. Titles, descriptions, metadata, prologues and comments are
 * dropped; so are the root's width and height, since a `<symbol>` scales to its
 * `<use>`. Root attributes the children inherit move onto a wrapping `<g>`.
 * Ids are namespaced per symbol and empty groups removed.
 */
function symbolBody(path, key) {
  const source = readFileSync(path, 'utf8');
  const open = source.match(/<svg\b[^>]*>/);
  if (!open) return null;
  const attrs = open[0];
  let viewBox = attrs.match(/viewBox="([^"]+)"/)?.[1];
  if (!viewBox) {
    const w = parseFloat(attrs.match(/\bwidth="([\d.]+)/)?.[1] ?? '');
    const h = parseFloat(attrs.match(/\bheight="([\d.]+)/)?.[1] ?? '');
    if (!w || !h) return null;
    viewBox = `0 0 ${w} ${h}`;
  }
  let body = source
    .slice(source.indexOf(open[0]) + open[0].length)
    .replace(/<\/svg>\s*$/, '')
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/g, '')
    .replace(/<desc\b[^>]*>[\s\S]*?<\/desc>/g, '')
    .replace(/<metadata\b[^>]*>[\s\S]*?<\/metadata>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!body) return null;
  if (/<script|<foreignObject|<style|javascript:|\son[a-z]+\s*=/i.test(body)) return null;
  // Every href must stay inside the file: no URLs, no data: images.
  if (/\s(?:xlink:)?href\s*=\s*"(?!#)/i.test(body)) return null;

  const inherited = INHERITED.map((name) => attrs.match(new RegExp(` ${name}="([^"]*)"`)))
    .filter(Boolean)
    .map((m) => m[0].trim());
  if (inherited.length) body = `<g ${inherited.join(' ')}>${body}</g>`;

  body = namespaceIds(body, key);
  // Empty groups and defs are dead weight; loop, since removing one may empty its parent.
  for (let previous = ''; previous !== body;) {
    previous = body;
    body = body.replace(/<(g|defs)\b[^>]*>\s*<\/\1>/g, '').replace(/<(g|defs)\b[^>]*\/>/g, '');
  }
  return { viewBox, body: body.trim() };
}

/** Exact-name lookup, then alias, then a cautious prefix match on long names. */
function find(pack, key, label, aliases) {
  const alias = aliases[key];
  if (alias && pack.has(matchable(alias))) return pack.get(matchable(alias));
  const target = matchable(label);
  if (pack.has(target)) return pack.get(target);
  const slug = key.replace(/^[a-z]+-/, '');
  if (pack.has(slug)) return pack.get(slug);
  // Only long names may match by prefix, and only when the pack name extends
  // the product name (never the reverse): "AmazonRDS" must not claim
  // "AmazonRDSonVMware", but "Amazon SageMaker AI" may claim "AmazonSageMaker".
  if (target.length >= 8) {
    let best = null;
    for (const [normal, path] of pack) {
      if (normal === target) return path;
      if (target.startsWith(normal) && normal.length >= 8) {
        const delta = target.length - normal.length;
        if (delta <= 6 && (!best || delta < best.delta)) best = { path, delta };
      }
    }
    if (best) return best.path;
  }
  return null;
}

function existingSymbols() {
  const source = readFileSync(SPRITE, 'utf8');
  const symbols = new Map();
  for (const [, key, attrs, body] of source.matchAll(
    /<symbol id="i-([a-z0-9-]+)"([^>]*)>([\s\S]*?)<\/symbol>/g,
  )) {
    symbols.set(key, { attrs, body });
  }
  return symbols;
}

const services = readExistingServices();
const packs = {
  aws: indexPack(join(VENDOR, 'aws/architecture-service')),
  gcp: indexPack(join(VENDOR, 'gcp')),
  ibm: indexPack(join(VENDOR, 'ibm')),
  azure: indexPack(join(VENDOR, 'azure'), azureName),
  oci: indexPack(join(VENDOR, 'oci')),
};
const aliases = {
  aws: AWS_ALIASES,
  gcp: GCP_ALIASES,
  ibm: IBM_ALIASES,
  azure: AZURE_ALIASES,
  oci: OCI_ALIASES,
};
const existing = existingSymbols();
const unmapped = [];

const symbols = new Map();
const provenance = {};
const stats = { pack: 0, existing: 0, generated: 0 };
const perCloud = {};

for (const service of services) {
  const cloud = service.category;
  perCloud[cloud] ??= { pack: 0, existing: 0, generated: 0 };
  const pack = packs[cloud];
  const path = pack ? find(pack, service.key, service.label, aliases[cloud]) : null;
  const drawn = path ? symbolBody(path, service.key) : null;
  if (path && !drawn) console.warn(`rejected ${path} for ${service.key}: not static artwork`);
  if (pack && !drawn) unmapped.push(service.key);

  if (drawn) {
    symbols.set(
      service.key,
      `<symbol id="i-${service.key}" viewBox="${drawn.viewBox}">${drawn.body}</symbol>`,
    );
    provenance[service.key] = { source: 'pack', file: path.replace(`${VENDOR}/`, '') };
    stats.pack++;
    perCloud[cloud].pack++;
    continue;
  }

  const kept = existing.get(service.key);
  if (kept) {
    symbols.set(service.key, `<symbol id="i-${service.key}"${kept.attrs}>${kept.body}</symbol>`);
    provenance[service.key] = { source: 'existing' };
    stats.existing++;
    perCloud[cloud].existing++;
    continue;
  }

  symbols.set(
    service.key,
    `<symbol id="i-${service.key}" viewBox="0 0 64 64">${renderMark(cloud, canonicalCategory(service.subcategory))}</symbol>`,
  );
  provenance[service.key] = { source: 'generated' };
  stats.generated++;
  perCloud[cloud].generated++;
}

const escape = (value) =>
  value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const output = [
  '// Auto-generated SVG icon definitions — do not edit manually.',
  '// Run: node scripts/refreshIcons.mjs',
  '//',
  '// Sources, in order of preference: the vendored provider packs under',
  '// vendor/icons (AWS architecture set, Azure Public Service Icons, Google Cloud',
  '// product icons, OCI Architecture Diagram Toolkit, IBM Cloud architecture',
  '// icons), the symbols the app already shipped, and a generated mark carrying',
  "// the vendor's colour and the service's category for the rest. Every id inside",
  '// a symbol is prefixed with its service key so the sprite has no collisions.',
  '// Per-symbol provenance is recorded in src/data/iconSources.json.',
  '//',
  '// The arrowhead marker is not here: it is theme-dependent and lives in',
  '// src/components/editor/canvas/Defs.tsx.',
  '',
  '/** One `<symbol>` per service, keyed by service key. */',
  'export const SVG_SYMBOLS: Record<string, string> = {',
  ...[...symbols.entries()].map(([key, body]) => `  '${key}': \`${escape(body)}\`,`),
  '};',
  '',
  '/**',
  ' * Only the symbols a diagram actually uses.',
  ' *',
  ' * The full sprite is inlined into every exported file and every embed image,',
  ' * so shipping all of it for a five-service diagram would make a README image',
  ' * two orders of magnitude larger than it needs to be.',
  ' */',
  'export function spriteFor(keys: Iterable<string>): string {',
  '  const seen = new Set<string>();',
  '  const parts: string[] = [];',
  '  for (const key of keys) {',
  '    if (seen.has(key)) continue;',
  '    seen.add(key);',
  '    const symbol = SVG_SYMBOLS[key];',
  '    if (symbol) parts.push(symbol);',
  '  }',
  "  return parts.join('\\n');",
  '}',
  '',
  '/** Every symbol. Used by the service browser, never by an export. */',
  "export const ALL_SYMBOLS: string = Object.values(SVG_SYMBOLS).join('\\n');",
  '',
].join('\n');

writeFileSync(SPRITE, output);
writeFileSync(PROVENANCE, `${JSON.stringify(provenance, null, 2)}\n`);
console.log('symbols:', services.length, JSON.stringify(stats));
for (const [cloud, s] of Object.entries(perCloud)) console.log(`  ${cloud}:`, JSON.stringify(s));
if (unmapped.length) console.log('without official artwork:', unmapped.join(' '));
console.log('sprite size:', Math.round(output.length / 1024), 'KB');
