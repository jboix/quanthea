/** How a failed tool call reads in the conversation: plain words, never an SDK's raw error. */

/** The longest error shown, in characters. */
const maxLength = 200;

/**
 * The words for a tool call's error. A call whose input failed its schema carries the SDK's
 * error with the whole input as JSON, which says nothing to a person; it reads as one sentence
 * instead. Any other error shows its first line, cut short.
 *
 * @param errorText - The call's error, as the AI SDK stored it.
 * @returns The words.
 */
export function toolErrorText(errorText: string | undefined): string {
  if (!errorText) return 'failed';
  if (/AI_InvalidToolInputError|Type validation failed/.test(errorText)) {
    return 'The agent sent an edit in the wrong shape, and tries again.';
  }
  const [line = ''] = errorText.split('\n');
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}
