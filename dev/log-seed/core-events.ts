/**
 * The synthetic player events of the dev environment: one playback session every twenty seconds,
 * on three platforms, from eight hours before the incident until now. A session starts, sends a
 * heartbeat a minute, and stops or fails. Some media are blocked or unavailable, and technical
 * errors rise with the incident. The draws hash the session's position, so every seed writes the
 * same events for the same incident.
 */
import { incidentIntensity, incidentStart } from '../metrics/incident.ts';
import {
  blockReasons,
  type CoreMedia,
  coreMedia,
  type DeviceModel,
  type PlatformProfile,
  platformProfiles,
  technicalErrors,
} from './core-events-catalog.ts';
import { draw } from './events.ts';

/** What every event of a session says about it. */
export interface CoreSession {
  /** The player. `platform` is `Web`, `Apple` or `Android`. Mapping: keywords. */
  readonly player: { platform: PlatformProfile['platform']; name: string; version: string };
  /** The browser, or the web view of an application. Mapping: keywords. */
  readonly browser: { name: string; version: string };
  /** The operating system. Mapping: keywords. */
  readonly os: { name: string; version: string };
  /** The device. Mapping: keywords. */
  readonly device: { id: string; model: string; type: string };
  /** The application the player runs in. Mapping: keywords. */
  readonly application: { id: string; version: string };
  /** The media played, one of {@link coreMedia}. */
  readonly media: CoreMedia;
  /** How long the start took, in milliseconds: the whole, the metadata, the asset. Mapping: float. */
  readonly qoe_timings: { total: number; metadata: number; asset: number };
  /** The screen, in pixels. Mapping: integer. */
  readonly screen: { width: number; height: number };
}

/** What an event says about itself. Which fields it has depends on the event. */
export interface CoreEventData {
  /** On an error: whether the media was refused, not broken. Mapping: boolean. */
  readonly business_error?: boolean;
  /** On an error: its type. Mapping: keyword. */
  readonly error_type?: string;
  /** On an error: the message. Mapping: text, with a keyword. */
  readonly log?: string;
  /** On a blocked media: why. Mapping: keyword. */
  readonly block_reason?: string;
  /** Seconds played so far. Mapping: integer. */
  readonly playback_duration?: number;
  /** The bitrate played, in bits per second. Mapping: long. */
  readonly bitrate?: number;
  /** The bandwidth measured, in bits per second. Mapping: long. */
  readonly bandwidth?: number;
  /** The stalls so far: how many, and their total in milliseconds. Mapping: integer. */
  readonly stall?: { count: number; duration: number };
}

/** One player event. */
export interface CoreEvent {
  /** When it happened, in epoch milliseconds. Mapping: date, format `epoch_millis`. */
  readonly '@timestamp': number;
  /** Mapping: keyword. */
  readonly event_name: 'START' | 'HEARTBEAT' | 'STOP' | 'ERROR';
  /** The session. Mapping: keyword. */
  readonly session_id: string;
  /** The viewer's address. Mapping: ip. */
  readonly user_ip: string;
  /** The session, the same on each of its events. */
  readonly session: CoreSession;
  /** What the event measured. */
  readonly data: CoreEventData;
}

/** Milliseconds between two session starts. */
const spacingMilliseconds = 20_000;

/** How long before the incident the events start, in milliseconds. */
const leadMilliseconds = 8 * 60 * 60 * 1000;

/** How many devices the sessions come from. */
const deviceCount = 3000;

/** The bitrates a player picks from, in bits per second. */
const bitrates = [800_000, 1_800_000, 3_500_000, 6_000_000] as const;

/** The share of the sessions whose media is blocked. */
const blockedShare = 0.04;

/** The share of the sessions whose media is unavailable. */
const unavailableShare = 0.02;

/** The share of the sessions that fail technically, outside the incident and added at its top. */
const technicalShare = { baseline: 0.02, incident: 0.25 };

/**
 * One item of a list, by a roll: the first items are the most likely.
 *
 * @param items - The list, not empty.
 * @param roll - A number in [0, 1).
 * @returns The item.
 */
function pick<Item>(items: readonly Item[], roll: number): Item {
  return items[Math.floor(roll * roll * items.length)] as Item;
}

/**
 * Eight hexadecimal digits drawn from a seed.
 *
 * @param seed - The seed.
 * @returns The digits.
 */
function hex(seed: number): string {
  return Math.floor(draw(seed) * 2 ** 32)
    .toString(16)
    .padStart(8, '0');
}

/**
 * The platform of a roll, by the platforms' shares.
 *
 * @param roll - A number in [0, 1).
 * @returns The platform's profile.
 */
function profileOf(roll: number): PlatformProfile {
  let total = 0;
  for (const profile of platformProfiles) {
    total += profile.share;
    if (roll < total) return profile;
  }
  return platformProfiles[0] as PlatformProfile;
}

/**
 * How long a start took. Starts are slower during the incident, and the asset has a long tail.
 *
 * @param seed - The session's seed.
 * @param intensity - The incident intensity when the session started.
 * @returns The timings, in milliseconds.
 */
function timingsOf(seed: number, intensity: number): CoreSession['qoe_timings'] {
  const slowdown = 1 + 2 * intensity;
  const metadata = Math.round((80 + 400 * draw(seed) ** 2) * slowdown * 10) / 10;
  const asset = Math.round((150 + 2500 * draw(seed + 1) ** 3) * slowdown * 10) / 10;
  return { total: Math.round((metadata + asset + 25) * 10) / 10, metadata, asset };
}

/**
 * What a device says of itself in a session: the same device, the same answer.
 *
 * @param profile - The platform's profile.
 * @param device - The device's model.
 * @param seed - The device's seed.
 * @returns The player, browser, system, device, application and screen of the session.
 */
function deviceFields(profile: PlatformProfile, device: DeviceModel, seed: number) {
  const browser = pick(profile.browsers, draw(seed + 2));
  return {
    player: {
      platform: profile.platform,
      name: profile.player.name,
      version: pick(profile.player.versions, draw(seed + 3)),
    },
    browser: { name: browser.name, version: pick(browser.versions, draw(seed + 4)) },
    os: { name: device.os.name, version: pick(device.os.versions, draw(seed + 5)) },
    device: { id: `device-${hex(seed + 6)}`, model: device.model, type: device.type },
    application: {
      id: profile.application.name,
      version: pick(profile.application.versions, draw(seed + 7)),
    },
    screen: { width: device.width, height: device.height },
  };
}

/** What every event of a session repeats. */
type SessionFields = Pick<CoreEvent, 'session_id' | 'user_ip' | 'session'>;

/** A session before its events. */
interface Viewing {
  /** The platform's profile. */
  readonly profile: PlatformProfile;
  /** Who plays what, from which address. */
  readonly fields: SessionFields;
}

/**
 * The session at a position.
 *
 * @param seed - The session's seed.
 * @param intensity - The incident intensity when it started.
 * @returns The viewing.
 */
function viewingOf(seed: number, intensity: number): Viewing {
  const deviceNumber = Math.floor(draw(seed) * deviceCount);
  const deviceSeed = 0x40000000 + deviceNumber * 16;
  const profile = profileOf(draw(deviceSeed));
  const device = profile.devices[Math.floor(draw(deviceSeed + 1) * profile.devices.length)];
  const media = coreMedia[Math.floor(draw(seed + 1) ** 1.5 * coreMedia.length)];
  const session = {
    ...deviceFields(profile, device as DeviceModel, deviceSeed),
    media: media as CoreMedia,
    qoe_timings: timingsOf(seed + 4, intensity),
  };
  const user_ip = `198.18.${Math.floor(deviceNumber / 250)}.${(deviceNumber % 250) + 1}`;
  return { profile, fields: { session_id: hex(seed + 2) + hex(seed + 3), user_ip, session } };
}

/**
 * How a session fails, if it does: its media is blocked or unavailable, or the player breaks,
 * more often during the incident and most often on the web.
 *
 * @param seed - The session's seed.
 * @param viewing - The session.
 * @param intensity - The incident intensity when it started.
 * @returns The error's data, or `undefined` for a session that plays to its end.
 */
function failureOf(seed: number, viewing: Viewing, intensity: number): CoreEventData | undefined {
  const roll = draw(seed + 8);
  if (roll < blockedShare) {
    const reason = pick(blockReasons, draw(seed + 9));
    const log = `media ${viewing.fields.session.media.id} is blocked: ${reason}`;
    return { business_error: true, error_type: 'BlockReasonError', log, block_reason: reason };
  }
  const refused = blockedShare + unavailableShare;
  if (roll < refused) {
    const log = `media ${viewing.fields.session.media.id} is not available`;
    return { business_error: true, error_type: 'UnavailableMediaError', log };
  }
  const share = technicalShare.baseline + technicalShare.incident * intensity;
  if (roll >= refused + share * viewing.profile.exposure) return undefined;
  return { business_error: false, ...pick(technicalErrors, draw(seed + 9)) };
}

/**
 * The stalls a number of minutes into a session. Three sessions in ten stall at all.
 *
 * @param seed - The session's seed.
 * @param minutes - Minutes played.
 * @returns How many stalls so far, and their total in milliseconds.
 */
function stallOf(seed: number, minutes: number): { count: number; duration: number } {
  const stallsPerMinute = draw(seed + 11) < 0.3 ? draw(seed + 12) * 1.5 : 0;
  const count = Math.floor(minutes * stallsPerMinute);
  return { count, duration: Math.round(count * (200 + 1500 * draw(seed + 13))) };
}

/**
 * What a player measured a number of minutes into a session.
 *
 * @param seed - The session's seed.
 * @param minutes - Minutes played.
 * @returns The playback duration, the bitrate, the bandwidth and the stalls so far.
 */
function playbackOf(seed: number, minutes: number): CoreEventData {
  const bitrate = pick(bitrates, Math.sqrt(draw(seed + 30 + minutes)));
  return {
    playback_duration: minutes * 60,
    bitrate,
    bandwidth: Math.round(bitrate * (1.5 + 2.5 * draw(seed + 40 + minutes))),
    stall: stallOf(seed, minutes),
  };
}

/**
 * The events of a session: a start, a heartbeat a minute, and a stop or an error. A session
 * whose media is refused fails a second after its start.
 *
 * @param seed - The session's seed.
 * @param begin - When it starts, in epoch milliseconds.
 * @param fields - What each event repeats.
 * @param failure - How it fails, if it does.
 * @returns The events, in time order.
 */
function eventsOf(
  seed: number,
  begin: number,
  fields: SessionFields,
  failure: CoreEventData | undefined,
): CoreEvent[] {
  const minutes = failure?.business_error ? 0 : 1 + Math.floor(draw(seed + 15) * 5);
  const event = (
    seconds: number,
    event_name: CoreEvent['event_name'],
    data: CoreEventData,
  ): CoreEvent => ({ '@timestamp': begin + seconds * 1000, event_name, ...fields, data });
  const beats = Array.from({ length: minutes }, (_, beat) =>
    event((beat + 1) * 60, 'HEARTBEAT', playbackOf(seed, beat + 1)),
  );
  const stall = stallOf(seed, minutes);
  const last = failure
    ? event(minutes * 60 + 1, 'ERROR', { ...failure, playback_duration: minutes * 60 })
    : event(minutes * 60 + 30, 'STOP', { playback_duration: minutes * 60 + 30, stall });
  return [event(0, 'START', {}), ...beats, last];
}

/**
 * The events of the session at a position.
 *
 * @param index - The session's position.
 * @param time - When its slot starts, in epoch milliseconds.
 * @param start - When the incident started.
 * @returns The events, in time order.
 */
function sessionEvents(index: number, time: number, start: Date): CoreEvent[] {
  const seed = index * 64;
  const begin = time + Math.floor(draw(seed + 14) * spacingMilliseconds);
  const intensity = incidentIntensity(new Date(begin), start);
  const viewing = viewingOf(seed, intensity);
  return eventsOf(seed, begin, viewing.fields, failureOf(seed, viewing, intensity));
}

/**
 * Every player event from eight hours before the incident until now, in time order.
 *
 * @param now - The current time.
 * @returns The events.
 */
export function coreEvents(now: Date = new Date()): CoreEvent[] {
  const start = incidentStart(now);
  const first = start.getTime() - leadMilliseconds;
  const events: CoreEvent[] = [];
  for (let index = 0; first + index * spacingMilliseconds <= now.getTime(); index += 1) {
    const session = sessionEvents(index, first + index * spacingMilliseconds, start);
    events.push(...session.filter((event) => event['@timestamp'] <= now.getTime()));
  }
  return events.sort((a, b) => a['@timestamp'] - b['@timestamp']);
}
