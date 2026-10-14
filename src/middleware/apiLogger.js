import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export function createApiLogger(write = (entry) => console.log(JSON.stringify(entry))) {
  return (req, res, next) => {
    const path = req.originalUrl.split('?')[0];
    if (path !== '/api/v1' && !path.startsWith('/api/v1/')) return next();

    const started = performance.now();
    const requestId = randomUUID();
    let logged = false;
    res.setHeader('X-Request-Id', requestId);

    const log = () => {
      if (logged) return;
      logged = true;
      const completed = res.writableFinished;
      const status = completed ? res.statusCode : 499;
      const entry = {
        timestamp: new Date().toISOString(),
        level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
        event: 'api_request',
        request_id: requestId,
        method: req.method,
        path,
        status,
        duration_ms: Number((performance.now() - started).toFixed(2)),
        aborted: !completed,
      };
      try {
        write(entry);
      } catch (error) {
        console.error('Gagal mencatat log API', error);
      }
    };

    res.once('finish', log);
    res.once('close', log);
    next();
  };
}

export const apiLogger = createApiLogger();
