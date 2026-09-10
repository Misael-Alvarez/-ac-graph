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
 *  1. `vendor/icons/aws/architecture-service` — the official AWS architecture
 *     set (via the `aws-icons` npm mirror; see vendor/icons/LEEME.md).
 *  2. `vendor/icons/gcp` — Google Cloud product icons (Iconify mirror).
 *  3. `vendor/icons/ibm` — IBM Cloud architecture icons (official repository).
 *  4. The symbol the app already ships, when a provider has no artwork in the
 *     packs (Azure, OCI, AION, generic).
 *  5. A generated mark in the vendors' idiom, as the last resort.
 *
 * Matching is by normalised product name, never by fuzzy substring on short
 * names: an icon that says the wrong thing is worse than a generated mark that
 * says the category. Every decision is written to `src/data/iconSources.json`
 * so the provenance of each symbol can be audited.
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
function indexPack(dir) {
  const byName = new Map();
  for (const path of walk(dir)) {
    const base = path
      .split('/')
      .pop()
      .replace(/\.svg$/, '');
    // Skip the structural helpers IBM ships alongside its icons.
    if (base.startsWith('_')) continue;
    const normal = matchable(base);
    if (normal && !byName.has(normal)) byName.set(normal, path);
  }
  return byName;
}

/**
 * The drawing inside an SVG file, with its viewBox, ready to become a symbol.
 *
 * Titles, XML prologues and editor metadata are dropped. Files without a viewBox
 * get one from width/height. Everything else is kept verbatim: these files are
 * static artwork and contain no scripts (scanned before vendoring).
 */
function symbolBody(path) {
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
  const body = source
    .slice(source.indexOf(open[0]) + open[0].length)
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/<desc>[\s\S]*?<\/desc>/g, '')
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!body || /<script|javascript:|on[a-z]+=/i.test(body)) return null;
  return { viewBox, body };
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
};
const aliases = { aws: AWS_ALIASES, gcp: GCP_ALIASES, ibm: IBM_ALIASES };
const existing = existingSymbols();

const symbols = new Map();
const provenance = {};
const stats = { pack: 0, existing: 0, generated: 0 };
const perCloud = {};

for (const service of services) {
  const cloud = service.category;
  perCloud[cloud] ??= { pack: 0, existing: 0, generated: 0 };
  const pack = packs[cloud];
  const path = pack ? find(pack, service.key, service.label, aliases[cloud]) : null;
  const drawn = path ? symbolBody(path) : null;

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
  '// vendor/icons (AWS architecture set, Google Cloud product icons, IBM Cloud',
  '// architecture icons), the symbols the app already shipped, and a generated',
  "// mark carrying the vendor's colour and the service's category for the rest.",
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
console.log('sprite size:', Math.round(output.length / 1024), 'KB');
