/**
 * Moves the input of a failed tool call from `rawInput` to `input`. The AI SDK still writes
 * `rawInput` when a model sends a tool input that fails its schema, then warns that the field is
 * deprecated each time the conversation is validated or converted; its next major version drops
 * it. Stored messages carry `input` instead, so the warning comes once, when the call fails.
 */

/** A part of a message, as stored. */
type Part = Record<string, unknown>;

/**
 * A part with `rawInput` moved to `input`, when it is a failed tool call that has one.
 *
 * @param part - The part.
 * @returns The part, the same object when nothing moved.
 */
function movedPart(part: Part): Part {
  if (part.state !== 'output-error' || !('rawInput' in part)) return part;
  const { rawInput, ...rest } = part;
  return { ...rest, input: rest.input ?? rawInput };
}

/**
 * Messages with the input of each failed tool call in `input`, as the AI SDK now expects.
 *
 * @param messages - The messages, as stored or as streamed.
 * @returns The messages, each the same object when nothing in it moved.
 */
export function withoutRawInput<Message>(messages: readonly Message[]): Message[] {
  return messages.map((message) => {
    const parts = (message as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) return message;
    const moved = (parts as Part[]).map(movedPart);
    return moved.some((part, index) => part !== parts[index])
      ? { ...message, parts: moved }
      : message;
  });
}
