/**
 * An alert as a dashboard shows it on a linked panel: whether it is evaluated and muted, its
 * active threshold and fixed variables, each series' state, and its firing periods over a range.
 */
import {
  type AlertSpec,
  alertSpecSchema,
  type PanelAlert,
  type ResolvedTimeRange,
} from '@quanthea/shared';
import type { AlertLinkRepository } from '../db/alert-link-repository.ts';
import type { AlertRepository, AlertRow } from '../db/alert-repository.ts';
import type { AlertStateRepository } from '../db/alert-state-repository.ts';
import { firingPeriods } from './link-match.ts';

/** What reading an alert for a panel needs. */
interface PanelAlertContext {
  /** Reads the firing changes. */
  readonly links: Pick<AlertLinkRepository, 'firingChanges'>;
  /** Reads versions. */
  readonly repository: Pick<AlertRepository, 'version'>;
  /** Reads the series now. */
  readonly states: Pick<AlertStateRepository, 'series'>;
  /** The clock. */
  readonly now: () => number;
}

/**
 * The active spec of an alert, if it has one that still parses.
 *
 * @param context - The service context.
 * @param alert - The alert.
 * @returns The spec.
 */
function activeSpec(context: PanelAlertContext, alert: AlertRow): AlertSpec | undefined {
  if (alert.activeVersion === null) return undefined;
  const row = context.repository.version(alert.id, alert.activeVersion);
  const parsed = alertSpecSchema.safeParse(row?.spec);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Whether an alert is muted now.
 *
 * @param alert - The alert.
 * @param now - The current instant.
 * @returns Whether it is.
 */
function mutedNow(alert: AlertRow, now: number): boolean {
  return alert.mutedAt !== null && (alert.mutedUntil === null || alert.mutedUntil > now);
}

/**
 * An alert as a dashboard shows it.
 *
 * @param context - The service context.
 * @param alert - The alert.
 * @param range - The range of the firing periods.
 * @returns The alert.
 */
export function panelAlertOf(
  context: PanelAlertContext,
  alert: AlertRow,
  range: ResolvedTimeRange,
): PanelAlert {
  const spec = activeSpec(context, alert);
  const series = context.states.series(alert.id);
  const { condition } = spec ?? {};
  const changes = context.links.firingChanges(alert.id, range.to);
  return {
    id: alert.id,
    title: alert.title,
    evaluated: spec !== undefined && alert.deactivatedAt === null,
    muted: mutedNow(alert, context.now()),
    threshold:
      condition?.kind === 'threshold' ? { op: condition.op, value: condition.value } : null,
    format: spec?.value.format ?? null,
    variables: (spec?.variables ?? []).map(({ name, value }) => ({ name, value })),
    series: series.map(({ labels, state }) => ({ labels, state })),
    periods: firingPeriods(changes, series, range),
  };
}
