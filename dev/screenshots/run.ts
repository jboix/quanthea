/**
 * `bun run screenshots`: takes the documentation's screenshots. It starts a local webhook receiver
 * and quanthea on the dev data (`bun run env:up`), with Gemini as the model (GEMINI_API_KEY) and
 * its state in `dev/screenshots/.state/`. The first run fills the instance through the real agent
 * (`scenario.ts`); later runs reuse it and only take the shots again, so a change to the interface
 * costs no model call. Delete `.state/` to start over.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baseUrl, progress } from './client.ts';
import { runScenario, type Scenario, saveScenario, scenarioFile } from './scenario.ts';
import { shoot } from './shots.ts';

const root = join(import.meta.dir, '..', '..');
const state = join(import.meta.dir, '.state');
const password = 'screenshots-pass-2026';

/**
 * Starts quanthea on the screenshot instance's configuration and state.
 *
 * @returns The server process.
 */
function startServer() {
  mkdirSync(state, { recursive: true });
  return Bun.spawn(['bun', join(root, 'apps/server/src/main.ts')], {
    cwd: root,
    stdout: Bun.file(join(state, 'server.log')),
    stderr: Bun.file(join(state, 'server.log')),
    env: {
      ...process.env,
      QUANTHEA_CONFIG: join(import.meta.dir, 'quanthea.yaml'),
      QUANTHEA_DATA_DIR: join(state, 'data'),
      QUANTHEA_KEYS_DIR: join(state, 'keys'),
      QUANTHEA_HOST: '127.0.0.1',
      QUANTHEA_PORT: new URL(baseUrl).port,
      QUANTHEA_SHOTS_PASSWORD: password,
      QUANTHEA_SHOTS_DB_PASSWORD: 'dash-ro-dev',
    },
  });
}

/** Waits until quanthea answers its health check, for a minute at most. */
async function healthy(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/health`).catch(() => undefined);
    if (response?.ok) return;
    await Bun.sleep(1000);
  }
  throw new Error(`quanthea did not start; see ${join(state, 'server.log')}.`);
}

/**
 * The instance's content: made by the scenario on the first run, read back after.
 *
 * @returns What the scenario made.
 */
async function content(): Promise<Scenario> {
  if (existsSync(scenarioFile)) {
    progress('Reusing the content of dev/screenshots/.state: no model call');
    return JSON.parse(readFileSync(scenarioFile, 'utf8')) as Scenario;
  }
  progress('Filling the instance through the agent: this takes a while');
  const made = await runScenario(password);
  saveScenario(made);
  return made;
}

if (!process.env.GEMINI_API_KEY) {
  process.stderr.write('Set GEMINI_API_KEY, from https://aistudio.google.com/apikey.\n');
  process.exit(1);
}

// The channels' webhooks land here, so no message leaves the machine.
const receiver = Bun.serve({
  hostname: '127.0.0.1',
  port: 3991,
  fetch: () => new Response(null, { status: 204 }),
});
const server = startServer();
// Ctrl-C skips the finally below, so the server would outlive the script.
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    server.kill();
    process.exit(130);
  });
try {
  progress(`Starting quanthea at ${baseUrl}; its log is dev/screenshots/.state/server.log`);
  await healthy();
  const made = await content();
  progress('Taking the shots, in light then dark');
  await shoot(made, { email: 'ana.keller@example.com', password });
  process.stdout.write('The screenshots are in docs/screenshots/.\n');
} finally {
  server.kill();
  await receiver.stop();
}
