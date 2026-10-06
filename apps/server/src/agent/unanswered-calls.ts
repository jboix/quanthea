/**
 * Closes the tool calls a run never answered. A provider's stream can end in the middle of a
 * step, after the model called a tool and before the tool returned; the stored answer then holds a
 * call with no result, and the AI SDK refuses to convert that conversation again, so the thread
 * could never run another turn. Such a call becomes a failed call, which the model reads as one.
 */

/** A part of a message, as stored. */
type Part = Record<string, unknown>;

/** What the model reads for a call the run stopped before. */
export const unansweredCallError = 'The run stopped before this call returned. Call it again.';

/** The states of a tool part that has no result yet. */
const unanswered = new Set(['input-streaming', 'input-available']);

/**
 * A tool part with no result, as a failed call; any other part as it is.
 *
 * @param part - The part.
 * @returns The part, the same object when it has its result or is no tool call.
 */
function answeredPart(part: Part): Part {
  const isTool = typeof part.type === 'string' && part.type.startsWith('tool-');
  if (!isTool || !unanswered.has(String(part.state))) return part;
  return {
    ...part,
    state: 'output-error',
    input: part.input ?? {},
    errorText: unansweredCallError,
  };
}

/**
 * Messages with every unanswered tool call closed as a failed call.
 *
 * @param messages - The messages, as stored or as streamed.
 * @returns The messages, each the same object when it had no unanswered call.
 */
export function withAnsweredCalls<Message>(messages: readonly Message[]): Message[] {
  return messages.map((message) => {
    const parts = (message as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) return message;
    const answered = (parts as Part[]).map(answeredPart);
    return answered.some((part, index) => part !== parts[index])
      ? { ...message, parts: answered }
      : message;
  });
}
