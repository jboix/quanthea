/**
 * Checks the links of a spec's table columns and stats. Always: a value read from a column names
 * one the table shows, a stat reads no column, and a chosen variable is declared here. When the
 * spec is written: the target is a pinned dashboard that has every variable the link names. A
 * stored version is not checked against its targets, so it still pins after a target is unpinned.
 */
import {
  type DashboardLink,
  type DashboardSpec,
  isDashboardLink,
  type Link,
  type UrlLink,
  urlPlaceholder,
} from '@quanthea/shared';
import type { SpecIssue } from './issues.ts';

/** A pinned dashboard a link may open. */
export interface LinkTarget {
  /** Its id. */
  readonly id: string;
  /** Its title. */
  readonly title: string;
  /** The names of its variables. */
  readonly variables: readonly string[];
}

/** The most pinned dashboards a refusal names. */
const maxNamed = 20;

/** What a link holds, for one the schema refuses. */
const linkShape =
  'A link is { "dashboard": id, "variables"?, "keepTime"? } to open a pinned dashboard, or { "url": "https://…/{value}", "value"? } to open a page';

/**
 * The pinned dashboards a refusal names, by id and title.
 *
 * @param targets - The pinned dashboards.
 * @returns The phrase, such as `the pinned ones are 01H… (Checkout)`.
 */
function pinnedList(targets: readonly LinkTarget[]): string {
  const named = targets.slice(0, maxNamed).map((each) => `${each.id} (${each.title})`);
  return named.length === 0 ? 'none is pinned' : `the pinned ones are ${named.join(', ')}`;
}

/**
 * The schema's issues, with each refused link told what a link holds and, when the spec is
 * written, which dashboards it may open. The schema alone says only "Invalid input" for a link
 * of the wrong form, such as a path written as text.
 *
 * @param issues - The schema's issues.
 * @param targets - The pinned dashboards, when the spec is written.
 * @returns The issues.
 */
export function withLinkShape(
  issues: readonly SpecIssue[],
  targets?: readonly LinkTarget[] | undefined,
): SpecIssue[] {
  const pinned = targets ? `; ${pinnedList(targets)}` : '';
  return issues.map((issue) =>
    issue.path.endsWith('.link') ? { ...issue, message: `${linkShape}${pinned}.` } : issue,
  );
}

/** A link with where it sits and what it may read. */
interface PlacedLink {
  /** The link. */
  readonly link: Link;
  /** Its path, such as `panels[0].view.columns[1].link`. */
  readonly path: string;
  /**
   * The columns its row has: none for a stat of one number, `undefined` when every column of the
   * result may be read.
   */
  readonly columns: readonly string[] | undefined;
}

/**
 * The links of one panel's view, with where they sit.
 *
 * @param view - The view.
 * @param at - Its path, such as `panels[0].view`.
 * @returns The links.
 */
function viewLinks(view: DashboardSpec['panels'][number]['view'], at: string): PlacedLink[] {
  if (view.kind === 'stat') {
    // A stat over a breakdown has a row for each tile, whose columns the spec does not list.
    const columns = view.each === undefined ? [] : undefined;
    return view.link ? [{ link: view.link, path: `${at}.link`, columns }] : [];
  }
  if (view.kind !== 'table') return [];
  const shown = view.rest ? undefined : view.columns.map((column) => column.field);
  return view.columns.flatMap((column, place) => {
    const path = `${at}.columns[${place}].link`;
    return column.link ? [{ link: column.link, path, columns: shown }] : [];
  });
}

/**
 * Every link of a spec, with where it sits.
 *
 * @param spec - The spec.
 * @returns The links.
 */
function placedLinks(spec: DashboardSpec): PlacedLink[] {
  return spec.panels.flatMap(({ view }, index) => viewLinks(view, `panels[${index}].view`));
}

/**
 * The problem with a value read from the row, if any.
 *
 * @param column - The column it reads.
 * @param columns - The columns the row has; none for a stat; `undefined` for every column.
 * @returns The message, or `undefined`.
 */
function columnProblem(column: string, columns: readonly string[] | undefined): string | undefined {
  if (columns?.length === 0)
    return 'A stat has no row to read a column from: pass a variable or a fixed value.';
  if (!columns || columns.includes(column)) return undefined;
  return `The table shows no column "${column}".`;
}

/**
 * The problem with one value of a link, if any.
 *
 * @param value - Where the value comes from.
 * @param placed - The link.
 * @param declared - The variables this spec declares.
 * @returns The message, or `undefined`.
 */
function valueProblem(
  value: DashboardLink['variables'][string],
  placed: PlacedLink,
  declared: ReadonlySet<string>,
): string | undefined {
  if (typeof value === 'string') return undefined;
  if ('column' in value) return columnProblem(value.column, placed.columns);
  if (declared.has(value.variable)) return undefined;
  return `No variable $${value.variable} on this dashboard to pass on.`;
}

/**
 * The problems with what a link to a dashboard reads from the row and the choices.
 *
 * @param placed - Where the link sits.
 * @param link - The link.
 * @param declared - The variables this spec declares.
 * @returns The issues.
 */
function checkValues(
  placed: PlacedLink,
  link: DashboardLink,
  declared: ReadonlySet<string>,
): SpecIssue[] {
  return Object.entries(link.variables).flatMap(([name, value]) => {
    const message = valueProblem(value, placed, declared);
    return message ? [{ path: `${placed.path}.variables.${name}`, message }] : [];
  });
}

/**
 * The problems with a link's target.
 *
 * @param placed - Where the link sits.
 * @param link - The link.
 * @param targets - The pinned dashboards.
 * @returns The issues.
 */
function checkTarget(
  placed: PlacedLink,
  link: DashboardLink,
  targets: readonly LinkTarget[],
): SpecIssue[] {
  const path = `${placed.path}.dashboard`;
  const target = targets.find((each) => each.id === link.dashboard);
  if (!target)
    return [{ path, message: `No pinned dashboard ${link.dashboard}: ${pinnedList(targets)}.` }];
  const missing = Object.keys(link.variables).filter((name) => !target.variables.includes(name));
  if (missing.length === 0) return [];
  const has =
    target.variables.length === 0 ? 'none' : target.variables.map((name) => `$${name}`).join(', ');
  return [
    {
      path: `${placed.path}.variables`,
      message: `${target.title} has no variable ${missing.map((name) => `$${name}`).join(', ')}; it has ${has}.`,
    },
  ];
}

/**
 * Checks the links of a spec's table columns and stats.
 *
 * @param spec - A spec that passed the schema.
 * @param targets - The pinned dashboards, when the spec is written; targets are not checked
 *   without them.
 * @returns The issues.
 */
export function checkLinks(
  spec: DashboardSpec,
  targets?: readonly LinkTarget[] | undefined,
): SpecIssue[] {
  const declared = new Set(spec.variables.map((variable) => variable.name));
  return placedLinks(spec).flatMap((placed) => {
    const { link } = placed;
    if (!isDashboardLink(link)) return checkUrlValue(placed, link, declared);
    return [
      ...checkValues(placed, link, declared),
      ...(targets ? checkTarget(placed, link, targets) : []),
    ];
  });
}

/**
 * The problems with where a link to an address takes its value. A table's cell gives it by
 * default; a stat has no cell, so its `{value}` needs a variable.
 *
 * @param placed - Where the link sits.
 * @param link - The link.
 * @param declared - The variables this spec declares.
 * @returns The issues.
 */
function checkUrlValue(
  placed: PlacedLink,
  link: UrlLink,
  declared: ReadonlySet<string>,
): SpecIssue[] {
  const path = `${placed.path}.value`;
  if (link.value) {
    const message = valueProblem(link.value, placed, declared);
    return message ? [{ path, message }] : [];
  }
  if (placed.columns?.length !== 0 || !link.url.includes(urlPlaceholder)) return [];
  return [{ path, message: 'A stat has no cell for {value}: pass "value": { "variable" }.' }];
}
