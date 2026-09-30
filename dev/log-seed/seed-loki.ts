/**
 * Pushes the request logs into Loki, once per data volume. Labels: `service`, `env` and `level`;
 * each line is the event as JSON, for `| json`. Usage: `bun seed-loki.ts <url>`.
 */
import { type LogEvent, logEvents } from './events.ts';

/** Lines per push. */
const batchSize = 5000;

/**
 * Whether Loki holds the logs already.
 *
 * @param base - The Loki URL.
 * @returns `true` when checkout-svc has logs in the last two days.
 */
async function seeded(base: string): Promise<boolean> {
  const since = (Date.now() - 2 * 86_400_000) * 1_000_000;
  const response = await fetch(`${base}/loki/api/v1/label/service/values?start=${since}`);
  const answer = (await response.json()) as { data?: string[] };
  return (answer.data ?? []).includes('checkout-svc');
}

/** One stream of a push: its labels, and its lines with their times in nanoseconds. */
interface Stream {
  /** The labels. */
  readonly stream: Readonly<Record<string, string>>;
  /** The lines, as `[nanoseconds, line]`. */
  readonly values: [string, string][];
}

/**
 * One push request: the events grouped into streams by their labels.
 *
 * @param events - The events.
 * @returns The push body.
 */
function pushBody(events: readonly LogEvent[]) {
  const streams = new Map<string, Stream>();
  for (const event of events) {
    const labels = { service: event.service, env: event.env, level: event.level };
    const key = JSON.stringify(labels);
    const stream: Stream = streams.get(key) ?? { stream: labels, values: [] };
    const nanoseconds = `${BigInt(Date.parse(event['@timestamp'])) * 1_000_000n}`;
    stream.values.push([nanoseconds, JSON.stringify(event)]);
    streams.set(key, stream);
  }
  return { streams: [...streams.values()] };
}

/**
 * Waits until Loki says it is ready, which takes a few seconds after it starts.
 *
 * @param base - The Loki URL.
 * @returns Once Loki is ready.
 * @throws {Error} When it is not ready within two minutes.
 */
async function ready(base: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/ready`).catch(() => undefined);
    if (response?.ok) return;
    await Bun.sleep(1000);
  }
  throw new Error(`${base} is not ready.`);
}

const base = process.argv[2] ?? 'http://127.0.0.1:3100';
await ready(base);
if (!(await seeded(base))) {
  const events = logEvents();
  for (let start = 0; start < events.length; start += batchSize) {
    const response = await fetch(`${base}/loki/api/v1/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pushBody(events.slice(start, start + batchSize))),
    });
    if (!response.ok) throw new Error(`push: ${response.status} ${await response.text()}`);
  }
  // Queries older than a few hours read the store, so the pushed chunks go there now.
  await fetch(`${base}/flush`, { method: 'POST' });
  process.stdout.write(`${base}: ${events.length} logs\n`);
}
