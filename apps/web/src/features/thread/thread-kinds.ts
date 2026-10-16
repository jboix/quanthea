/**
 * The three kinds of conversation a person starts from the new-conversation screen: a dashboard,
 * an alert or a report. Each has its words there. A link picks one with `?make=alert` or `?make=report`,
 * and fills the box with `?prompt=` (or `?question=`).
 */
import { type ThreadKind, threadKinds } from '@quanthea/shared';

/** The kinds the new-conversation screen starts; definitions start on the definitions screen. */
export type StartedKind = Exclude<ThreadKind, 'definition'>;

/**
 * What the new-conversation screen says for each kind. A placeholder names nothing a data source
 * may not have: no service, no table, no metric.
 */
export const kindWords: Readonly<
  Record<
    StartedKind,
    {
      readonly label: string;
      readonly placeholder: string;
      readonly note: string;
    }
  >
> = {
  dashboard: {
    label: 'A dashboard',
    placeholder: 'What do you want to see?',
    note: 'The agent explores your connectors, proposes a plan, then builds a live dashboard you can refine and pin.',
  },
  alert: {
    label: 'An alert',
    placeholder: 'Tell me when…',
    note: 'The agent proposes what to watch and when it fires, writes the alert, and shows how it would have fired over the last week. You activate it.',
  },
  report: {
    label: 'A report',
    placeholder: 'Every Monday at 8:00, last week’s…',
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
export function kindFrom(make: string | null): StartedKind {
  const named = threadKinds.find((kind) => kind === make);
  return named === undefined || named === 'definition' ? 'dashboard' : named;
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
