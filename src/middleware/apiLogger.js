import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const banner = 'MONDELEZ INVENTORY — API REQUESTS';
const severity = { info: 0, warn: 1, error: 2 };
const methodColors = { GET: 32, POST: 36, PUT: 33, PATCH: 33, DELETE: 31 };
const jakartaTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function apiLogConfig(env = process.env, output = process.stdout) {
  const format = env.LOG_FORMAT === 'pretty' ? 'pretty' : 'json';
  const level = Object.hasOwn(severity, env.LOG_LEVEL) ? env.LOG_LEVEL : 'info';
  const colorMode = ['auto', 'always', 'never'].includes(env.LOG_COLOR) ? env.LOG_COLOR : 'auto';
  const color = colorMode === 'always' || (colorMode === 'auto' && Boolean(output.isTTY)
    && env.TERM !== 'dumb' && env.NO_COLOR === undefined);
  return { format, level, color, showOptions: env.LOG_SHOW_OPTIONS === 'true' };
}

export function formatPrettyApiLog(entry, color = false) {
  const paint = (value, code) => color && code ? `\x1b[${code}m${value}\x1b[0m` : value;
  const statusColor = entry.status >= 500 ? 31 : entry.status >= 400 ? 33 : entry.status >= 300 ? 36 : 32;
  // Pad the plain text first so ANSI escapes never affect column widths.
  const method = paint(entry.method.padEnd(7), methodColors[entry.method]);
  const path = entry.path.padEnd(40);
  const status = paint(String(entry.status).padStart(3), statusColor);
  const duration = `${Math.round(entry.duration_ms)}ms`.padStart(8);
  const time = jakartaTime.format(new Date(entry.timestamp));
  return `${time}  ${method} ${path}  ${status} ${duration}  id=${entry.request_id}${entry.aborted ? ' aborted=true' : ''}`;
}

export function createApiLogWriter(config, output = (line) => console.log(line)) {
  let bannerShown = false;
  return (entry) => {
    if (config.format === 'pretty') {
      if (!bannerShown) {
        output(banner);
        bannerShown = true;
      }
      output(formatPrettyApiLog(entry, config.color));
    } else {
      output(JSON.stringify(entry));
    }
  };
}

// Custom writers still receive the original structured entry object.
// Resolve configuration on the first request, after dotenv has initialized.
export function createApiLogger(write, options = {}) {
  let config;
  let writer;
  return (req, res, next) => {
    const path = req.originalUrl.split('?')[0];
    if (path !== '/api/v1' && !path.startsWith('/api/v1/')) return next();
    config ||= apiLogConfig(options.env || process.env, options.output || process.stdout);
    writer ||= write || createApiLogWriter(config);

    const started = performance.now();
    const requestId = randomUUID();
    let logged = false;
    res.setHeader('X-Request-Id', requestId);

    const log = () => {
      if (logged) return;
      logged = true;
      const completed = res.writableFinished;
      const status = completed ? res.statusCode : 499;
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      if (severity[level] < severity[config.level]) return;
      if (!config.showOptions && req.method === 'OPTIONS' && status < 400 && completed) return;
      const entry = {
        timestamp: new Date().toISOString(),
        level,
        event: 'api_request',
        request_id: requestId,
        method: req.method,
        // Strip control characters to prevent forged terminal lines/ANSI codes.
        path: path.replace(/[\x00-\x1f\x7f-\x9f]/g, ''),
        status,
        duration_ms: Number((performance.now() - started).toFixed(2)),
        aborted: !completed,
      };
      try {
        writer(entry);
      } catch {
        // Do not print writer errors: they may contain sensitive data themselves.
        try { console.error('Gagal mencatat log API'); } catch { /* Keep requests running. */ }
      }
    };

    res.once('finish', log);
    res.once('close', log);
    next();
  };
}

export const apiLogger = createApiLogger();
