import { expect, test } from 'bun:test';
import { alertSettingsSchema } from '@quanthea/shared';
import { quietHoursProblem, startingQuietHours, toggled } from './quiet-hours-form.ts';

test("starts with every night on the browser's clock, critical alerts left alone", () => {
  const quietHours = startingQuietHours();
  expect(quietHours.windows).toEqual([
    {
      days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      from: '22:00',
      to: '07:00',
    },
  ]);
  expect(quietHours.exceptSeverities).toEqual(['critical']);
  expect(quietHoursProblem(quietHours)).toBeUndefined();
  const settings = { maxActivePerConnector: 50, notifyOnError: true, quietHours };
  expect(alertSettingsSchema.parse(settings)).toEqual(settings);
});

test('says what keeps quiet hours from being saved', () => {
  const quietHours = startingQuietHours();
  expect(quietHoursProblem({ ...quietHours, timezone: 'Mars/Olympus' })).toBe(
    'Use an IANA time zone such as Europe/Zurich.',
  );
  const window = { days: [], from: '22:00', to: '07:00' };
  const incomplete = 'Give each window at least one day, a start and an end.';
  expect(quietHoursProblem({ ...quietHours, windows: [window] })).toBe(incomplete);
  const cleared = { ...window, days: ['monday' as const], to: '' };
  expect(quietHoursProblem({ ...quietHours, windows: [cleared] })).toBe(incomplete);
  expect(quietHoursProblem({ ...quietHours, exceptSeverities: [] })).toBeUndefined();
});

test('flips one choice of a list', () => {
  expect(toggled(['critical'], 'info')).toEqual(['critical', 'info']);
  expect(toggled(['critical', 'info'], 'critical')).toEqual(['info']);
});
