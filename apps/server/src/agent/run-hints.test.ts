import { describe, expect, test } from 'bun:test';
import { hintsOf } from './run.ts';

const asked = { role: 'user', metadata: { mentions: [], timeZone: 'Europe/Zurich' } };
const answered = { role: 'assistant', metadata: {} };

describe('hintsOf', () => {
  test("keeps the person's last time zone when a turn continues without a message", () => {
    const approval = { role: 'assistant', parts: [] };
    expect(hintsOf(approval, [asked, answered, approval])).toEqual({
      mentions: [],
      timeZone: 'Europe/Zurich',
    });
  });

  test("takes a new message's own time zone, and none when no message ever sent one", () => {
    const later = { role: 'user', metadata: { mentions: [], timeZone: 'America/New_York' } };
    expect(hintsOf(later, [asked, later]).timeZone).toBe('America/New_York');
    expect(hintsOf(answered, [answered]).timeZone).toBeUndefined();
  });
});
