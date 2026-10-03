/** The dashboard screen: its route component and loaders. */
export {
  loadQuestion,
  loadQuestions,
  loadSimilarQuestions,
  loadSources,
} from './ask-data.ts';
export { DashboardCanvas } from './canvas.tsx';
export { changeDashboard, loadDashboard, loadPanelRun, loadVariableOptions } from './data.ts';
export { FrozenCanvas } from './frozen-canvas.tsx';
export { type PanelPlanMark, usePanelRunData } from './panel-card.tsx';
export { PanelPreview } from './panel-preview.tsx';
export { PanelView } from './panel-views.tsx';
export { loadDashboardSnapshots } from './snapshot-data.ts';
export { dateTimeWords, rangeWords, untilWords } from './snapshot-words.ts';
export { useCanEdit } from './use-can-edit.ts';
export { versionNote } from './version-note.ts';
