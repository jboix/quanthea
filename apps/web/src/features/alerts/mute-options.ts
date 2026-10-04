/**
 * The ends a person may mute an alert until: analysts up to seven days ahead, editors also until
 * someone unmutes. The server checks the same limits.
 */
import { hasRole, type Role } from '@quanthea/shared';

/** An hour and the longest an analyst mutes, in milliseconds. */
const hour = 3_600_000;
const longestAnalystMute = 7 * 24 * hour;

/** One way to mute. */
export interface MuteOption {
  /** A stable id. */
  readonly id: string;
  /** What the menu says. */
  readonly label: string;
  /** The end, or `null` until someone unmutes. */
  readonly until: number | null;
}

/**
 * Nine o'clock tomorrow, in the browser's time zone.
 *
 * @param now - The current time.
 * @returns The time.
 */
function tomorrowAtNine(now: number): number {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}

/**
 * Whether the role may mute the alert at all: analysts and above.
 *
 * @param role - The role.
 * @returns `true` for analysts, editors and admins.
 */
export function canMute(role: Role): boolean {
  return hasRole(role, 'analyst');
}

/**
 * The ready-made ends of the Mute menu for a role.
 *
 * @param role - The role.
 * @param now - The current time.
 * @returns For 1 hour, for 4 hours, until tomorrow 09:00, and until unmuted for editors.
 */
export function muteOptions(role: Role, now: number): MuteOption[] {
  const options: MuteOption[] = [
    { id: '1h', label: 'For 1 hour', until: now + hour },
    { id: '4h', label: 'For 4 hours', until: now + 4 * hour },
    { id: 'tomorrow', label: 'Until tomorrow 09:00', until: tomorrowAtNine(now) },
  ];
  if (hasRole(role, 'editor')) options.push({ id: 'unmute', label: 'Until I unmute', until: null });
  return options;
}

/**
 * The latest end a role may choose.
 *
 * @param role - The role.
 * @param now - The current time.
 * @returns Seven days ahead for analysts; `null`, no limit, for editors.
 */
export function latestMuteEnd(role: Role, now: number): number | null {
  return hasRole(role, 'editor') ? null : now + longestAnalystMute;
}

/**
 * Reads a custom end typed in a date and time field.
 *
 * @param value - The field's value, such as `2026-10-05T18:00`, in the browser's time zone.
 * @param role - The role.
 * @param now - The current time.
 * @returns The end, or why it can't be used.
 */
export function customMuteEnd(
  value: string,
  role: Role,
  now: number,
): { readonly until: number } | { readonly error: string } {
  const until = new Date(value).getTime();
  if (value === '' || Number.isNaN(until)) return { error: 'Choose a day and a time.' };
  if (until <= now) return { error: 'Choose a time in the future.' };
  const latest = latestMuteEnd(role, now);
  if (latest !== null && until > latest) return { error: 'Mute for at most 7 days.' };
  return { until };
}
