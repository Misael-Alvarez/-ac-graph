import { isSpanContextValid, trace } from '@opentelemetry/api';
import { readObservabilityEnv, type LogFormat, type LogLevel } from '../env';
import { resetSingleton, singleton } from '../globals';
import { currentRequest } from './context';

/**
 * Structured logging for the server.
 *
 * One record per event, one JSON object per line, so Docker's `json-file`
 * driver, Loki or CloudWatch can index it without a parser. A record is
 * `time`, `level`, `msg`, then the bindings of the logger (the request id, the
 * user, the diagram) and finally the fields of the call. Keys that smell like a
 * credential are redacted wherever they appear, and an `Error` becomes name,
 * message and code — the stack only for `error` records or a `debug` logger.
 *
 * Nothing here decides *what* to log; `request.ts` writes the access line and
 * the modules that know something worth saying call `log()`.
 */
export type { LogFormat, LogLevel };

export type LogFields = Record<string, unknown>;
export type EmittedLevel = Exclude<LogLevel, 'silent'>;

export interface LogRecord {
  time: string;
  level: EmittedLevel;
  msg: string;
  [key: string]: unknown;
}

export interface Logger {
  readonly level: LogLevel;
  enabled(level: EmittedLevel): boolean;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds `bindings` to every record; a function is read per record. */
  child(bindings: LogFields | (() => LogFields)): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  format?: LogFormat;
  /** Where lines go. Defaults to stdout. */
  sink?: (line: string) => void;
  bindings?: LogFields | (() => LogFields);
  now?: () => Date;
}

const WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 50 };

const RESERVED = new Set(['time', 'level', 'msg']);

/** Key names that never carry a value worth keeping, wherever they are nested. */
const SENSITIVE_KEY = /cookie|authorization|password|secret|token|api[_-]?key/i;

const MAX_DEPTH = 5;

export interface SerializedError {
  name: string;
  message: string;
  code?: string | number;
  stack?: string;
}

/** Name, message and code. The stack — frames only, never values — on request. */
export function serializeError(
  thrown: unknown,
  options: { stack?: boolean } = {},
): SerializedError {
  if (thrown instanceof Error) {
    const out: SerializedError = { name: thrown.name || 'Error', message: thrown.message };
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') out.code = code;
    if (options.stack && thrown.stack) out.stack = thrown.stack;
    return out;
  }
  return { name: 'NonError', message: typeof thrown === 'string' ? thrown : String(thrown) };
}

/** Deep copy for the wire: sensitive keys hidden, errors serialised, cycles cut. */
export function sanitize(value: unknown, options: { stack?: boolean } = {}): unknown {
  return walk(value, 0, new WeakSet(), options);
}

function walk(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  options: { stack?: boolean },
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (value instanceof Error) return serializeError(value, options);
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[depth]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, seen, options));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : walk(item, depth + 1, seen, options);
  }
  return out;
}

function resolve(bindings: LogFields | (() => LogFields) | undefined): LogFields {
  if (!bindings) return {};
  return typeof bindings === 'function' ? bindings() : bindings;
}

/** The active span, when a tracer provider is registered; nothing otherwise. */
function traceFields(): LogFields {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const context = span.spanContext();
  if (!isSpanContextValid(context)) return {};
  return { traceId: context.traceId, spanId: context.spanId };
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const format = options.format ?? 'json';
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());
  const bindings = options.bindings;

  const enabled = (candidate: EmittedLevel) => WEIGHT[candidate] >= WEIGHT[level];

  const emit = (recordLevel: EmittedLevel, message: string, fields: LogFields = {}) => {
    if (!enabled(recordLevel)) return;
    const stack = recordLevel === 'error' || level === 'debug';
    const body = sanitize(
      { ...resolve(bindings), ...traceFields(), ...fields },
      { stack },
    ) as Record<string, unknown>;
    for (const key of RESERVED) delete body[key];
    const record: LogRecord = {
      time: now().toISOString(),
      level: recordLevel,
      msg: message,
      ...body,
    };
    sink(format === 'json' ? JSON.stringify(record) : pretty(record));
  };

  return {
    level,
    enabled,
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (more) =>
      createLogger({
        level,
        format,
        sink,
        now,
        bindings: () => ({ ...resolve(bindings), ...resolve(more) }),
      }),
  };
}

function defaultSink(line: string): void {
  process.stdout.write(line + '\n');
}

/** `12:34:56.789 INFO  http request  method=GET route=/api/health status=200`. */
export function pretty(record: LogRecord): string {
  const { time, level, msg, ...rest } = record;
  const clock = time.slice(11, 23);
  const parts: string[] = [];
  const tails: string[] = [];
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    if (isSerializedError(value)) {
      parts.push(`${key}=${quote(`${value.name}: ${value.message}`)}`);
      if (value.stack) tails.push(indent(value.stack));
      continue;
    }
    parts.push(`${key}=${typeof value === 'string' ? quote(value) : JSON.stringify(value)}`);
  }
  const head = `${clock} ${level.toUpperCase().padEnd(5)} ${msg}`;
  const line = parts.length ? `${head}  ${parts.join(' ')}` : head;
  return tails.length ? `${line}\n${tails.join('\n')}` : line;
}

function isSerializedError(value: unknown): value is SerializedError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'message' in value &&
    typeof (value as SerializedError).message === 'string' &&
    Object.keys(value).every((key) => ['name', 'message', 'code', 'stack'].includes(key))
  );
}

function quote(text: string): string {
  return /[\s"=]/.test(text) ? JSON.stringify(text) : text;
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

const LOGGER_KEY = 'logger';

/** The process logger, configured from the environment on first use. */
export function rootLogger(): Logger {
  return singleton(LOGGER_KEY, () => {
    const env = readObservabilityEnv();
    return createLogger({ level: env.logLevel, format: env.logFormat });
  });
}

/** The logger of the request being handled, or the process logger. */
export function log(): Logger {
  return currentRequest()?.logger ?? rootLogger();
}

/** Replaces the process logger. Tests and start-up only. */
export function installRootLogger(logger: Logger): void {
  resetSingleton(LOGGER_KEY);
  singleton(LOGGER_KEY, () => logger);
}

export function resetRootLogger(): void {
  resetSingleton(LOGGER_KEY);
}
