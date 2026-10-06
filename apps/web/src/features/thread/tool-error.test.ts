import { describe, expect, test } from 'bun:test';
import { toolErrorText } from './tool-error.ts';

describe('tool error text', () => {
  test('reads an input that failed its schema as one sentence, without the JSON', () => {
    const raw =
      'AI_InvalidToolInputError: Invalid input for tool edit_dashboard: AI_TypeValidationError: Type validation failed: Value: {"panels":[]}';
    expect(toolErrorText(raw)).toBe('The agent sent an edit in the wrong shape, and tries again.');
  });

  test('shows any other error as its first line, cut short', () => {
    expect(toolErrorText('Unknown column.\nat line 3')).toBe('Unknown column.');
    expect(toolErrorText('x'.repeat(300))).toHaveLength(200);
    expect(toolErrorText(undefined)).toBe('failed');
  });
});
