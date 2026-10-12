import { expect, test } from 'bun:test';
import { type DefaultQuietHours, type QuietHours, weekdays } from '@quanthea/shared';
import { daysWords, quietHoursWords, quietSummary } from './quiet-hours.ts';

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const nights: QuietHours = {
  timezone: zone,
  windows: [
    { days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], from: '22:00', to: '07:00' },
    { days: ['sunday', 'saturday'], from: '00:00', to: '00:00' },
  ],
};
const defaults: DefaultQuietHours = { ...nights, exceptSeverities: ['critical'] };

/**
 * A time on the browser's clock in the week of Monday 12 October 2026.
 *
 * @param day - The day of October.
 * @param hour - The hour.
 * @returns Epoch milliseconds.
 */
const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();

test('names the days of a window', () => {
  expect(daysWords(['friday', 'monday', 'wednesday', 'tuesday', 'thursday'])).toBe('Mon to Fri');
  expect(daysWords(['saturday', 'sunday'])).toBe('Sat and Sun');
  expect(daysWords(['monday', 'wednesday', 'friday'])).toBe('Mon, Wed and Fri');
  expect(daysWords(['sunday'])).toBe('Sun');
  expect(daysWords(weekdays)).toBe('every day');
});

test('reads quiet hours as windows on the clock of their time zone', () => {
  expect(quietHoursWords({ ...nights, timezone: 'Europe/Zurich' })).toBe(
    'Mon to Fri 22:00 to 07:00; Sat and Sun all day (Europe/Zurich)',
  );
});

test('says when an alert with its own quiet hours may next notify, or goes quiet', () => {
  const spec = { severity: 'critical' as const, quietHours: nights };
  const night = quietSummary(spec, null, at(12, 23));
  expect(night.schedule).toBe(`Quiet ${quietHoursWords(nights)}.`);
  expect(night.status).toBe('Quiet now. It may next notify Tue 07:00.');
  expect(night).toMatchObject({ quiet: true, quietUntil: at(13, 7) });
  const day = quietSummary(spec, null, at(13, 9));
  expect(day).toMatchObject({ quiet: false, status: 'Next quiet from 22:00.', quietUntil: null });
  expect(quietSummary(spec, null, at(16, 23)).status).toBe(
    'Quiet now. It may next notify Mon 00:00.',
  );
});

test('says whose quiet hours hold: the default, or none', () => {
  const warning = { severity: 'warning' as const };
  expect(quietSummary(warning, defaults, at(13, 9)).schedule).toBe(
    `Quiet ${quietHoursWords(nights)}, the default for all alerts.`,
  );
  expect(quietSummary({ severity: 'critical' }, defaults, at(13, 9))).toEqual({
    schedule: 'No quiet hours: the default leaves critical alerts alone.',
    quiet: false,
    status: '',
    quietUntil: null,
  });
  expect(quietSummary({ ...warning, quietHours: 'none' }, defaults, 0).schedule).toBe(
    'No quiet hours: it notifies at any hour, whatever the default.',
  );
  expect(quietSummary(warning, null, 0).schedule).toBe('No quiet hours: it notifies at any hour.');
});

test('says so when the quiet hours leave no hour', () => {
  const always = { timezone: zone, windows: [{ days: [...weekdays], from: '09:00', to: '09:00' }] };
  expect(quietSummary({ severity: 'info', quietHours: always }, null, 0).status).toBe(
    'Quiet at every hour: it never notifies.',
  );
});
