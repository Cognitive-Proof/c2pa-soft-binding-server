import http from 'http';
import type { AddressInfo } from 'net';

export interface StubRequest {
  method: string;
  url: string;
  body: Buffer;
  headers: http.IncomingHttpHeaders;
}

export interface StubResponse {
  status: number;
  body?: unknown;
}

export type StubHandler = (req: StubRequest) => StubResponse | Promise<StubResponse>;

export interface StubServer {
  baseUrl: string;
  requests: StubRequest[];
  close: () => Promise<void>;
}

/** A minimal local HTTP server standing in for a real target, for offline self-tests. */
export function startStubServer(handler: StubHandler): Promise<StubServer> {
  const requests: StubRequest[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
        const record: StubRequest = {
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          body: Buffer.concat(chunks),
          headers: req.headers,
        };
        requests.push(record);

        const result = await handler(record);
        res.statusCode = result.status;
        if (result.body !== undefined) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result.body));
        } else {
          res.end();
        }
      })();
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
