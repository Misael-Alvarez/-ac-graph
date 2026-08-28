/**
 * Spanish for the generated catalogue.
 *
 * `src/data/serviceIcons.ts` is written by `scripts/buildData.mjs` from the
 * master list and says "do not edit manually", so the translations cannot live
 * beside the data they translate. Keying them by the English string instead of
 * by service key survives a regeneration: a new release of the master list can
 * add, remove or refile services freely, and only a *reworded* description
 * falls back to English — visibly, in the browser, rather than silently.
 *
 * A description is not decoration. It is written into a shape's subtitle when a
 * service lands on the canvas, so it becomes part of the diagram the author
 * exports and shares. That is why the writers take a locale rather than reading
 * one from a global: the language is the author's, fixed at the moment the
 * shape is created, not a live re-render of stored content.
 */
import type { ServiceIcon } from '@/lib/editor/types';
import type { Locale } from './messages';

const DESCRIPTIONS_ES: Record<string, string> = {
  'AI APIs': 'APIs de IA',
  'Analytics & visualization': 'Analítica y visualización',
  'Analytics workspace': 'Espacio de analítica',
  'API activity logging': 'Registro de actividad de API',
  'API endpoint': 'Endpoint de API',
  'API gateway & management': 'Puerta de enlace y gestión de API',
  'API management platform': 'Plataforma de gestión de API',
  'API management service': 'Servicio de gestión de API',
  'App deployment': 'Despliegue de aplicaciones',
  'App hosting platform': 'Plataforma de hospedaje de aplicaciones',
  'Application load balancer': 'Balanceador de carga de aplicación',
  'Audio transcription': 'Transcripción de audio',
  'Backup service': 'Servicio de copias de seguridad',
  'Batch computing': 'Cómputo por lotes',
  'Big data processing': 'Procesamiento de big data',
  'Blob search indexer': 'Indexador de búsqueda de blobs',
  'Block storage': 'Almacenamiento en bloques',
  'Business intelligence': 'Inteligencia de negocio',
  'Cache layer': 'Capa de caché',
  'Centralized backup': 'Copias de seguridad centralizadas',
  'Chatbot framework': 'Framework de chatbots',
  'Chatbot platform': 'Plataforma de chatbots',
  'Chatbot service': 'Servicio de chatbots',
  'CI/CD builds': 'Compilaciones CI/CD',
  'CI/CD pipeline': 'Pipeline de CI/CD',
  'Cloud firewall': 'Cortafuegos en la nube',
  'Cloud security posture': 'Postura de seguridad en la nube',
  'Cloud virtual machines': 'Máquinas virtuales en la nube',
  'Cognitive search': 'Búsqueda cognitiva',
  'Container & package registry': 'Registro de contenedores y paquetes',
  'Container instance': 'Instancia de contenedor',
  'Container orchestration': 'Orquestación de contenedores',
  'Container registry': 'Registro de contenedores',
  'Content delivery': 'Entrega de contenido',
  'Content delivery network': 'Red de entrega de contenido',
  'Conversational AI chatbot': 'Chatbot de IA conversacional',
  'Custom ML models': 'Modelos de ML propios',
  'Customer engagement': 'Interacción con clientes',
  'Data & AI platform': 'Plataforma de datos e IA',
  'Data governance': 'Gobierno de datos',
  'Data integration': 'Integración de datos',
  'Data lake': 'Lago de datos',
  'Data privacy detection': 'Detección de datos sensibles',
  'Data processing pipeline': 'Pipeline de procesamiento de datos',
  'Data warehouse': 'Almacén de datos',
  'DDoS & WAF': 'DDoS y WAF',
  'DDoS protection': 'Protección contra DDoS',
  'Dedicated connection': 'Conexión dedicada',
  'Dedicated network': 'Red dedicada',
  'Desktop application': 'Aplicación de escritorio',
  'DevOps services': 'Servicios DevOps',
  'DNS management': 'Gestión de DNS',
  'DNS web service': 'Servicio web de DNS',
  'Docker container runtime': 'Runtime de contenedores Docker',
  'Document database': 'Base de datos documental',
  'Document processing': 'Procesamiento de documentos',
  'Document text extraction': 'Extracción de texto de documentos',
  'Domain name system': 'Sistema de nombres de dominio',
  'Elastic file system': 'Sistema de archivos elástico',
  'Email service': 'Servicio de correo',
  'End user / actor': 'Usuario final / actor',
  'Enterprise message broker': 'Bróker de mensajes empresarial',
  'Error tracking': 'Seguimiento de errores',
  'ETL service': 'Servicio ETL',
  'Event streaming platform': 'Plataforma de streaming de eventos',
  'File shares': 'Recursos compartidos de archivos',
  'File storage': 'Almacenamiento de archivos',
  'Foundation models': 'Modelos fundacionales',
  'Full-stack app platform': 'Plataforma de aplicaciones full-stack',
  'Full-stack monitoring': 'Monitorización full-stack',
  'Generic database': 'Base de datos genérica',
  'Git repository': 'Repositorio Git',
  'Global database': 'Base de datos global',
  'Global load balancer': 'Balanceador de carga global',
  'Global load balancer & CDN': 'Balanceador de carga global y CDN',
  'Graph database': 'Base de datos de grafos',
  'Hybrid/multi-cloud': 'Híbrido/multinube',
  'Identity & access': 'Identidad y acceso',
  'Identity & access management': 'Gestión de identidad y acceso',
  'Image analysis': 'Análisis de imágenes',
  'Image/video analysis': 'Análisis de imagen y vídeo',
  'In-memory cache': 'Caché en memoria',
  'In-memory caching': 'Almacenamiento en caché en memoria',
  'In-memory data store': 'Almacén de datos en memoria',
  'Infrastructure as code': 'Infraestructura como código',
  'Infrastructure monitoring': 'Monitorización de infraestructura',
  'Interactive query service': 'Servicio de consultas interactivas',
  'Internet of Things device': 'Dispositivo de internet de las cosas',
  'IoT device management': 'Gestión de dispositivos IoT',
  'Key management': 'Gestión de claves',
  'Language translation': 'Traducción de idiomas',
  'Load balancer': 'Balanceador de carga',
  'Log management': 'Gestión de registros',
  'Machine learning / AI': 'Aprendizaje automático / IA',
  'Machine learning model': 'Modelo de aprendizaje automático',
  'Machine learning platform': 'Plataforma de aprendizaje automático',
  'Machine learning service': 'Servicio de aprendizaje automático',
  'Managed Kafka': 'Kafka gestionado',
  'Managed Kubernetes': 'Kubernetes gestionado',
  'Managed MySQL': 'MySQL gestionado',
  'Managed NoSQL database': 'Base de datos NoSQL gestionada',
  'Managed PostgreSQL': 'PostgreSQL gestionado',
  'Managed Redis/Memcache': 'Redis/Memcache gestionado',
  'Managed relational database': 'Base de datos relacional gestionada',
  'Managed Spark/Hadoop': 'Spark/Hadoop gestionado',
  'Managed SQL database': 'Base de datos SQL gestionada',
  'Managed SQL databases': 'Bases de datos SQL gestionadas',
  'Message broker': 'Bróker de mensajes',
  'Message queue': 'Cola de mensajes',
  'Message queuing service': 'Servicio de colas de mensajes',
  'Messaging service': 'Servicio de mensajería',
  'Metrics & alerting': 'Métricas y alertas',
  'ML platform': 'Plataforma de ML',
  'Mobile application': 'Aplicación móvil',
  'MongoDB API': 'API de MongoDB',
  'MongoDB compatible': 'Compatible con MongoDB',
  'Monitoring & observability': 'Monitorización y observabilidad',
  'Monitoring system': 'Sistema de monitorización',
  'Multi-model database': 'Base de datos multimodelo',
  'MySQL/PostgreSQL compatible': 'Compatible con MySQL/PostgreSQL',
  'NAT gateway': 'Puerta de enlace NAT',
  'Network firewall': 'Cortafuegos de red',
  'Network hub': 'Concentrador de red',
  'Network load balancer': 'Balanceador de carga de red',
  'Network segment': 'Segmento de red',
  'NLP service': 'Servicio de PLN',
  'NoSQL document database': 'Base de datos documental NoSQL',
  'Notification service': 'Servicio de notificaciones',
  'Object storage': 'Almacenamiento de objetos',
  'Observability dashboards': 'Paneles de observabilidad',
  'OpenAI models on Azure': 'Modelos de OpenAI en Azure',
  'Physical/virtual server': 'Servidor físico o virtual',
  'PostgreSQL compatible': 'Compatible con PostgreSQL',
  'Process automation engine': 'Motor de automatización de procesos',
  'Push notifications': 'Notificaciones push',
  'Real-time analytics': 'Analítica en tiempo real',
  'Real-time data streaming': 'Streaming de datos en tiempo real',
  'Real-time messaging': 'Mensajería en tiempo real',
  'Relational database': 'Base de datos relacional',
  'Resource compliance': 'Cumplimiento de recursos',
  'Scalable object storage': 'Almacenamiento de objetos escalable',
  'Search engine': 'Motor de búsqueda',
  'Secret management': 'Gestión de secretos',
  'Secret storage': 'Almacenamiento de secretos',
  'Secure VM access': 'Acceso seguro a máquinas virtuales',
  'Security / shield': 'Seguridad / escudo',
  'Serverless compute': 'Cómputo serverless',
  'Serverless containers': 'Contenedores serverless',
  'Serverless event bus': 'Bus de eventos serverless',
  'Serverless function': 'Función serverless',
  'Serverless functions': 'Funciones serverless',
  'SIEM & SOAR': 'SIEM y SOAR',
  'Speech to text/TTS': 'Voz a texto y TTS',
  'Static site hosting': 'Hospedaje de sitios estáticos',
  'Stream & batch processing': 'Procesamiento por streaming y por lotes',
  'Task queue': 'Cola de tareas',
  'Traffic distribution': 'Distribución de tráfico',
  'User authentication': 'Autenticación de usuarios',
  'Virtual machines': 'Máquinas virtuales',
  'Virtual network': 'Red virtual',
  'Virtual private cloud': 'Nube privada virtual',
  'Virtual servers in the cloud': 'Servidores virtuales en la nube',
  'VPN tunnels': 'Túneles VPN',
  'Vulnerability scanning': 'Análisis de vulnerabilidades',
  'Web app hosting': 'Hospedaje de aplicaciones web',
  'Web application firewall': 'Cortafuegos de aplicaciones web',
  'Web browser client': 'Cliente de navegador web',
  'Web server & reverse proxy': 'Servidor web y proxy inverso',
  'Wide-column NoSQL': 'NoSQL de columnas anchas',
  'Workflow automation': 'Automatización de flujos de trabajo',
  'Workflow orchestration': 'Orquestación de flujos de trabajo',
};

/** The functional areas the browser groups by, which are chrome, not content. */
const AREAS_ES: Record<string, string> = {
  compute: 'Cómputo',
  containers: 'Contenedores',
  serverless: 'Serverless',
  storage: 'Almacenamiento',
  database: 'Bases de datos',
  analytics: 'Analítica y datos',
  ai: 'IA y aprendizaje automático',
  integration: 'Integración y mensajería',
  networking: 'Redes',
  security: 'Seguridad e identidad',
  devops: 'DevOps',
  management: 'Gestión y observabilidad',
  iot: 'IoT y edge',
  other: 'Otros',
};

/**
 * What a service does, in `locale`.
 *
 * Returns `''` for a service that carries no description at all, so a caller
 * can assign the result to a subtitle without a second `?? ''`.
 */
export function serviceDescription(service: ServiceIcon | undefined, locale: Locale): string {
  const english = service?.description;
  if (!english) return '';
  if (locale === 'en') return english;
  return DESCRIPTIONS_ES[english] ?? english;
}

/** The name of a functional area, in `locale`. `fallback` is its English label. */
export function serviceAreaLabel(id: string, fallback: string, locale: Locale): string {
  if (locale === 'en') return fallback;
  return AREAS_ES[id] ?? fallback;
}

/**
 * Every language a description can be stored in.
 *
 * The serialiser omits a subtitle that only repeats the catalogue. Which
 * *language* the diagram was authored in is not recorded anywhere, so it asks
 * whether the subtitle matches the description in any language rather than in
 * the reader's — otherwise reopening a Spanish diagram under an English
 * interface would write every subtitle back out as an override.
 */
export function serviceDescriptions(service: ServiceIcon | undefined): string[] {
  const english = service?.description;
  if (!english) return [];
  const spanish = DESCRIPTIONS_ES[english];
  return spanish && spanish !== english ? [english, spanish] : [english];
}

/** Exported for the test that keeps the translations aligned with the data. */
export const SERVICE_DESCRIPTIONS_ES = DESCRIPTIONS_ES;
