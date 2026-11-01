/**
 * The links a dashboard's tables and stats draw: to a dashboard pinned now, with the row's values,
 * the choices made here and the time range, or to an address on a host an admin allowed. Any
 * other link draws as text.
 */
import {
  type DashboardSpec,
  type ExternalHosts,
  isDashboardLink,
  type Link,
  type LinkContext,
  linkAddress,
  linkHostAllowed,
  type UrlLink,
  urlLinkAddress,
  urlLinkHost,
  urlLinkValue,
  variableDefault,
} from '@quanthea/shared';
import { choicesFromSearch } from './view-state.ts';

/** Where a dashboard's links may go. */
export interface Linkable {
  /** The dashboards pinned now, among those the links open. */
  readonly targets: readonly string[];
  /** The hosts an admin allowed. */
  readonly hosts: ExternalHosts;
}

/** What a panel's links are built from. */
export interface PanelLinks {
  /** The dashboards pinned now, among those the links open. */
  readonly targets: ReadonlySet<string>;
  /** The hosts an admin allowed. */
  readonly hosts: ExternalHosts;
  /** The choices and the time range of this dashboard. */
  readonly context: LinkContext;
}

/** Where a cell or a stat leads. */
export interface Href {
  /** The address. */
  readonly href: string;
  /** Whether it is outside quanthea, and opens in a new tab. */
  readonly external: boolean;
}

/**
 * What the links of a dashboard's panels are built from: its choices, defaults filled in, and its
 * time range, as its address writes them.
 *
 * @param spec - The spec, for the variables' defaults and the default time range.
 * @param search - The dashboard's address search, such as `?var-env=prod&from=now-1h&to=now`.
 * @param linkable - The dashboards pinned now and the hosts allowed.
 * @returns What the panels' links are built from.
 */
export function panelLinksOf(spec: DashboardSpec, search: string, linkable: Linkable): PanelLinks {
  const choices = choicesFromSearch(new URLSearchParams(search), spec);
  const entries = spec.variables.flatMap((variable) => {
    const value = choices.variables[variable.name] ?? variableDefault(variable);
    return value === undefined ? [] : [[variable.name, value] as const];
  });
  const context = { chosen: Object.fromEntries(entries), time: choices.time ?? spec.time };
  return { targets: new Set(linkable.targets), hosts: linkable.hosts, context };
}

/**
 * The address a link to a page outside quanthea opens, when its host is allowed.
 *
 * @param link - The link.
 * @param links - What the panel's links are built from.
 * @param context - The row and the choices.
 * @param column - The column of the cell, for a table.
 * @returns Where it leads, or `undefined` to draw the value as text.
 */
function urlHref(
  link: UrlLink,
  links: PanelLinks,
  context: LinkContext,
  column: string | undefined,
): Href | undefined {
  if (!linkHostAllowed(links.hosts, urlLinkHost(link))) return undefined;
  const href = urlLinkAddress(link, urlLinkValue(link, context, column));
  return href === undefined ? undefined : { href, external: true };
}

/**
 * Where a link leads, when its target is pinned now or its host is allowed.
 *
 * @param link - The link of a column or a stat, if any.
 * @param links - What the panel's links are built from, if it draws links.
 * @param cell - For a table's cell: the row's values by column, and the cell's column.
 * @param cell.row - The row's values by column.
 * @param cell.column - The cell's column.
 * @returns Where it leads, or `undefined` to draw the value as text.
 */
export function hrefOf(
  link: Link | undefined,
  links: PanelLinks | undefined,
  cell?: { readonly row: Readonly<Record<string, unknown>>; readonly column: string },
): Href | undefined {
  if (!link || !links) return undefined;
  const context = cell ? { ...links.context, row: cell.row } : links.context;
  if (!isDashboardLink(link)) return urlHref(link, links, context, cell?.column);
  if (!links.targets.has(link.dashboard)) return undefined;
  return { href: linkAddress(link, context), external: false };
}
