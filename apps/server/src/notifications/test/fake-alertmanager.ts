/**
 * A fake Prometheus Alertmanager, in process: the v2 API's `POST /api/v2/alerts`, with the rules
 * the real one applies. It refuses what is not a list of alerts with valid labels, tells alerts
 * apart by their labels, keeps the earliest start, gives an alert without an end its
 * `resolve_timeout`, and can ask for credentials.
 */

/** An alert as the fake keeps it. */
export interface KeptAlert {
  /** What tells it apart. */
  readonly labels: Readonly<Record<string, string>>;
  /** What it says. */
  readonly annotations: Readonly<Record<string, string>>;
  /** Since when it fires, in epoch milliseconds. */
  readonly startsAt: number;
  /** Until when it holds, in epoch milliseconds. */
  readonly endsAt: number;
  /** The link back, if it gave one. */
  readonly generatorURL: string | undefined;
}

/** How the fake is set up. */
interface FakeOptions {
  /** The `Authorization` header it asks for, if any. */
  readonly authorization?: string;
  /** The route prefix it answers under, such as `/alertmanager`. */
  readonly prefix?: string;
  /** Its `resolve_timeout`, in milliseconds; five minutes by default, as the real one. */
  readonly resolveTimeoutMs?: number;
}

/** The fake, running. */
export interface FakeAlertmanager {
  /** Its base URL. */
  readonly url: string;
  /** Every alert it keeps, in the order first told. */
  readonly alerts: () => KeptAlert[];
  /** The alerts that fire at an instant. */
  readonly firingAt: (at: number) => KeptAlert[];
  /** Sets its clock, in epoch milliseconds. */
  readonly setNow: (at: number) => void;
  /** Stops it. */
  readonly stop: () => Promise<void>;
}

/** A label name the real one accepts. */
const labelNamePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** An alert as posted, loosely. */
type Posted = Partial<
  Record<'labels' | 'annotations' | 'startsAt' | 'endsAt' | 'generatorURL', unknown>
>;

/**
 * Why a posted alert is refused, if it is.
 *
 * @param posted - The alert.
 * @returns The reason, or `null`.
 */
function problemOf(posted: Posted): string | null {
  const labels = Object.entries((posted.labels ?? {}) as Record<string, unknown>);
  if (labels.length === 0) return 'at least one label pair required';
  const bad = labels.find(([name, value]) => !labelNamePattern.test(name) || value === '');
  if (bad) return `invalid label ${bad[0]}`;
  const starts = Date.parse(String(posted.startsAt ?? ''));
  const ends = Date.parse(String(posted.endsAt ?? ''));
  return starts > ends ? 'start time must be before end time' : null;
}

/**
 * The key of an alert: its labels, in the order of their names.
 *
 * @param labels - The labels.
 * @returns The key.
 */
function fingerprintOf(labels: Readonly<Record<string, string>>): string {
  return JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * A posted alert as the real one keeps it: without a start it starts at its end or now, and
 * without an end it holds for the resolve timeout.
 *
 * @param posted - The alert.
 * @param previous - The alert kept under the same labels, if any.
 * @param clock - Now, and the resolve timeout.
 * @returns The alert to keep.
 */
function keep(
  posted: Posted,
  previous: KeptAlert | undefined,
  clock: { readonly now: number; readonly resolveTimeoutMs: number },
): KeptAlert {
  const ends = posted.endsAt === undefined ? undefined : Date.parse(String(posted.endsAt));
  const starts =
    posted.startsAt === undefined ? (ends ?? clock.now) : Date.parse(String(posted.startsAt));
  return {
    labels: posted.labels as Record<string, string>,
    annotations: (posted.annotations ?? {}) as Record<string, string>,
    startsAt: Math.min(starts, previous?.startsAt ?? starts),
    endsAt: ends ?? clock.now + clock.resolveTimeoutMs,
    generatorURL: typeof posted.generatorURL === 'string' ? posted.generatorURL : undefined,
  };
}

/**
 * Answers one request as the real one does.
 *
 * @param request - The request.
 * @param options - The credentials and the prefix.
 * @returns The alerts posted, or the refusal.
 */
async function read(request: Request, options: FakeOptions): Promise<Posted[] | Response> {
  const { pathname } = new URL(request.url);
  if (request.method !== 'POST' || pathname !== `${options.prefix ?? ''}/api/v2/alerts`)
    return new Response('404 page not found', { status: 404 });
  const given = request.headers.get('authorization');
  // A proxy in front of the real one may quote what it was given.
  if (options.authorization && given !== options.authorization)
    return new Response(`Unauthorized: ${given}`, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!Array.isArray(body))
    return Response.json({ code: 400, message: 'not a list' }, { status: 400 });
  const problem = body.map(problemOf).find((each) => each !== null);
  return problem ? Response.json(problem, { status: 400 }) : (body as Posted[]);
}

/**
 * Starts a fake Alertmanager on a free local port.
 *
 * @param options - The credentials it asks for, its route prefix and its resolve timeout.
 * @returns The fake.
 */
export function startFakeAlertmanager(options: FakeOptions = {}): FakeAlertmanager {
  const kept = new Map<string, KeptAlert>();
  const clock = { now: 0, resolveTimeoutMs: options.resolveTimeoutMs ?? 5 * 60_000 };
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (request) => {
      const posted = await read(request, options);
      if (posted instanceof Response) return posted;
      for (const alert of posted) {
        const key = fingerprintOf(alert.labels as Record<string, string>);
        kept.set(key, keep(alert, kept.get(key), clock));
      }
      return new Response(null, { status: 200 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}${options.prefix ?? ''}`,
    alerts: () => [...kept.values()],
    firingAt: (at) =>
      [...kept.values()].filter((alert) => alert.startsAt <= at && at < alert.endsAt),
    setNow: (at) => {
      clock.now = at;
    },
    stop: () => server.stop(true),
  };
}
