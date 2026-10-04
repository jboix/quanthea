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
 * The calendar days between two instants, in the browser's time zone.
 *
 * @param earlier - The earlier instant, in milliseconds.
 * @param now - The later instant.
 * @returns Whole days; 0 on the same day.
 */
function daysBetween(earlier: number, now: Date): number {
  const start = (instant: Date) =>
    new Date(instant.getFullYear(), instant.getMonth(), instant.getDate()).getTime();
  return Math.round((start(now) - start(new Date(earlier))) / 86_400_000);
}

/**
 * Groups items by how long ago they changed.
 *
 * @param items - The items, the latest first.
 * @param changedAt - When an item last changed, in epoch milliseconds.
 * @param now - The current time.
 * @returns The groups that have items, the latest first.
 */
export function groupByDay<Item>(
  items: readonly Item[],
  changedAt: (item: Item) => number,
  now: Date,
): DayGroup<Item>[] {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const days = daysBetween(changedAt(item), now);
    const label = groupLimits.find(([limit]) => days <= limit)?.[1] ?? 'Older';
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return [...groups].map(([label, members]) => ({ label, items: members }));
}
