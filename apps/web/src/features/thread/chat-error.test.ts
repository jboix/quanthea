import { describe, expect, test } from 'bun:test';
import { chatErrorText } from './chat-error.ts';

describe('chat error text', () => {
  test('reads quanthea’s message out of the error body', () => {
    const body =
      '{"error":{"code":"bad_request","message":"Save an API key in Settings → Model first."}}';
    expect(chatErrorText(new Error(body))).toBe('Save an API key in Settings → Model first.');
  });

  test('keeps any other error as it is', () => {
    expect(chatErrorText(new Error('Failed to fetch'))).toBe('Failed to fetch');
    expect(chatErrorText(new Error('{"unexpected":true}'))).toBe('{"unexpected":true}');
    expect(chatErrorText(undefined)).toBeUndefined();
  });
});
