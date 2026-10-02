/**
 * A plan for an existing draft as changes to it: which panels it changes and how, which it adds,
 * which it removes, and how many it keeps. The plan card lists them; the draft pane marks them.
 */
import type { DashboardSpec, Plan } from '@quanthea/shared';

/** A draft panel, as the plan's changes need it. */
export interface DraftPanel {
  /** Its id. */
  readonly id: string;
  /** Its title. */
  readonly title: string;
  /** Its first query, written out, for the diff with the plan's query. */
  readonly query?: string;
}

/** One row of a plan's changes. */
export type ChangeRow =
  | {
      readonly tag: 'changed';
      readonly title: string;
      readonly note?: string;
      readonly before?: string;
      readonly after?: string;
    }
  | { readonly tag: 'new'; readonly title: string; readonly kind: string; readonly query?: string }
  | { readonly tag: 'removed'; readonly title: string }
  | { readonly tag: 'same'; readonly count: number };

/** How the draft pane marks a panel of the draft while a plan waits. */
export interface PanelMark {
  /** What the plan does to it. */
  readonly tag: 'changed' | 'removed' | 'same';
  /** What changes, for a changed panel. */
  readonly note?: string;
}

/**
 * A query written out: its SQL, its expression, or its JSON for the other languages.
 *
 * @param query - The panel's query.
 * @returns The text.
 */
function queryText(query: DashboardSpec['panels'][number]['queries'][number]): string {
  if ('sql' in query) return query.sql;
  if ('expr' in query) return query.expr;
  const { refId: _refId, connector: _connector, language: _language, ...rest } = query;
  return JSON.stringify(rest, null, 2);
}

/**
 * The draft's panels, as the plan's changes need them.
 *
 * @param spec - The draft.
 * @returns Its panels.
 */
export function draftPanelsOf(spec: DashboardSpec): DraftPanel[] {
  return spec.panels.map((panel) => {
    const [first] = panel.queries;
    return { id: panel.id, title: panel.title, ...(first ? { query: queryText(first) } : {}) };
  });
}

/**
 * Whether a plan reads as changes: it changes or removes panels, or there is a draft to change.
 *
 * @param plan - The plan.
 * @param draft - The draft's panels, when the plan waits on one.
 * @returns Whether to show it as changes.
 */
export function isChangePlan(plan: Plan, draft: readonly DraftPanel[] | undefined): boolean {
  const changes = plan.panels.some((panel) => panel.replaces !== undefined);
  return changes || !!plan.removes?.length || !!plan.changes?.length || (draft?.length ?? 0) > 0;
}

/**
 * A changed panel's row: its title and change, and with the plan's query, the draft's before it.
 *
 * @param panel - The plan's panel.
 * @param draft - The draft panel it replaces, if known.
 * @returns The row.
 */
function changedRow(panel: Plan['panels'][number], draft: DraftPanel | undefined): ChangeRow {
  const before = panel.query !== undefined ? draft?.query : undefined;
  return {
    tag: 'changed',
    title: panel.title,
    ...(panel.change ? { note: panel.change } : {}),
    ...(before !== undefined ? { before } : {}),
    ...(panel.query !== undefined ? { after: panel.query } : {}),
  };
}

/**
 * A plan's changes, in the order the card lists them: changes outside panels, changed panels, new
 * panels, removed panels, then how many the plan keeps.
 *
 * @param plan - The plan.
 * @param draft - The draft's panels, when known; without them, kept panels are not counted.
 * @returns The rows.
 */
export function changeRows(plan: Plan, draft: readonly DraftPanel[] = []): ChangeRow[] {
  const byId = new Map(draft.map((panel) => [panel.id, panel]));
  const outside = (plan.changes ?? []).map((note): ChangeRow => ({ tag: 'changed', title: note }));
  const replaced = plan.panels.filter((panel) => panel.replaces !== undefined);
  const added = plan.panels.filter((panel) => panel.replaces === undefined);
  const removes = plan.removes ?? [];
  const touched = new Set([...replaced.map((panel) => panel.replaces), ...removes]);
  const kept = draft.filter((panel) => !touched.has(panel.id)).length;
  return [
    ...outside,
    ...replaced.map((panel) => changedRow(panel, byId.get(panel.replaces ?? ''))),
    ...added.map(
      (panel): ChangeRow => ({
        tag: 'new',
        title: panel.title,
        kind: panel.kind,
        ...(panel.query ? { query: panel.query } : {}),
      }),
    ),
    ...removes.map((id): ChangeRow => ({ tag: 'removed', title: byId.get(id)?.title ?? id })),
    ...(kept > 0 ? [{ tag: 'same', count: kept } as const] : []),
  ];
}

/**
 * How the draft pane marks each draft panel while a plan waits.
 *
 * @param plan - The waiting plan.
 * @param draft - The draft's panels.
 * @returns The mark of each panel, by id.
 */
export function panelMarks(plan: Plan, draft: readonly DraftPanel[]): Record<string, PanelMark> {
  const changed = new Map(
    plan.panels.flatMap((panel) => (panel.replaces ? [[panel.replaces, panel.change]] : [])),
  );
  const removed = new Set(plan.removes ?? []);
  return Object.fromEntries(
    draft.map((panel): [string, PanelMark] => {
      if (removed.has(panel.id)) return [panel.id, { tag: 'removed' }];
      if (!changed.has(panel.id)) return [panel.id, { tag: 'same' }];
      const note = changed.get(panel.id);
      return [panel.id, { tag: 'changed', ...(note ? { note } : {}) }];
    }),
  );
}
