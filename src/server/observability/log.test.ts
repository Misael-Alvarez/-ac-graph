import { afterEach, describe, expect, it } from 'vitest';
import { runWithRequest, type RequestContext } from './context';
import {
  createLogger,
  installRootLogger,
  log,
  pretty,
  resetRootLogger,
  rootLogger,
  sanitize,
  serializeError,
  type LogRecord,
} from './log';

const FIXED = new Date('2026-09-10T12:34:56.789Z');

function collector(level: 'debug' | 'info' | 'warn' | 'error' | 'silent' = 'debug') {
  const lines: string[] = [];
  const logger = createLogger({
    level,
    format: 'json',
    sink: (line) => lines.push(line),
    now: () => FIXED,
  });
  return { logger, lines, records: () => lines.map((line) => JSON.parse(line) as LogRecord) };
}

afterEach(() => {
  resetRootLogger();
});

describe('createLogger', () => {
  it('writes one JSON object per line with time, level and msg first', () => {
    const { logger, lines, records } = collector();
    logger.info('hello', { a: 1 });
    expect(lines).toHaveLength(1);
    expect(
      lines[0].startsWith('{"time":"2026-09-10T12:34:56.789Z","level":"info","msg":"hello"'),
    ).toBe(true);
    expect(records()[0]).toEqual({
      time: '2026-09-10T12:34:56.789Z',
      level: 'info',
      msg: 'hello',
      a: 1,
    });
  });

  it('drops records below its level and everything when silent', () => {
    const warnOnly = collector('warn');
    warnOnly.logger.debug('no');
    warnOnly.logger.info('no');
    warnOnly.logger.warn('yes');
    warnOnly.logger.error('yes');
    expect(warnOnly.records().map((record) => record.level)).toEqual(['warn', 'error']);
    expect(warnOnly.logger.enabled('info')).toBe(false);
    expect(warnOnly.logger.enabled('warn')).toBe(true);

    const silent = collector('silent');
    silent.logger.error('no');
    expect(silent.lines).toEqual([]);
  });

  it('a child adds its bindings to every record, reading a function per record', () => {
    const { logger, records } = collector();
    let n = 0;
    const child = logger.child(() => ({ requestId: 'r1', n: ++n }));
    child.info('one');
    child.child({ userId: 'u1' }).info('two', { extra: true });
    expect(records()[0]).toMatchObject({ requestId: 'r1', n: 1 });
    expect(records()[1]).toMatchObject({ requestId: 'r1', n: 2, userId: 'u1', extra: true });
  });

  it('fields cannot overwrite time, level or msg', () => {
    const { logger, records } = collector();
    logger.info('kept', { msg: 'clobbered', level: 'error', time: 'never' });
    expect(records()[0]).toMatchObject({ level: 'info', msg: 'kept', time: FIXED.toISOString() });
  });

  it('redacts anything that looks like a credential, however deep', () => {
    const { logger, records } = collector();
    logger.info('req', {
      headers: { cookie: 'acg_session=abc', authorization: 'Bearer x', accept: 'json' },
      nested: [{ clientSecret: 's', apiKey: 'k', api_key: 'k2', access_token: 't' }],
      password: 'p',
      sessionKey: 'digest-is-fine',
      code: 'conflict',
    });
    expect(records()[0]).toMatchObject({
      headers: { cookie: '[redacted]', authorization: '[redacted]', accept: 'json' },
      nested: [
        {
          clientSecret: '[redacted]',
          apiKey: '[redacted]',
          api_key: '[redacted]',
          access_token: '[redacted]',
        },
      ],
      password: '[redacted]',
      sessionKey: 'digest-is-fine',
      code: 'conflict',
    });
  });

  it('serialises errors with name, message and code; the stack only for error records', () => {
    const { logger, records } = collector('info');
    const failure = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    logger.warn('db', { err: failure });
    logger.error('db', { err: failure });
    const [warned, errored] = records();
    expect(warned.err).toEqual({
      name: 'Error',
      message: 'connect ECONNREFUSED',
      code: 'ECONNREFUSED',
    });
    expect(errored.err).toMatchObject({ name: 'Error', message: 'connect ECONNREFUSED' });
    expect((errored.err as { stack: string }).stack).toContain('log.test.ts');
  });

  it('a debug logger includes the stack at every level', () => {
    const { logger, records } = collector('debug');
    logger.info('x', { err: new Error('boom') });
    expect((records()[0].err as { stack?: string }).stack).toBeDefined();
  });

  it('survives cycles, dates and bigints', () => {
    const { logger, records } = collector();
    const loop: Record<string, unknown> = { name: 'loop' };
    loop.self = loop;
    logger.info('x', { loop, when: FIXED, big: BigInt(10) });
    expect(records()[0]).toMatchObject({
      loop: { name: 'loop', self: '[circular]' },
      when: FIXED.toISOString(),
      big: '10',
    });
  });
});

describe('serializeError / sanitize', () => {
  it('describes non-errors without throwing', () => {
    expect(serializeError('just a string')).toEqual({ name: 'NonError', message: 'just a string' });
    expect(serializeError(42)).toEqual({ name: 'NonError', message: '42' });
    expect(serializeError(undefined)).toEqual({ name: 'NonError', message: 'undefined' });
  });

  it('caps depth', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'too deep' } } } } } };
    expect(sanitize(deep)).toEqual({ a: { b: { c: { d: { e: '[depth]' } } } } });
  });
});

describe('pretty', () => {
  it('renders a compact line with quoted values and the error on following lines', () => {
    const line = pretty({
      time: '2026-09-10T12:34:56.789Z',
      level: 'warn',
      msg: 'http request',
      method: 'GET',
      route: '/api/diagrams/[id]',
      status: 500,
      title: 'has spaces',
      err: { name: 'TypeError', message: 'boom', stack: 'TypeError: boom\n    at x' },
    });
    const [head, ...tail] = line.split('\n');
    expect(head).toBe(
      '12:34:56.789 WARN  http request  method=GET route=/api/diagrams/[id] status=500 title="has spaces" err="TypeError: boom"',
    );
    expect(tail).toEqual(['    TypeError: boom', '        at x']);
  });

  it('is just the message when there are no fields', () => {
    expect(pretty({ time: '2026-09-10T12:34:56.789Z', level: 'info', msg: 'server started' })).toBe(
      '12:34:56.789 INFO  server started',
    );
  });
});

describe('rootLogger and log()', () => {
  it('reads its level and format from the environment once', () => {
    const logger = rootLogger();
    expect(logger.level).toBe('silent'); // vitest.config.mts
    expect(rootLogger()).toBe(logger);
  });

  it('log() is the request logger inside a request and the root logger outside', () => {
    const { logger: root, records } = collector();
    installRootLogger(root);
    expect(log()).toBe(root);

    const context: RequestContext = {
      requestId: 'req-1',
      method: 'GET',
      route: '/api/x',
      path: '/api/x',
      startedAt: 0,
      fields: {},
      logger: root.child({ requestId: 'req-1' }),
    };
    runWithRequest(context, () => {
      log().info('inside');
    });
    log().info('outside');
    expect(records()).toEqual([
      expect.objectContaining({ msg: 'inside', requestId: 'req-1' }),
      expect.not.objectContaining({ requestId: 'req-1' }),
    ]);
  });
});
