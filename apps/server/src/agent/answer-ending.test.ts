import { describe, expect, test } from 'bun:test';
import { stalledStep, stallMessage } from './answer-ending.ts';

/**
 * A step as the run reads it.
 *
 * @param finishReason - The unified finish reason.
 * @param rawFinishReason - The provider's own.
 * @param calls - How many tools it called.
 * @returns The step.
 */
function step(
  finishReason: 'stop' | 'length' | 'error' | 'other',
  rawFinishReason?: string,
  calls = 0,
) {
  return { finishReason, rawFinishReason, toolCalls: Array.from({ length: calls }, () => ({})) };
}

describe('how a run ended without a tool call', () => {
  test('a step that called a tool is no stall, nor is a run with no step', () => {
    expect(stalledStep(step('other', 'tool_calls', 1))).toBeUndefined();
    expect(stalledStep(undefined)).toBeUndefined();
  });

  test('reads the reason from the response that broke the required call', () => {
    expect(stalledStep(step('error', 'MAX_TOKENS'), 'length')).toEqual({
      stall: 'cut',
      finishReason: 'MAX_TOKENS',
    });
    expect(stalledStep(step('error', 'refusal'), 'content-filter')?.stall).toBe('withheld');
    expect(stalledStep(step('error'), 'stop')).toEqual({ stall: 'silent' });
  });

  test('knows a call the provider could not read by its own reason', () => {
    expect(stalledStep(step('error', 'MALFORMED_FUNCTION_CALL'), 'other')?.stall).toBe('malformed');
    expect(stalledStep(step('other', 'tool_use_failed'))?.stall).toBe('malformed');
  });

  const asked = { askedAgain: true };

  test('each ending has its own words, without the reason the provider gave', () => {
    expect(stallMessage({ stall: 'cut', finishReason: 'MAX_TOKENS' }, asked)).toBe(
      "The model's output was cut at its limit before it gave an answer, even when asked once more to answer from what it had read. Try asking more narrowly.",
    );
    expect(stallMessage({ stall: 'silent' }, asked)).toBe(
      'The model stopped without giving an answer, even when asked once more to answer from what it had read. Try again.',
    );
    expect(stallMessage({ stall: 'malformed' }, asked)).toContain('could not be read');
    expect(stallMessage({ stall: 'withheld' }, asked)).toContain('withheld the response');
  });

  test('says it asked once more only when it did', () => {
    expect(stallMessage({ stall: 'silent' }, { askedAgain: false })).toBe(
      'The model stopped without giving an answer. Try again.',
    );
  });

  test('names the limit that left the step only the answer to give', () => {
    expect(stallMessage({ stall: 'silent' }, { askedAgain: false, limit: 'tokens' })).toBe(
      'The token budget of one answer was used up, so the model could only give its answer. The model stopped without giving an answer. Try asking more narrowly.',
    );
    expect(stallMessage({ stall: 'malformed' }, { ...asked, limit: 'calls' })).toStartWith(
      'The tool calls of one answer were used up, so the model could only give its answer. The model wrote',
    );
  });
});
