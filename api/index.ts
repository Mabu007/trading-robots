import type { IncomingMessage, ServerResponse } from 'node:http';
import app from '../server/index';

export const config = { maxDuration: 60 };

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // The rewrite carries the original API path in a query parameter. Restore it
  // before Express matches the same routes used by the local server.
  const url = new URL(req.url || '/', 'http://localhost');
  const route = url.searchParams.get('apiPath');
  if (!route || !/^[A-Za-z0-9_/-]+$/.test(route)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unknown API route.' }));
    return;
  }
  url.searchParams.delete('apiPath');
  req.url = `/api/${route}${url.search}`;
  app(req, res);
}
