import { describe, expect, test } from 'bun:test';
import { canMute, customMuteEnd, latestMuteEnd, muteOptions } from './mute-options.ts';

const hour = 3_600_000;
const now = new Date(2026, 9, 4, 15, 30).getTime();
const tomorrowAtNine = new Date(2026, 9, 5, 9, 0).getTime();

describe('the Mute menu', () => {
  test('analysts and above mute; viewers do not', () => {
    expect(canMute('viewer')).toBe(false);
    expect(canMute('analyst')).toBe(true);
    expect(canMute('admin')).toBe(true);
  });

  test('analysts get ends within the day; editors also until they unmute', () => {
    const ends = (role: 'analyst' | 'editor') =>
      muteOptions(role, now).map((option) => [option.label, option.until]);
    expect(ends('analyst')).toEqual([
      ['For 1 hour', now + hour],
      ['For 4 hours', now + 4 * hour],
      ['Until tomorrow 09:00', tomorrowAtNine],
    ]);
    expect(ends('editor').at(-1)).toEqual(['Until I unmute', null]);
  });

  test('a custom end is in the future, and at most seven days ahead below editor', () => {
    expect(latestMuteEnd('analyst', now)).toBe(now + 7 * 24 * hour);
    expect(latestMuteEnd('editor', now)).toBeNull();
    expect(customMuteEnd('2026-10-05T18:00', 'analyst', now)).toEqual({
      until: new Date(2026, 9, 5, 18, 0).getTime(),
    });
    expect(customMuteEnd('', 'analyst', now)).toEqual({ error: 'Choose a day and a time.' });
    expect(customMuteEnd('2026-10-04T09:00', 'analyst', now)).toEqual({
      error: 'Choose a time in the future.',
    });
    expect(customMuteEnd('2026-10-20T09:00', 'analyst', now)).toEqual({
      error: 'Mute for at most 7 days.',
    });
    expect(customMuteEnd('2026-10-20T09:00', 'editor', now)).toHaveProperty('until');
  });
});
