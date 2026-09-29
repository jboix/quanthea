/**
 * Pinned dashboards found without a model: a keyword search over titles, descriptions, panel
 * titles and connectors, for the first question of a thread; and a copy of one to start a draft
 * from, with its lineage.
 */
import { type DashboardSpec, dashboardSpecSchema } from '@querent/shared';
import type { PinnedRow } from '../db/dashboard-pinned.ts';
import { AppError } from '../lib/errors.ts';
import { meaningfulWords, sharedWords } from '../lib/words.ts';
import type { ServiceContext } from './context.ts';
import { newRows } from './rows.ts';

/** A pinned dashboard that may already answer a question. */
export interface PinnedMatch {
  /** The dashboard. */
  readonly dashboardId: string;
  /** Its title. */
  readonly title: string;
  /** The pinned version. */
  readonly version: number;
  /** Its panels' titles, at most twelve. */
  readonly panels: readonly string[];
}

/** The least score a match needs: one title word, or two words elsewhere. */
const minimumScore = 2;

/** The most matches offered. */
const maxMatches = 3;

/**
 * How much a pinned dashboard is about a question: title words count double.
 *
 * @param row - The dashboard.
 * @param spec - Its pinned spec.
 * @param question - The question's words.
 * @returns The score.
 */
function scoreOf(row: PinnedRow, spec: DashboardSpec, question: ReadonlySet<string>): number {
  const connectors = spec.panels.flatMap((panel) => panel.queries.map((query) => query.connector));
  const rest = [row.description ?? '', ...spec.panels.map((panel) => panel.title), ...connectors];
  const title = sharedWords(question, meaningfulWords(row.title));
  return 2 * title + sharedWords(question, meaningfulWords(rest.join(' ')));
}

/**
 * The pinned dashboards that best match a question.
 *
 * @param context - The service context.
 * @param question - The question.
 * @returns At most three matches, the best first; none when nothing matches well.
 */
export function findPinned(context: ServiceContext, question: string): PinnedMatch[] {
  const words = meaningfulWords(question);
  if (words.size === 0) return [];
  return context.repository
    .listPinned()
    .flatMap((row) => {
      const parsed = dashboardSpecSchema.safeParse(row.spec);
      return parsed.success
        ? [{ row, spec: parsed.data, score: scoreOf(row, parsed.data, words) }]
        : [];
    })
    .filter((entry) => entry.score >= minimumScore)
    .sort((first, second) => second.score - first.score)
    .slice(0, maxMatches)
    .map(({ row, spec }) => ({
      dashboardId: row.dashboardId,
      title: row.title,
      version: row.version,
      panels: spec.panels.slice(0, 12).map((panel) => panel.title),
    }));
}

/**
 * Copies a pinned dashboard's pinned version into a new dashboard that records where it came from.
 *
 * @param context - The service context.
 * @param dashboardId - The pinned dashboard.
 * @param actor - Who copies it.
 * @returns The new dashboard and its first version.
 * @throws {AppError} `not_found` when the dashboard is not pinned or is in the bin.
 */
export function copyPinned(context: ServiceContext, dashboardId: string, actor: string) {
  const pinned = context.repository.listPinned().find((row) => row.dashboardId === dashboardId);
  if (!pinned) throw new AppError('not_found', `No pinned dashboard ${dashboardId}.`);
  const spec = dashboardSpecSchema.parse(pinned.spec);
  const summary = `Copied from "${pinned.title}" v${pinned.version}`;
  const parent = { dashboardId, version: pinned.version };
  const { dashboard, version } = newRows(spec, summary, actor, context.now(), parent);
  context.repository.create(dashboard, version);
  const detail = { from: dashboardId, version: pinned.version };
  context.audit.append({ actor, action: 'dashboard.copy', target: dashboard.id, detail });
  return { dashboardId: dashboard.id, version: 1, title: spec.title };
}
