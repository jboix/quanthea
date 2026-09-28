/**
 * Keeps what the model rereads small. Every request carries the whole conversation, so earlier
 * turns lose their tool calls to one-line notes, and within a run, older large tool results and
 * older drafts shrink the same way. The stored conversation keeps everything; only what is sent
 * to the model is compacted.
 */
import type { ModelMessage } from 'ai';
import type { ThreadMessage } from './run-context.ts';

/** A tool result longer than this, as JSON, is summarized once it is no longer the latest. */
const largeResult = 400;

/** How many of the latest model messages a run keeps whole: the last call and its results. */
const keptWhole = 2;

/** The tools whose input is a whole draft. */
const writeTools: ReadonlySet<string> = new Set(['write_dashboard', 'patch_panel']);

/** A loosely read tool input or output. */
type Loose = Record<string, unknown> | undefined;

/**
 * A count with its noun.
 *
 * @param count - The count.
 * @param singular - The noun for one.
 * @param plural - The noun for any other count.
 * @returns Such as `1 entity` or `3 entities`.
 */
function counted(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * The outcome words of a tool that answers `{ ok, error }`.
 *
 * @param output - The output.
 * @param success - The words when it worked.
 * @returns The words.
 */
function outcome(output: Loose, success: () => string): string {
  if (output?.ok === false) return `failed: ${String(output.error ?? 'error')}`;
  return success();
}

/** How each tool's call reads in one line. */
const summaries: Readonly<Record<string, (input: Loose, output: Loose) => string>> = {
  describe: (input, output) =>
    `describe(${String(input?.connector ?? '')}): ${outcome(output, () =>
      counted((output?.entities as unknown[] | undefined)?.length ?? 0, 'entity', 'entities'),
    )}`,
  sample_values: (input, output) =>
    `sample_values(${String(input?.entity ?? '')}.${String(input?.field ?? '')}): ${outcome(
      output,
      () => ((output?.values as string[] | undefined) ?? []).slice(0, 10).join(', '),
    )}`,
  test_query: (input, output) =>
    `test_query(${String(input?.connector ?? '')}): ${outcome(output, () => 'ok')}`,
  propose_plan: (input) =>
    `propose_plan: "${String(input?.title ?? '')}", ${counted((input?.panels as unknown[] | undefined)?.length ?? 0, 'panel')}`,
  ask_person: (input) =>
    `ask_person: "${String(input?.question ?? '')}" options ${JSON.stringify(input?.options ?? [])}`,
  write_dashboard: (_input, output) =>
    `write_dashboard: ${outcome(output, () => `saved version ${String(output?.version)}`)}`,
  patch_panel: (input, output) =>
    `patch_panel(${String(input?.panelId ?? '')}): ${outcome(output, () => `saved version ${String(output?.version)}`)}`,
};

/**
 * One tool call in a line.
 *
 * @param name - The tool.
 * @param input - What the model asked for, if known.
 * @param output - What the tool returned, if it did.
 * @returns The line.
 */
export function toolSummary(name: string, input: unknown, output: unknown): string {
  const summarize = summaries[name];
  return summarize ? summarize(input as Loose, output as Loose) : `${name}: done`;
}

/** A message part as the compaction reads it. */
type LoosePart = { readonly type: string } & Record<string, unknown>;

/**
 * An earlier turn's part as the model rereads it: tool calls become a note, data and reasoning
 * parts go, text stays.
 *
 * @param part - The part.
 * @returns The part to keep, or nothing.
 */
function earlierPart(part: LoosePart): LoosePart[] {
  if (part.type.startsWith('tool-')) {
    const summary = toolSummary(part.type.slice('tool-'.length), part.input, part.output);
    return [{ type: 'text', text: `[earlier tool call] ${summary}` }];
  }
  return part.type === 'text' ? [part] : [];
}

/**
 * The conversation as the model rereads it: the turns before the person's latest message keep
 * their text and a note per tool call; the latest turn stays whole.
 *
 * @param messages - The conversation.
 * @returns The compacted conversation.
 */
export function compactHistory(messages: readonly ThreadMessage[]): ThreadMessage[] {
  const latestUser = messages.findLastIndex((message) => message.role === 'user');
  return messages.map((message, index) => {
    if (index >= latestUser || message.role !== 'assistant') return message;
    const parts = (message.parts as unknown as LoosePart[]).flatMap(earlierPart);
    return { ...message, parts: parts as unknown as ThreadMessage['parts'] };
  });
}

/**
 * A model message part of a run's older steps, made small: a draft's input is elided, and a
 * large result is summarized.
 *
 * @param part - The part.
 * @returns The part, possibly smaller.
 */
function olderPart(part: LoosePart): LoosePart {
  if (part.type === 'tool-call' && writeTools.has(String(part.toolName))) {
    return { ...part, input: { elided: 'an earlier draft; the latest one is below' } };
  }
  if (part.type !== 'tool-result') return part;
  const output = part.output as { type?: string; value?: unknown } | undefined;
  if (JSON.stringify(output?.value ?? '').length <= largeResult) return part;
  const value = toolSummary(String(part.toolName), undefined, output?.value);
  return { ...part, output: { type: 'text', value } };
}

/**
 * A run's messages with its older steps made small, keeping the latest call and its results whole.
 *
 * @param messages - The messages the next step would send.
 * @returns The compacted messages.
 */
export function compactSteps(messages: readonly ModelMessage[]): ModelMessage[] {
  const cut = messages.length - keptWhole;
  return messages.map((message, index) => {
    if (index >= cut || typeof message.content === 'string') return message;
    const content = (message.content as unknown as LoosePart[]).map(olderPart);
    return { ...message, content } as unknown as ModelMessage;
  });
}
