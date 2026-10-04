/**
 * The three kinds of conversation a person starts: a dashboard, an alert or a report. Each has its
 * words on the new-conversation screen and its example requests. A link picks one with
 * `?make=alert` or `?make=report`, and fills the box with `?prompt=` (or `?question=`).
 */
import { type ThreadKind, threadKinds } from '@quanthea/shared';

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
  report: {
    label: 'A report',
    placeholder: 'Every Monday at 8:00, last week’s…',
    examples: [
      'Each morning, yesterday’s failed payments by provider',
      'On the 1st, last month’s revenue per country',
      'Every Monday at 8:00, last week’s sales',
    ],
    note: 'The agent writes the report once. Each run then queries the data on schedule and fills the same numbers, with no model involved.',
  },
};

/** The longest text a link may put in the box, in characters. */
export const maxPromptLength = 2000;

/**
 * The kind a link asks for.
 *
 * @param make - The `?make=` parameter, if any.
 * @returns The kind it names, else a dashboard.
 */
export function kindFrom(make: string | null): ThreadKind {
  return threadKinds.find((kind) => kind === make) ?? 'dashboard';
}

/**
 * Whether a character may stay in the box: anything but a control character, line breaks and
 * tabs apart.
 *
 * @param char - One character.
 * @returns Whether it stays.
 */
function isPrintable(char: string): boolean {
  if (char === '\n' || char === '\t') return true;
  const code = char.codePointAt(0) ?? 0;
  return code >= 0x20 && code !== 0x7f;
}

/**
 * The text a link puts in the box: `?prompt=`, else `?question=`, without control characters
 * other than line breaks and tabs, trimmed and cut to {@link maxPromptLength}. The box is only
 * filled; nothing is sent until the person sends it.
 *
 * @param params - The page's search parameters.
 * @returns The text, empty when the link gives none.
 */
export function promptFrom(params: URLSearchParams): string {
  const given = params.get('prompt') ?? params.get('question') ?? '';
  const printable = [...given].filter(isPrintable).join('');
  return printable.trim().slice(0, maxPromptLength);
}
