/**
 * What the agent asked the edit tool for, by panel: the built spec does not say which builder
 * wrote a query, so the evals read it from the edit calls of the thread that wrote a version.
 */
import { panelId } from '@quanthea/server/src/dashboards/panels/layout.ts';

/** A panel the agent asked the edit tool for, as the evals read it. */
export interface AskedPanel {
  /** Its title. */
  readonly title?: string;
  /** The id of the panel it replaces. */
  readonly replaces?: string;
  /** The data asked: its kind is a builder's name, `raw` or `saved`. */
  readonly data?: { readonly kind?: string };
  /** The chart asked. */
  readonly chart?: { readonly recipe?: string };
}

/** What a write told the model, as the evals read it. */
export interface WriteOutput {
  /** Whether the write saved a version. */
  readonly ok?: boolean;
  /** The new panels the version does not have, because they did not work. */
  readonly leftOut?: { readonly panelIds?: readonly string[] };
}

/** A part of a stored message, as far as an edit goes. */
interface EditPart {
  /** The part's type: an edit is `tool-edit_dashboard`. */
  readonly type: string;
  /** The edit's panels. */
  readonly input?: { readonly panels?: readonly AskedPanel[] };
  /** What the edit returned; none when the call never ended. */
  readonly output?: WriteOutput;
}

/**
 * A panel's title as the edit tool matches it: without the case and the spaces around it.
 *
 * @param title - The title.
 * @returns The key.
 */
function titleKey(title: string): string {
  return `title:${title.trim().toLowerCase()}`;
}

/**
 * Whether a write left a panel out of its version. Only a new panel can be left out, and its id
 * is made from its title, with a number after it when that id is taken.
 *
 * @param panel - The panel asked.
 * @param leftOut - The ids of the panels the write left out.
 * @returns Whether the panel is one of them.
 */
function isLeftOut(panel: AskedPanel, leftOut: readonly string[]): boolean {
  if (leftOut.length === 0 || typeof panel.replaces === 'string') return false;
  const base = panelId(panel.title ?? '', new Set());
  const numbered = (id: string) => id.startsWith(base) && /^-\d+$/.test(id.slice(base.length));
  return leftOut.some((id) => id === base || numbered(id));
}

/**
 * The panels of an edit that are in the version it wrote.
 *
 * @param part - A part of a message.
 * @returns The panels; none for another part, an edit that wrote no version, or a panel left out.
 */
function writtenPanels(part: EditPart): readonly AskedPanel[] {
  if (part.type !== 'tool-edit_dashboard' || part.output?.ok !== true) return [];
  const leftOut = part.output.leftOut?.panelIds ?? [];
  return (part.input?.panels ?? []).filter((panel) => !isLeftOut(panel, leftOut));
}

/**
 * What the agent asked the edit tool for, by panel, in the edits that wrote a version. A later
 * edit of a panel replaces an earlier one. A failed edit and a panel left out do not count: the
 * draft does not have them.
 *
 * @param messages - The thread's messages.
 * @returns The panels asked, under their title and under the id they replace.
 */
export function askedOf(
  messages: readonly { readonly parts: readonly EditPart[] }[],
): Map<string, AskedPanel> {
  const asked = new Map<string, AskedPanel>();
  const panels = messages.flatMap((message) => message.parts).flatMap(writtenPanels);
  for (const panel of panels) {
    if (typeof panel.title === 'string') asked.set(titleKey(panel.title), panel);
    if (typeof panel.replaces === 'string') asked.set(`id:${panel.replaces}`, panel);
  }
  return asked;
}

/**
 * What the agent asked for a built panel: its data kind and its chart recipe.
 *
 * @param panel - The built panel.
 * @param asked - The panels asked.
 * @returns The fields to spread; none when no edit on record names the panel.
 */
export function askedFields(
  panel: { readonly id: string; readonly title: string },
  asked: ReadonlyMap<string, AskedPanel>,
): { builder?: string; recipe?: string } {
  const request = asked.get(titleKey(panel.title)) ?? asked.get(`id:${panel.id}`);
  const builder = request?.data?.kind;
  const recipe = request?.chart?.recipe;
  return {
    ...(typeof builder === 'string' ? { builder } : {}),
    ...(typeof recipe === 'string' ? { recipe } : {}),
  };
}
