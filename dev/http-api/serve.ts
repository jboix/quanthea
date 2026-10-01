/**
 * The dev HTTP API: a small JSON API over the incident, for the HTTP connector's integration
 * tests, on port 8080. Every `/api` route needs `Authorization: Bearer dev-token`; the OpenAPI
 * description at `/openapi.json` does not. Usage: `bun serve.ts`.
 */
import { services } from '../metrics/incident.ts';
import { deploys, errorPoints, serviceRows } from './data.ts';
import { openApi } from './openapi.ts';

/** The token every `/api` route asks for. */
const token = 'Bearer dev-token';

/**
 * A time parameter as epoch seconds: ISO text, or a number of seconds.
 *
 * @param value - The parameter.
 * @param fallback - When it is absent, in epoch seconds.
 * @returns Epoch seconds.
 */
function secondsOf(value: string | null, fallback: number): number {
  if (value === null || value === '') return fallback;
  return /^\d+$/.test(value) ? Number(value) : Math.floor(Date.parse(value) / 1000);
}

/**
 * The deploys, filtered by service and time.
 *
 * @param url - The request URL.
 * @returns The response.
 */
function deploysRoute(url: URL): Response {
  const wanted = url.searchParams.getAll('service');
  const from = secondsOf(url.searchParams.get('from'), 0) * 1000;
  const to = secondsOf(url.searchParams.get('to'), Date.now() / 1000) * 1000;
  const data = deploys().filter((deploy) => {
    const at = Date.parse(deploy.deployed_at);
    return (wanted.length === 0 || wanted.includes(deploy.service)) && at >= from && at <= to;
  });
  return Response.json({ data, total: data.length });
}

/**
 * The requests and errors of one service over time.
 *
 * @param url - The request URL.
 * @param name - The service.
 * @returns The response.
 */
function errorsRoute(url: URL, name: string): Response {
  const service = services.find((candidate) => candidate.name === name);
  if (!service) return Response.json({ error: `no service ${name}` }, { status: 404 });
  const now = Math.floor(Date.now() / 1000);
  const from = secondsOf(url.searchParams.get('from'), now - 3600);
  const to = secondsOf(url.searchParams.get('to'), now);
  const step = Math.max(10, Number(url.searchParams.get('step') ?? 60));
  return Response.json({ service: name, points: errorPoints(service, from, to, step) });
}

/**
 * The totals of several services, asked for in a POST body.
 *
 * @param request - The request.
 * @returns The response.
 */
async function searchRoute(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    services?: string[];
    from?: string;
    to?: string;
  };
  const now = Math.floor(Date.now() / 1000);
  const from = secondsOf(body.from ?? null, now - 3600);
  const to = secondsOf(body.to ?? null, now);
  const results = services
    .filter((service) => !body.services || body.services.includes(service.name))
    .map((service) => {
      const points = errorPoints(service, from, to, 60);
      const sum = (key: 'requests' | 'errors') =>
        points.reduce((total, point) => total + point[key], 0);
      return { service: service.name, requests: sum('requests'), errors: sum('errors') };
    });
  return Response.json({ results });
}

/** The status of the service behind the API, as one nested object. */
const status = {
  version: '1.4.2',
  checks: { database: { ok: true, latency_ms: 3 }, queue: { ok: true, depth: 12 } },
};

/**
 * Answers one `/api` request.
 *
 * @param request - The request.
 * @param url - Its URL.
 * @returns The response.
 */
function apiRoute(request: Request, url: URL): Response | Promise<Response> {
  if (request.headers.get('authorization') !== token)
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  const path = url.pathname;
  const errors = /^\/api\/v1\/services\/([^/]+)\/errors$/.exec(path);
  if (errors) return errorsRoute(url, decodeURIComponent(errors[1] ?? ''));
  if (path === '/api/v1/errors/search' && request.method === 'POST') return searchRoute(request);
  if (path === '/api/v1/services') return Response.json(serviceRows());
  if (path === '/api/v1/deploys') return deploysRoute(url);
  if (path === '/api/v1/status') return Response.json(status);
  return Response.json({ error: 'not found' }, { status: 404 });
}

Bun.serve({
  port: Number(process.env.PORT ?? 8080),
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    if (url.pathname === '/openapi.json') return Response.json(openApi);
    if (url.pathname.startsWith('/api/')) return apiRoute(request, url);
    return Response.json({ error: 'not found' }, { status: 404 });
  },
});
