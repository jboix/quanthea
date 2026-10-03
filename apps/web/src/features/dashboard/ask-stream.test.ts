import { describe, expect, test } from 'bun:test';
import { type AnswerStreamMessage, answerMessages, streamedAnswer } from './ask-stream.ts';

/**
 * A message with some parts.
 *
 * @param parts - The parts.
 * @returns The message.
 */
function message(parts: unknown[]): AnswerStreamMessage {
  return { id: 'm1', role: 'assistant', parts } as AnswerStreamMessage;
}

const read = {
  id: 'e1',
  connector: 'events',
  query: {},
  variables: {},
  time: { from: 'a', to: 'b' },
  result: {},
};

describe('a streamed answer', () => {
  test('shows the latest answer as it is written, and counts the reads', () => {
    const writing = message([
      {
        type: 'tool-give_answer',
        toolCallId: 'c1',
        state: 'input-streaming',
        input: { text: 'Old' },
      },
      { type: 'data-evidence', id: 'e1', data: read },
      {
        type: 'tool-give_answer',
        toolCallId: 'c2',
        state: 'input-streaming',
        input: { text: 'Err' },
      },
    ]);
    expect(streamedAnswer(writing)).toEqual({ text: 'Err', reads: 1, outcome: undefined });
  });

  test('ends on the outcome, or on a failure when the outcome does not read', () => {
    const answer = { mode: 'ask' as const, text: 'Fine [1].', citations: [{ n: 1 }], evidence: [] };
    const ended = message([{ type: 'data-outcome', data: { ok: true, answer } }]);
    expect(streamedAnswer(ended).outcome).toEqual({ ok: true, answer });
    const broken = message([{ type: 'data-outcome', data: { ok: 'maybe' } }]);
    expect(streamedAnswer(broken).outcome).toEqual({
      ok: false,
      message: 'The answer was unreadable.',
    });
  });

  test('reads a UI message stream into the message as it grows', async () => {
    const outcome = { ok: false as const, message: 'No model is set up.' };
    const lines = [
      { type: 'start' },
      { type: 'data-evidence', id: 'e1', data: read },
      { type: 'data-outcome', data: outcome },
      { type: 'finish' },
    ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`);
    const body = new Response(`${lines.join('')}data: [DONE]\n\n`).body;
    if (!body) throw new Error('No body.');
    let last: AnswerStreamMessage | undefined;
    for await (const each of answerMessages(body)) last = each;
    expect(last && streamedAnswer(last)).toEqual({ text: '', reads: 1, outcome });
  });
});
