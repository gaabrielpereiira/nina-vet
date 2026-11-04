import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function createHttpServer(handle, config) {
  const server = createServer({ maxHeaderSize: 16384 }, async (req, res) => {
    try {
      const headers = new Headers();
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
      }
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      const request = new Request(new URL(req.url, config.apiOrigin), {
        method: req.method, headers,
        ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
      });
      const response = await handle(request);
      if (res.destroyed) return;
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if(response.body)await pipeline(Readable.fromWeb(response.body),res);
      else res.end();
    } catch {
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Requisição inválida.' } }));
      } else res.destroy();
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 20000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  return server;
}
