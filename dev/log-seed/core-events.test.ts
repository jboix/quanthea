import { describe, expect, test } from 'bun:test';
import { incidentStart } from '../metrics/incident.ts';
import { type CoreEvent, coreEvents } from './core-events.ts';
import { coreMedia } from './core-events-catalog.ts';

const now = new Date('2026-09-28T09:30:00Z');
const events = coreEvents(now);

/**
 * Every dotted path of a value's leaves.
 *
 * @param value - The value.
 * @param prefix - The path of the enclosing object.
 * @returns The paths.
 */
function paths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix.slice(0, -1)];
  return Object.entries(value).flatMap(([name, inner]) => paths(inner, `${prefix}${name}.`));
}

/**
 * The share of the sessions starting in a window that end in a technical error.
 *
 * @param from - Minutes after the deploy, inclusive.
 * @param to - Minutes after the deploy, exclusive.
 * @returns The share, 0 to 1.
 */
function technicalFailures(from: number, to: number): number {
  const start = incidentStart(now).getTime();
  const within = (event: CoreEvent) =>
    event['@timestamp'] >= start + from * 60_000 && event['@timestamp'] < start + to * 60_000;
  const started = events.filter((event) => event.event_name === 'START' && within(event));
  const failed = events.filter((event) => event.data.business_error === false && within(event));
  return failed.length / started.length;
}

describe('coreEvents', () => {
  test('writes the same events for the same moment, in time order and none after it', () => {
    expect(coreEvents(now)).toEqual(events);
    const times = events.map((event) => event['@timestamp']);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times.at(-1)).toBeLessThanOrEqual(now.getTime());
    expect(times[0]).toBeGreaterThanOrEqual(incidentStart(now).getTime() - 8 * 3_600_000);
    expect(events.length).toBeGreaterThan(20_000);
  });

  test('holds every event type on every platform', () => {
    const seen = new Set(
      events.map((event) => `${event.session.player.platform} ${event.event_name}`),
    );
    const expected = ['Web', 'Apple', 'Android'].flatMap((platform) =>
      ['START', 'HEARTBEAT', 'STOP', 'ERROR'].map((name) => `${platform} ${name}`),
    );
    expect([...seen].sort()).toEqual(expected.sort());
  });

  test('holds every field of the index', () => {
    const seen = new Set(events.flatMap((event) => paths(event)));
    expect([...seen].sort()).toEqual(
      [
        '@timestamp',
        'event_name',
        'session_id',
        'user_ip',
        'session.player.platform',
        'session.player.name',
        'session.player.version',
        'session.browser.name',
        'session.browser.version',
        'session.os.name',
        'session.os.version',
        'session.device.id',
        'session.device.model',
        'session.device.type',
        'session.application.id',
        'session.application.version',
        'session.media.id',
        'session.media.bu',
        'session.media.type',
        'session.media.swisstxt',
        'session.media.origin',
        'session.media.short_origin',
        'session.qoe_timings.total',
        'session.qoe_timings.metadata',
        'session.qoe_timings.asset',
        'session.screen.width',
        'session.screen.height',
        'data.business_error',
        'data.error_type',
        'data.log',
        'data.block_reason',
        'data.playback_duration',
        'data.bitrate',
        'data.bandwidth',
        'data.stall.count',
        'data.stall.duration',
      ].sort(),
    );
  });

  test('plays media of the one list, each of them', () => {
    expect(new Set(coreMedia.map((media) => media.id)).size).toBe(coreMedia.length);
    const played = new Set(events.map((event) => event.session.media));
    expect(played).toEqual(new Set(coreMedia));
  });

  test('keeps one session on one device, with whole millisecond times and an address', () => {
    const starts = events.filter((event) => event.event_name === 'START').slice(0, 200);
    for (const start of starts) {
      const own = events.filter((event) => event.session_id === start.session_id);
      expect(new Set(own.map((event) => JSON.stringify(event.session))).size).toBe(1);
      expect(own[0]).toBe(start);
    }
    expect(events.every((event) => Number.isInteger(event['@timestamp']))).toBe(true);
    expect(events.every((event) => /^198\.18\.\d+\.\d+$/.test(event.user_ip))).toBe(true);
  });

  test('refuses blocked and unavailable media as business errors, with the reason', () => {
    const errors = events.filter((event) => event.event_name === 'ERROR');
    const types = new Set(errors.map((event) => event.data.error_type));
    expect(types).toContain('BlockReasonError');
    expect(types).toContain('UnavailableMediaError');
    const blocked = errors.filter((event) => event.data.block_reason !== undefined);
    expect(new Set(blocked.map((event) => event.data.block_reason)).size).toBe(4);
    expect(blocked.every((event) => event.data.business_error === true)).toBe(true);
    expect(errors.some((event) => event.data.business_error === false)).toBe(true);
  });

  test('fails more often at the top of the incident than before it', () => {
    expect(technicalFailures(8, 24)).toBeGreaterThan(4 * technicalFailures(-240, 0));
  });
});
