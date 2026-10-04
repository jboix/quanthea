/** Groups dated items, such as past threads or conversations, by how many days ago they changed. */

/** Items that changed on the same stretch of days. */
export interface DayGroup<Item> {
  /** Such as "Today" or "Previous 7 days". */
  readonly label: string;
  /** The items, in the order given. */
  readonly items: readonly Item[];
}

/** The groups, by the most days since an item changed. */
const groupLimits: readonly [number, string][] = [
  [0, 'Today'],
  [1, 'Yesterday'],
  [7, 'Previous 7 days'],
  [30, 'Previous 30 days'],
  [Number.POSITIVE_INFINITY, 'Older'],
];

/**
 * The calendar day of an instant in a time zone, counted in days since the epoch.
 *
 * @param instant - Epoch milliseconds.
 * @param timeZone - An IANA time zone, or `undefined` for the browser's.
 * @returns The day's number.
 */
function dayNumber(instant: number, timeZone: string | undefined): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((each) => each.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000;
}

/**
 * Groups items by how long ago they changed.
 *
 * @param items - The items, the latest first.
 * @param changedAt - When an item last changed, in epoch milliseconds.
 * @param now - The current time.
 * @param timeZone - The time zone whose calendar days count; the browser's when left out.
 * @returns The groups that have items, the latest first.
 */
export function groupByDay<Item>(
  items: readonly Item[],
  changedAt: (item: Item) => number,
  now: Date,
  timeZone?: string,
): DayGroup<Item>[] {
  const groups = new Map<string, Item[]>();
  const today = dayNumber(now.getTime(), timeZone);
  for (const item of items) {
    const days = today - dayNumber(changedAt(item), timeZone);
    const label = groupLimits.find(([limit]) => days <= limit)?.[1] ?? 'Older';
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return [...groups].map(([label, members]) => ({ label, items: members }));
}
