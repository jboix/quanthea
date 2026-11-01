import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { securityHeaders } from './security-headers.ts';

test('the Content-Security-Policy lets images load from the hosts listed when asked', async () => {
  let hosts: string[] = [];
  const app = new Hono();
  app.use(securityHeaders(undefined, () => hosts));
  app.get('/', (context) => context.text('ok'));
  const before = (await app.request('/')).headers.get('content-security-policy') ?? '';
  expect(before).toContain("img-src 'self' data:");
  expect(before).not.toContain('https://');
  hosts = ['media.example.com', 'cdn.example.org'];
  const after = (await app.request('/')).headers.get('content-security-policy') ?? '';
  expect(after).toContain(
    "img-src 'self' data: https://media.example.com https://cdn.example.org;",
  );
});
