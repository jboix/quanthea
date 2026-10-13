/**
 * What whoever reaches a Prometheus server may do beyond reading, from the flags it was started
 * with. Prometheus has no users: an API that is on is on for every request. The flags are read
 * from the status API, and nothing is tried.
 */
import type { PrometheusApi } from './api.ts';

/** What a connection test says about the server. */
export interface ServerAccess {
  /** Whether a request can only read, or `null` when the server does not list its flags. */
  readonly readOnly: boolean | null;
  /** What a request can do beyond reading, one sentence each. */
  readonly canDo: readonly string[];
  /** One sentence for the test's message. */
  readonly sentence: string;
}

/** The flags that open an API that changes the server, with what it lets a request do. */
const writeFlags: readonly (readonly [flag: string, finding: string])[] = [
  ['web.enable-admin-api', 'The admin API is on: a request can delete series and take snapshots.'],
  [
    'web.enable-lifecycle',
    'The lifecycle API is on: a request can reload or shut down the server.',
  ],
  [
    'web.enable-remote-write-receiver',
    'The server accepts remote writes: a request can add samples.',
  ],
  ['web.enable-otlp-receiver', 'The server accepts OTLP writes: a request can add samples.'],
];

/** What to change on a server that takes more than reads, for the admin to copy. */
export const readOnlyFlags = `# Start Prometheus without these flags:
#   --web.enable-admin-api
#   --web.enable-lifecycle
#   --web.enable-remote-write-receiver
#   --web.enable-otlp-receiver`;

/**
 * What the flags of a server open beyond reading.
 *
 * @param flags - The flags, by name, as the status API gives them.
 * @returns One sentence per API that is on.
 */
export function flagFindings(flags: Readonly<Record<string, string>>): string[] {
  return writeFlags.filter(([flag]) => flags[flag] === 'true').map(([, finding]) => finding);
}

/**
 * Reads what a request to the server can do beyond reading.
 *
 * @param api - The API client.
 * @param signal - The caller's signal.
 * @returns Read-only when no write API is on, unknown when the server lists no flags, as a
 *   server that only speaks the Prometheus query API does.
 */
export async function serverAccess(api: PrometheusApi, signal: AbortSignal): Promise<ServerAccess> {
  try {
    const flags = await api.get<Record<string, string>>('/api/v1/status/flags', {}, signal);
    const canDo = flagFindings(flags.data ?? {});
    if (canDo.length === 0)
      return { readOnly: true, canDo, sentence: 'Its admin, lifecycle and write APIs are off.' };
    return { readOnly: false, canDo, sentence: 'It takes more than reads.' };
  } catch {
    const sentence = 'It does not list its flags, so whether a request can write is unknown.';
    return { readOnly: null, canDo: [], sentence };
  }
}
