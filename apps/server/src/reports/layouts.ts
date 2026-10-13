/**
 * Reports as what a layout arranges. The version shown is the active one, which the runs are made
 * from, and a layout names the panels of its grid: every panel that is not a headline number.
 */
import { reportCanvasPanels, reportSpecSchema } from '@quanthea/shared';
import type { LayoutSubject, LayoutTarget } from '../dashboards/layouts.ts';
import type { ReportRepository } from '../db/report-repository.ts';
import { AppError } from '../lib/errors.ts';

/**
 * Reports as what is arranged.
 *
 * @param repository - Stores reports.
 * @returns The subject.
 */
export function reportSubject(repository: ReportRepository): LayoutSubject {
  const versionOf = ({ subjectId, version }: LayoutTarget) => {
    const row = repository.version(subjectId, version);
    if (!row) throw new AppError('not_found', `Report ${subjectId} has no version ${version}.`);
    return row;
  };
  return {
    action: 'report.layout',
    check: (target) => void versionOf(target),
    arranged: (target) => {
      const row = versionOf(target);
      if (repository.get(target.subjectId)?.activeVersion !== target.version)
        throw new AppError('bad_request', 'Only the active version can be arranged.');
      return { panels: reportCanvasPanels(reportSpecSchema.parse(row.spec)) };
    },
  };
}
