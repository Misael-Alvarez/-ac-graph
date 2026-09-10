import { resetSingleton } from '../globals';
import {
  createLogger,
  installRootLogger,
  type LogLevel,
  type LogRecord,
} from '../observability/log';

/**
 * Captures what the server logs during a test.
 *
 * Installs a JSON logger at `level` whose lines land in `records` (parsed), and
 * resets the metrics singletons so counts start from zero. Call `restore()` in
 * `afterEach` to give the next file a clean process.
 */
export interface LogCapture {
  records: LogRecord[];
  /** Records with this `msg`. */
  named(msg: string): LogRecord[];
  restore(): void;
}

export function captureLogs(level: LogLevel = 'debug'): LogCapture {
  const records: LogRecord[] = [];
  installRootLogger(
    createLogger({
      level,
      format: 'json',
      sink: (line) => records.push(JSON.parse(line) as LogRecord),
    }),
  );
  resetSingleton('metrics');
  resetSingleton('appMetrics');
  return {
    records,
    named: (msg) => records.filter((record) => record.msg === msg),
    restore: () => {
      resetSingleton('logger');
      resetSingleton('metrics');
      resetSingleton('appMetrics');
    },
  };
}
