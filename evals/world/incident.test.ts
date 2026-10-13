import { describe, expect, test } from 'bun:test';
import { incidentHour, zurich } from './incident.ts';

describe('incidentHour', () => {
  test('names the hour of yesterday noon UTC on the clock of the time zone', () => {
    expect(incidentHour(zurich, new Date('2026-10-03T10:00:00Z'))).toBe('14:00');
    expect(incidentHour(zurich, new Date('2026-11-03T10:00:00Z'))).toBe('13:00');
    expect(incidentHour('UTC', new Date('2026-11-03T10:00:00Z'))).toBe('12:00');
  });
});
