/**
 * `bun run screenshots`: takes the documentation's screenshots. It starts a local webhook receiver
 * and quanthea on the dev data (`bun run env:up`), with Anthropic as the model (ANTHROPIC_API_KEY),
 * or Gemini with `--provider gemini` (GEMINI_API_KEY), and its state in `dev/screenshots/.state/`. The first run fills the instance through the real agent
 * (`scenario.ts`); later runs reuse it and only take the shots again, so a change to the interface
 * costs no model call. Delete `.state/` to start over.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { baseUrl, progress } from './client.ts';
import { runScenario, type Scenario, saveScenario, scenarioFile } from './scenario.ts';
import { shoot } from './shots.ts';

const root = join(import.meta.dir, '..', '..');
const state = join(import.meta.dir, '.state');
const password = 'screenshots-pass-2026';

/** The providers the screenshots can run on, and the variable that holds each one's key. */
const keys = { anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY' } as const;

/** A provider the screenshots can run on. */
type Provider = keyof typeof keys;

/**
 * The provider asked for with `--provider`: Anthropic by default.
 *
 * @returns The provider.
 */
function providerOf(): Provider {
  const { values } = parseArgs({ options: { provider: { type: 'string' } } });
  const asked = values.provider ?? 'anthropic';
  if (asked in keys) return asked as Provider;
  process.stderr.write(`--provider is anthropic or gemini, not ${asked}.\n`);
  process.exit(1);
}

/**
 * The configuration directory quanthea reads: the instance's file and the provider's model file.
 *
 * @param provider - The provider.
 * @returns The directory.
 */
function configFor(provider: Provider): string {
  const directory = join(state, 'config');
  mkdirSync(directory, { recursive: true });
  copyFileSync(join(import.meta.dir, 'quanthea.yaml'), join(directory, 'quanthea.yaml'));
  copyFileSync(join(import.meta.dir, 'models', `${provider}.yaml`), join(directory, 'model.yaml'));
  return directory;
}

/**
 * Starts quanthea on the screenshot instance's configuration and state.
 *
 * @param provider - The model's provider.
 * @returns The server process.
 */
function startServer(provider: Provider) {
  mkdirSync(state, { recursive: true });
  return Bun.spawn(['bun', join(root, 'apps/server/src/main.ts')], {
    cwd: root,
    stdout: Bun.file(join(state, 'server.log')),
    stderr: Bun.file(join(state, 'server.log')),
    env: {
      ...process.env,
      QUANTHEA_CONFIG: configFor(provider),
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

const provider = providerOf();
if (!process.env[keys[provider]]) {
  process.stderr.write(`Set ${keys[provider]} to take the screenshots with ${provider}.\n`);
  process.exit(1);
}

// The channels' webhooks land here, so no message leaves the machine.
const receiver = Bun.serve({
  hostname: '127.0.0.1',
  port: 3991,
  fetch: () => new Response(null, { status: 204 }),
});
const server = startServer(provider);
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
