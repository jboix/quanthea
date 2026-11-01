/**
 * Links from a table column or a stat: to a pinned dashboard, or to an address outside quanthea.
 * A pinned dashboard's variables come from the row, from the variables chosen here, or are fixed,
 * and the time range goes along unless the link says not to. Charts never link: a link is a plain
 * address the viewer opens.
 */
import { z } from 'zod';
import { variableNameSchema } from './names.ts';
import { type UrlLink, urlLinkSchema } from './url-links.ts';

/** Validates a dashboard id as a link names it. */
const dashboardIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'A dashboard id: letters, digits, _ and -.');

/**
 * Validates where a target variable's value comes from: a column of the row, a variable chosen
 * on this dashboard, or a fixed text.
 */
const linkValueSchema = z.union([
  z.string().max(200),
  z.strictObject({ column: z.string().min(1).max(200) }),
  z.strictObject({ variable: variableNameSchema }),
]);

/** Where a target variable's value comes from. */
export type LinkValue = z.infer<typeof linkValueSchema>;

/** Validates a link to a pinned dashboard. */
const dashboardLinkSchema = z.strictObject({
  dashboard: dashboardIdSchema,
  /** The target's variables, by name. */
  variables: z.record(variableNameSchema, linkValueSchema).default({}),
  /** Whether the target opens on this dashboard's time range; on its own default when `false`. */
  keepTime: z.boolean().default(true),
});

/** A link to a pinned dashboard. */
export type DashboardLink = z.infer<typeof dashboardLinkSchema>;

/** Validates a link of a table column or a stat: to a pinned dashboard, or to an address. */
export const linkSchema = z.union([dashboardLinkSchema, urlLinkSchema]);

/** A link of a table column or a stat. */
export type Link = z.infer<typeof linkSchema>;

/**
 * Whether a link opens a pinned dashboard.
 *
 * @param link - The link.
 * @returns Whether it names a dashboard, and not an address.
 */
export function isDashboardLink(link: Link): link is DashboardLink {
  return 'dashboard' in link;
}

/** What a link's address is built from. */
export interface LinkContext {
  /** The row's values, by column; none for a stat. */
  readonly row?: Readonly<Record<string, unknown>>;
  /** The variables chosen on this dashboard, by name. */
  readonly chosen: Readonly<Record<string, string | readonly string[]>>;
  /** This dashboard's time range, as written in its address, such as `now-6h`. */
  readonly time?: { readonly from: string; readonly to: string } | undefined;
}

/**
 * The values one link variable takes.
 *
 * @param value - Where its value comes from.
 * @param context - The row and the choices.
 * @returns The values; none when the row or the choices have none.
 */
function valuesOf(value: LinkValue, context: LinkContext): string[] {
  if (typeof value === 'string') return [value];
  if ('variable' in value) return [context.chosen[value.variable] ?? []].flat();
  const cell = context.row?.[value.column];
  return cell === null || cell === undefined ? [] : [String(cell)];
}

/**
 * The address a link opens: the target dashboard, its variables and the time range, as the
 * dashboard reads them from its own address.
 *
 * @param link - The link.
 * @param context - The row, the choices and the time range.
 * @returns A path such as `/d/abc?var-browser=Firefox&from=now-6h&to=now`.
 */
export function linkAddress(link: DashboardLink, context: LinkContext): string {
  const pairs = Object.entries(link.variables).flatMap(([name, value]) =>
    valuesOf(value, context).map((each) => [`var-${name}`, each] as const),
  );
  const time = link.keepTime && context.time ? context.time : undefined;
  const all = time ? [...pairs, ['from', time.from] as const, ['to', time.to] as const] : pairs;
  const query = all.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  return `/d/${encodeURIComponent(link.dashboard)}${query === '' ? '' : `?${query}`}`;
}

/**
 * The value an address link fills in: its own source, or the cell's column.
 *
 * @param link - The link.
 * @param context - The row and the choices.
 * @param column - The column of the cell, for a table.
 * @returns The value, or `undefined` when there is none or there are several.
 */
export function urlLinkValue(
  link: UrlLink,
  context: LinkContext,
  column?: string,
): string | undefined {
  const source = link.value ?? (column === undefined ? undefined : { column });
  const values = source ? valuesOf(source, context) : [];
  return values.length === 1 ? values[0] : undefined;
}

/**
 * The dashboards a set of views links to.
 *
 * @param links - The links of a dashboard's columns and stats.
 * @returns Their ids, each once.
 */
export function linkedDashboards(links: readonly Link[]): string[] {
  return [...new Set(links.filter(isDashboardLink).map((link) => link.dashboard))];
}
