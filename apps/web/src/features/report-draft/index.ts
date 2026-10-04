/**
 * The report draft: the draft pane of a report thread, its data and actions. The schedule reads
 * as a sentence of values to change by hand; the preview draws the draft's panels from one run
 * over its latest period.
 */
export {
  isReportIntent,
  loadReportDraft,
  type ReportDraftData,
  type ReportIntent,
  reportPreviewLoader,
  runReportIntent,
} from './data.ts';
export { ReportDraftPane } from './report-draft-pane.tsx';
