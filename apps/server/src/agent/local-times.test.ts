import { describe, expect, test } from 'bun:test';
import { withLocalTimes } from './local-times.ts';

describe('withLocalTimes', () => {
  test('writes UTC instants on the clock of the time zone, in summer and in winter', () => {
    const read = { maxAt: '2026-10-03T12:05:00.000Z', spikes: [{ from: '2026-11-03T12:04:00Z' }] };
    expect(withLocalTimes(read, 'Europe/Zurich')).toEqual({
      maxAt: '2026-10-03 14:05 Europe/Zurich',
      spikes: [{ from: '2026-11-03 13:04 Europe/Zurich' }],
    });
  });

  test('keeps everything that is not a UTC instant, and an unknown zone changes nothing', () => {
    const read = { service: 'checkout-svc', max: 0.084, day: '2026-10-03', ok: true, none: null };
    expect(withLocalTimes(read, 'Europe/Zurich')).toEqual(read);
    const instant = { at: '2026-10-03T12:05:00Z' };
    expect(withLocalTimes(instant, 'Not/AZone')).toEqual(instant);
  });
});
