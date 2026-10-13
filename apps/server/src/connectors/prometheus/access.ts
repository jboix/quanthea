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

/** The receivers older servers turn on through `--enable-feature`, with what each lets in. */
const writeFeatures: readonly (readonly [feature: string, finding: string])[] = [
  ['remote-write-receiver', 'The server accepts remote writes: a request can add samples.'],
  ['otlp-write-receiver', 'The server accepts OTLP writes: a request can add samples.'],
];

/** The flags every Prometheus server lists: without them the answer is of something else. */
const knownFlags = ['web.enable-admin-api', 'web.enable-lifecycle'] as const;

/** What to change on a server that takes more than reads, for the admin to copy. */
export const readOnlyFlags = `# Start Prometheus without these flags:
#   --web.enable-admin-api
#   --web.enable-lifecycle
#   --web.enable-remote-write-receiver
#   --web.enable-otlp-receiver
#   --enable-feature=remote-write-receiver or otlp-write-receiver`;

/**
 * What the flags of a server open beyond reading.
 *
 * @param flags - The flags, by name, as the status API gives them.
 * @returns One sentence per API that is on, by its own flag or by `--enable-feature`, which
 *   turned the receivers on before they had a flag.
 */
export function flagFindings(flags: Readonly<Record<string, string>>): string[] {
  const features = (flags['enable-feature'] ?? '').split(',').map((feature) => feature.trim());
  const found = [
    ...writeFlags.filter(([flag]) => flags[flag] === 'true'),
    ...writeFeatures.filter(([feature]) => features.includes(feature)),
  ];
  return [...new Set(found.map(([, finding]) => finding))];
}

/**
 * Whether an answer is the flags of a Prometheus server: it says whether the admin and the
 * lifecycle APIs are on. A server that answers the endpoint with other flags, or with none, as
 * one that only speaks the query API may, says nothing of what it accepts.
 *
 * @param flags - The flags, by name.
 * @returns `true` when each known flag reads `true` or `false`.
 */
function listsItsFlags(flags: Readonly<Record<string, string>>): boolean {
  return knownFlags.every((flag) => flags[flag] === 'true' || flags[flag] === 'false');
}

/** What the test says of a server whose flags it could not read. */
const unknownAccess: ServerAccess = {
  readOnly: null,
  canDo: [],
  sentence: 'It does not list its flags, so whether a request can write is unknown.',
};

/**
 * Reads what a request to the server can do beyond reading.
 *
 * @param api - The API client.
 * @param signal - The caller's signal.
 * @returns Able to write when a write API is on, read-only when the server lists its flags and
 *   none is, and unknown otherwise, as for a server that only speaks the Prometheus query API.
 */
export async function serverAccess(api: PrometheusApi, signal: AbortSignal): Promise<ServerAccess> {
  try {
    const answer = await api.get<Record<string, string>>('/api/v1/status/flags', {}, signal);
    const flags = answer.data ?? {};
    const canDo = flagFindings(flags);
    if (canDo.length > 0) return { readOnly: false, canDo, sentence: 'It takes more than reads.' };
    if (!listsItsFlags(flags)) return unknownAccess;
    return { readOnly: true, canDo, sentence: 'Its admin, lifecycle and write APIs are off.' };
  } catch {
    return unknownAccess;
  }
}
