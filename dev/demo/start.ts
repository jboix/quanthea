/**
 * `bun run demo`: starts quanthea on the dev data with Gemini as the model, from
 * `dev/demo/quanthea.yaml`. It needs the data sources (`bun run env:up`), the built SPA and
 * GEMINI_API_KEY. Its state goes to `.demo/` at the repository root.
 */
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..');
const password = process.env.QUANTHEA_DEMO_PASSWORD ?? 'quanthea-demo';

if (!process.env.GEMINI_API_KEY) {
  process.stderr.write(
    'Set GEMINI_API_KEY to a Gemini API key, from https://aistudio.google.com/apikey.\n',
  );
  process.exit(1);
}

const server = Bun.spawn(['bun', join(root, 'apps/server/src/main.ts')], {
  cwd: root,
  stdio: ['inherit', 'inherit', 'inherit'],
  env: {
    ...process.env,
    QUANTHEA_CONFIG: join(import.meta.dir, 'quanthea.yaml'),
    QUANTHEA_DATA_DIR: join(root, '.demo/data'),
    QUANTHEA_KEYS_DIR: join(root, '.demo/keys'),
    // The demo's own passwords: the first admin's, and the dev database's read-only role.
    QUANTHEA_DEMO_PASSWORD: password,
    QUANTHEA_DEMO_DB_PASSWORD: 'dash-ro-dev',
  },
});

// Stopping the demo stops the server too.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal));

process.stdout.write(`Sign in at http://localhost:3000 as admin, password ${password}.\n`);
process.exitCode = await server.exited;
