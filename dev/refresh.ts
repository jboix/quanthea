/**
 * Runs before `bun run env:up`: when a profile's data volumes were created before today (UTC), it
 * removes them and the containers that use them, so the `up` that follows seeds the data again
 * around the new yesterday. Usage: `bun refresh.ts <profile>`, `core` for the services of no
 * profile.
 */
import { join } from 'node:path';

/** The compose project, as `docker compose` names its volumes. */
const project = 'quanthea-dev';

/** The compose file. */
const composeFile = join(import.meta.dir, 'docker-compose.yml');

/** A service of the compose file, as this script reads it. */
interface Service {
  /** The profiles it belongs to; none for the core services. */
  readonly profiles?: readonly string[];
  /** Its mounts, such as `postgres-data:/var/lib/postgresql`. */
  readonly volumes?: readonly string[];
}

/** The compose file, as this script reads it. */
interface Compose {
  /** The services by name. */
  readonly services: Readonly<Record<string, Service>>;
  /** The named volumes. */
  readonly volumes: Readonly<Record<string, unknown>>;
}

/**
 * The named volumes a service mounts.
 *
 * @param service - The service.
 * @param named - The compose file's named volumes.
 * @returns Their names.
 */
function volumesOf(service: Service, named: ReadonlySet<string>): string[] {
  return (service.volumes ?? [])
    .map((mount) => mount.split(':')[0] ?? '')
    .filter((name) => named.has(name));
}

/**
 * When a volume was created, if it exists.
 *
 * @param volume - Its name in the compose file.
 * @returns The instant, or `undefined` when there is no such volume yet.
 */
function createdAt(volume: string): Date | undefined {
  const inspect = Bun.spawnSync([
    'docker',
    'volume',
    'inspect',
    '--format',
    '{{.CreatedAt}}',
    `${project}_${volume}`,
  ]);
  if (inspect.exitCode !== 0) return undefined;
  return new Date(inspect.stdout.toString().trim());
}

/**
 * Whether an instant falls on an earlier UTC day than today.
 *
 * @param date - The instant.
 * @returns Whether it is before today's midnight UTC.
 */
function beforeToday(date: Date): boolean {
  const today = new Date();
  return date.getTime() < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
}

/**
 * Runs a command, its output shown, and stops on a failure.
 *
 * @param command - The command and its arguments.
 */
function run(command: string[]): void {
  const result = Bun.spawnSync(command, { stdout: 'inherit', stderr: 'inherit' });
  if (result.exitCode !== 0) throw new Error(`${command.join(' ')} failed.`);
}

/**
 * The data volumes of a profile created before today.
 *
 * @param compose - The compose file.
 * @param profile - The profile, or `core`.
 * @returns Their names in the compose file.
 */
function staleVolumes(compose: Compose, profile: string): string[] {
  const named = new Set(Object.keys(compose.volumes));
  const inProfile = Object.values(compose.services).filter((service) =>
    profile === 'core' ? service.profiles === undefined : service.profiles?.includes(profile),
  );
  const volumes = [...new Set(inProfile.flatMap((service) => volumesOf(service, named)))];
  return volumes.filter((volume) => {
    const created = createdAt(volume);
    return created !== undefined && beforeToday(created);
  });
}

/**
 * Removes volumes, with the containers that mount them.
 *
 * @param compose - The compose file.
 * @param stale - The volumes' names in the compose file.
 */
function remove(compose: Compose, stale: readonly string[]): void {
  const named = new Set(Object.keys(compose.volumes));
  const users = Object.entries(compose.services).flatMap(([name, service]) =>
    volumesOf(service, named).some((volume) => stale.includes(volume)) ? [name] : [],
  );
  const dockerCompose = ['docker', 'compose', '-f', composeFile, '--profile', '*'];
  run([...dockerCompose, 'rm', '--stop', '--force', ...users]);
  run(['docker', 'volume', 'rm', ...stale.map((volume) => `${project}_${volume}`)]);
}

const profile = process.argv[2] ?? 'core';
const compose = Bun.YAML.parse(await Bun.file(composeFile).text()) as Compose;
const stale = staleVolumes(compose, profile);
if (stale.length > 0) {
  process.stdout.write(
    `The ${profile} data was seeded before today: seeding it again around yesterday.\n`,
  );
  remove(compose, stale);
}
