/**
 * The two kinds of conversation a person starts: a dashboard or an alert. Each has its words on
 * the new-conversation screen and its example requests. A link picks one with `?make=alert`.
 */
import type { ThreadKind } from '@quanthea/shared';

/** What the new-conversation screen says for each kind. */
export const kindWords: Readonly<
  Record<
    ThreadKind,
    {
      readonly label: string;
      readonly placeholder: string;
      readonly examples: readonly string[];
      readonly note: string;
    }
  >
> = {
  dashboard: {
    label: 'A dashboard',
    placeholder: 'What happened to checkout yesterday around 14:00?',
    examples: [
      'What happened to checkout yesterday around 14:00?',
      'Error rate and latency of every service over the last 24 hours',
      'Orders per hour this week, by payment method',
    ],
    note: 'The agent explores your connectors, proposes a plan, then builds a live dashboard you can refine and pin.',
  },
  alert: {
    label: 'An alert',
    placeholder: 'Tell me when…',
    examples: [
      'Tell me when the 5xx rate of any service stays above 2% for 5 minutes',
      'Warn me if p95 latency of any route passes 2 s',
      'Alert if no orders arrive for 10 minutes',
    ],
    note: 'The agent proposes what to watch and when it fires, writes the alert, and shows how it would have fired over the last week. You activate it.',
  },
};

/**
 * The kind a link asks for.
 *
 * @param make - The `?make=` parameter, if any.
 * @returns `alert` for `?make=alert`, else a dashboard.
 */
export function kindFrom(make: string | null): ThreadKind {
  return make === 'alert' ? 'alert' : 'dashboard';
}
