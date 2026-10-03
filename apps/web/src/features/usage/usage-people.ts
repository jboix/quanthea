/** What each user spent: the model steps of their threads and of their questions about dashboards. */
import type { Role, UsageReport } from '@quanthea/shared';

/** What one user spent over the range. */
export interface PersonUsage {
  /** The user's id; empty for steps that ran for no one, such as tagging a dashboard at pin time. */
  readonly userId: string;
  /** Their name. */
  readonly name: string;
  /** Their role, or `null` when there is no such user. */
  readonly role: Role | null;
  /** How many model steps. */
  readonly steps: number;
  /** All their tokens. */
  readonly tokens: number;
  /** The list-price cost, in US dollars. */
  readonly dollars: number;
  /** Whether a step had no price. */
  readonly unpriced: boolean;
}

/**
 * The usage of each user over the range, the costliest first, then the most tokens.
 *
 * @param report - The report.
 * @returns One row per user who ran a model step.
 */
export function usageByUser(report: UsageReport): PersonUsage[] {
  const people = new Map<string, PersonUsage>();
  for (const bucket of report.buckets) {
    if (bucket.kind !== 'model') continue;
    const known = report.people[bucket.userId];
    const before = people.get(bucket.userId) ?? {
      userId: bucket.userId,
      name: known?.name ?? 'No one: tags at pin time',
      role: known?.role ?? null,
      steps: 0,
      tokens: 0,
      dollars: 0,
      unpriced: false,
    };
    const tokens = bucket.input + bucket.cachedInput + bucket.cacheWrite + bucket.output;
    people.set(bucket.userId, {
      ...before,
      steps: before.steps + bucket.events,
      tokens: before.tokens + tokens,
      dollars: before.dollars + bucket.dollars,
      unpriced: before.unpriced || bucket.unpriced > 0,
    });
  }
  return [...people.values()].sort(
    (first, second) => second.dollars - first.dollars || second.tokens - first.tokens,
  );
}
