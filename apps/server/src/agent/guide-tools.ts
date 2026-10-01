/**
 * The tool that reads a connector kind's query guide: the instructions name the kinds in use, and
 * the agent reads a guide when it writes its first raw query or test query for that kind.
 */
import { tool } from 'ai';
import { z } from 'zod';

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
 * @param guides - The query guides of the connector kinds in use.
 * @returns The tools.
 */
export function guideTools(guides: readonly Guide[]) {
  return {
    read_guide: tool({
      description: `Read the query guide of a connector kind: how to get each shape of data from it, with examples, and its raw query syntax. Read it before the kind's first raw query or test_query. Kinds: ${kindsOf(guides)}.`,
      inputSchema: z.strictObject({ kind: z.string().max(40) }),
      execute: ({ kind }) => readGuide(guides, kind),
    }),
  };
}
