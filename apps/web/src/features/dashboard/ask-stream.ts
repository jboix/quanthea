/**
 * Reads an answer as it streams: the AI SDK UI message stream the ask endpoint answers with. The
 * answer's text arrives as the model writes `give_answer`'s input, each read as a `data-evidence`
 * part, and the checked answer, or why there is none, as the last part, `data-outcome`.
 */
import { type AnswerData, answerDataSchemas } from '@quanthea/shared';
import {
  parseJsonEventStream,
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
  uiMessageChunkSchema,
} from 'ai';

/** An answer's message as it streams. */
export type AnswerStreamMessage = UIMessage<unknown, AnswerData>;

/** What has arrived of an answer so far. */
export interface StreamedAnswer {
  /** The answer's text as written so far, markers included. */
  readonly text: string;
  /** How many reads the model made. */
  readonly reads: number;
  /** The end, once it came. */
  readonly outcome: AnswerData['outcome'] | undefined;
}

/**
 * The text of a `give_answer` call as written so far.
 *
 * @param part - A part of the message.
 * @returns The text, or `undefined` for any other part.
 */
function answerTextOf(part: AnswerStreamMessage['parts'][number]): string | undefined {
  const named =
    part.type === 'tool-give_answer' ||
    (part.type === 'dynamic-tool' && part.toolName === 'give_answer');
  if (!named || !('input' in part)) return undefined;
  const input = part.input as { text?: unknown } | undefined;
  return typeof input?.text === 'string' ? input.text : undefined;
}

/**
 * The outcome a `data-outcome` part carries.
 *
 * @param data - The part's data.
 * @returns The outcome, or a failure when it does not read as one.
 */
function outcomeOf(data: unknown): AnswerData['outcome'] {
  const parsed = answerDataSchemas.outcome.safeParse(data);
  return parsed.success ? parsed.data : { ok: false, message: 'The answer was unreadable.' };
}

/**
 * What has arrived of an answer: the latest answer's text, the reads, and the outcome.
 *
 * @param message - The message so far.
 * @returns The answer so far.
 */
export function streamedAnswer(message: AnswerStreamMessage): StreamedAnswer {
  let text = '';
  let reads = 0;
  let outcome: AnswerData['outcome'] | undefined;
  for (const part of message.parts) {
    text = answerTextOf(part) ?? text;
    if (part.type === 'data-evidence') reads += 1;
    if (part.type === 'data-outcome') outcome = outcomeOf(part.data);
  }
  return { text, reads, outcome };
}

/**
 * Reads the messages of a UI message stream, each one the message so far.
 *
 * @param body - The response body.
 * @returns The messages, as they grow.
 */
export function answerMessages(body: ReadableStream<Uint8Array>) {
  const chunks = parseJsonEventStream({ stream: body, schema: uiMessageChunkSchema }).pipeThrough(
    new TransformStream<{ success: boolean; value?: UIMessageChunk }, UIMessageChunk>({
      transform(part, controller) {
        if (part.success && part.value) controller.enqueue(part.value);
      },
    }),
  );
  return readUIMessageStream<AnswerStreamMessage>({ stream: chunks });
}
