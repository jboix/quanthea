/**
 * A built panel's filters as a definition's checked body. The spec keeps only the queries a
 * panel runs; the builder request it was built from is the input of the edit that wrote it, in
 * the thread. Its fields that carry the meaning become the body; how the panel presents the data
 * (its connector, split, period, limit, bucket) stays with the panel.
 */
import {
  bodyLanguage,
  type Definition,
  type DefinitionBody,
  type DefinitionShape,
  queryBuilders,
} from '@quanthea/shared';
import { isToolPart, type ThreadMessage } from './messages.ts';

/** The request fields that present the data rather than say what it means. */
const presentation = new Set(['connector', 'by', 'over', 'limit', 'bucket', 'series', 'time']);

/** A panel of an edit's input, loosely read. */
interface EditedPanel {
  readonly title?: unknown;
  readonly replaces?: unknown;
  readonly data?: { readonly kind?: unknown } & Record<string, unknown>;
}

/**
 * A panel id from a title, as the server makes it.
 *
 * @param title - The title.
 * @returns Such as `error-rate`.
 */
function idOf(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return slug || 'panel';
}

/**
 * The panels of the edits that saved a version, the latest edit first.
 *
 * @param messages - The thread's messages.
 * @returns The panels as the edits asked for them.
 */
function editedPanels(messages: readonly ThreadMessage[]): EditedPanel[] {
  const parts = messages
    .flatMap((message) => message.parts)
    .flatMap((part) => (isToolPart(part) ? [part] : []));
  return parts
    .filter((part) => part.type === 'tool-edit_dashboard' && part.state === 'output-available')
    .filter((part) => (part.output as { ok?: unknown } | undefined)?.ok === true)
    .reverse()
    .flatMap((part) => (part.input as { panels?: EditedPanel[] } | undefined)?.panels ?? []);
}

/**
 * The builder request a panel was last built from, if it was built with a query builder.
 *
 * @param messages - The thread's messages.
 * @param panel - The panel.
 * @param panel.id - Its id.
 * @param panel.title - Its title.
 * @returns The request, or nothing for a raw or saved query, or a panel the thread did not build.
 */
export function builderRequestOf(
  messages: readonly ThreadMessage[],
  panel: { readonly id: string; readonly title: string },
): Record<string, unknown> | undefined {
  const edited = editedPanels(messages).find(
    (each) =>
      each.replaces === panel.id ||
      (typeof each.title === 'string' && idOf(each.title) === panel.id),
  );
  const kind = edited?.data?.kind;
  if (typeof kind !== 'string' || !queryBuilders.some((builder) => builder.id === kind))
    return undefined;
  return edited?.data;
}

/**
 * The body a builder request makes: a ratio from a ratio builder, a segment from a builder of
 * rows, a measure otherwise; without the fields that present the data.
 *
 * @param request - The builder request.
 * @returns The body.
 */
export function bodyOfRequest(request: Readonly<Record<string, unknown>>): DefinitionBody {
  const kind = String(request.kind);
  const ratio = kind === 'ratio' || kind.endsWith('-ratio');
  const rows = kind.endsWith('-rows') || kind === 'logql-lines';
  const shape: DefinitionShape = ratio ? 'ratio' : rows ? 'segment' : 'measure';
  const fields = Object.entries(request).filter(([key]) => !presentation.has(key));
  return { shape, request: { ...Object.fromEntries(fields), kind } };
}

/**
 * A definition with a body put in, in place of the body it had for that language.
 *
 * @param definition - The definition.
 * @param body - The body.
 * @returns The definition.
 */
export function withBody(definition: Definition, body: DefinitionBody): Definition {
  const language = bodyLanguage(body);
  const others = definition.bodies.filter((each) => bodyLanguage(each) !== language);
  return { ...definition, bodies: [...others, body] };
}
