/**
 * Thread messages as the web app reads them: the AI SDK UI message with querent's custom parts,
 * and the words each tool call shows in the conversation.
 */
import type { ThreadData } from '@querent/shared';
import type { UIMessage } from 'ai';

/** Metadata of a user message: the panels it mentions and the person's time zone. */
export interface UserMetadata {
  /** The panels the message is about. */
  readonly mentions?: readonly { readonly panelId: string; readonly title: string }[];
  /** The browser's IANA time zone. */
  readonly timeZone?: string;
}

/** A thread message. */
export type ThreadMessage = UIMessage<UserMetadata & { readonly tokens?: number }, ThreadData>;

/** One part of a thread message. */
export type ThreadPart = ThreadMessage['parts'][number];

/** A tool part, whatever its tool: its name comes from its type, `tool-<name>`. */
export interface ToolPart {
  /** `tool-<name>`. */
  readonly type: `tool-${string}`;
  /** The call id. */
  readonly toolCallId: string;
  /** How far the call got. */
  readonly state: string;
  /** What the model asked for. */
  readonly input?: unknown;
  /** What the tool returned. */
  readonly output?: unknown;
  /** Why the call failed. */
  readonly errorText?: string;
}

/** The tools that explore, shown together as "Explored". */
export const exploreTools: ReadonlySet<string> = new Set([
  'list_connectors',
  'describe',
  'sample_values',
  'test_query',
]);

/** The tools that write a version, shown as "Built". */
export const buildTools: ReadonlySet<string> = new Set(['write_dashboard', 'patch_panel']);

/**
 * Whether a part is a tool call.
 *
 * @param part - A message part.
 * @returns Whether it is a `tool-*` part.
 */
export function isToolPart(part: { type: string }): part is ToolPart {
  return part.type.startsWith('tool-');
}

/**
 * The tool name of a tool part.
 *
 * @param part - The part.
 * @returns Such as `describe`.
 */
export function toolName(part: ToolPart): string {
  return part.type.slice('tool-'.length);
}

/** A result frame's shape, as the gate lets the model see it. */
interface ShapeFrame {
  /** How many rows. */
  readonly rowCount?: number;
}

/**
 * Words for the shape of a query result.
 *
 * @param frames - The frames the gate returned, if any.
 * @returns Such as `1 row`, `12 rows` or `3 series · 90 points`.
 */
export function shapeOf(frames: readonly ShapeFrame[] | undefined): string {
  if (!frames) return 'ok';
  const rows = frames.reduce((sum, frame) => sum + (frame.rowCount ?? 0), 0);
  if (frames.length > 1) return `${frames.length} series · ${rows} points`;
  return `${rows} ${rows === 1 ? 'row' : 'rows'}`;
}

/** The loose shape of a tool output. */
interface Output {
  /** Whether the tool succeeded. */
  readonly ok?: boolean;
  /** Why not. */
  readonly error?: string;
  /** Connectors listed. */
  readonly connectors?: readonly unknown[];
  /** Entities described. */
  readonly entities?: readonly { kind?: string }[];
  /** Values sampled. */
  readonly values?: readonly unknown[];
  /** Frames tested. */
  readonly frames?: readonly ShapeFrame[];
}

/**
 * Words for the entities a description found.
 *
 * @param output - The description.
 * @returns Such as `9 metrics` or `1 table`.
 */
function entityWords(output: Output): string {
  const count = output.entities?.length ?? 0;
  const kind = output.entities?.[0]?.kind ?? 'entity';
  return `${count} ${count === 1 ? kind : `${kind}s`}`;
}

/** Words for what each explore tool found. */
const resultWords: Readonly<Record<string, (output: Output) => string>> = {
  list_connectors: (output) => `${output.connectors?.length ?? 0} connectors`,
  describe: entityWords,
  sample_values: (output) => `${output.values?.length ?? 0} values`,
  test_query: (output) => shapeOf(output.frames),
};

/**
 * The result of a call, in words, and whether it failed.
 *
 * @param part - The tool part.
 * @returns The words and the failure flag.
 */
function outcomeOf(part: ToolPart): { result: string; failed: boolean } {
  if (part.state === 'output-error') return { result: part.errorText ?? 'failed', failed: true };
  if (part.state !== 'output-available') return { result: '…', failed: false };
  const output = (part.output ?? {}) as Output;
  if (output.ok === false) return { result: output.error ?? 'failed', failed: true };
  return { result: resultWords[toolName(part)]?.(output) ?? 'done', failed: false };
}

/**
 * How an explore call reads in the conversation.
 *
 * @param part - The tool part.
 * @returns The call and its result, and whether it failed.
 */
export function describeCall(part: ToolPart): { call: string; result: string; failed: boolean } {
  const name = toolName(part);
  const input = (part.input ?? {}) as { connector?: string; field?: string };
  const argument = name === 'sample_values' ? input.field : input.connector;
  return { call: `${name}(${argument ?? ''})`, ...outcomeOf(part) };
}

/**
 * The text a person should read: without the reasoning some models write between `<thought>`
 * tags, closed or still open, or in a paragraph opened by an unclosed `<thought` tag.
 *
 * @param text - The model's text.
 * @returns The text to show.
 */
export function readableText(text: string): string {
  return text
    .replace(/<thought>[\s\S]*?(<\/thought>|$)/g, '')
    .replace(/<thought\s[\s\S]*?(\n\s*\n|$)/g, '')
    .trim();
}
