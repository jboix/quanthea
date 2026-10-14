/**
 * The tool that reads a guide the instructions do not carry: a connector kind's query guide, which
 * the agent reads when it writes its first raw query or test query for that kind, and how to set
 * markers, which it reads before it sets any.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { markersGuide, settingsGuide } from './prompt-text.ts';

/** The guide to markers, under the name the instructions give it. */
export const markersTopic = { kind: 'markers', text: markersGuide };

/**
 * The guide to a dashboard's settings: variables, one colour per value and markers. Reading it
 * offers edit_settings from the next step on.
 */
export const settingsTopic = { kind: 'settings', text: settingsGuide };

/** A connector kind's query guide. */
interface Guide {
  /** The kind, such as `postgres`. */
  readonly kind: string;
  /** The guide. */
  readonly text: string;
}

/**
 * A kind's guide, or which kinds there are.
 *
 * @param guides - The query guides of the connector kinds in use.
 * @param kind - The kind asked for.
 * @returns The guide, or an error naming the kinds.
 */
export function readGuide(guides: readonly Guide[], kind: string) {
  const guide = guides.find((each) => each.kind === kind);
  if (guide) return { kind, guide: guide.text };
  return { error: `No guide for "${kind}". Kinds: ${kindsOf(guides)}.` };
}

/**
 * The kinds that have a guide, for messages.
 *
 * @param guides - The guides.
 * @returns Such as `postgres, loki`, or `none`.
 */
function kindsOf(guides: readonly Guide[]): string {
  return guides.map((guide) => guide.kind).join(', ') || 'none';
}

/**
 * Creates the guide tool.
 *
 * @param guides - The query guides of the connector kinds in use, and the topics.
 * @param onRead - Called with each kind whose guide was read.
 * @returns The tools.
 */
export function guideTools(guides: readonly Guide[], onRead?: (kind: string) => void) {
  return {
    read_guide: tool({
      description: `Read the query guide of a connector kind: how to get each shape of data from it, with examples, and its raw query syntax. Read it before the kind's first raw query or test_query. Kinds: ${kindsOf(guides)}.`,
      inputSchema: z.strictObject({ kind: z.string().max(40) }),
      execute: ({ kind }) => {
        const read = readGuide(guides, kind);
        if ('guide' in read) onRead?.(kind);
        return read;
      },
    }),
  };
}
