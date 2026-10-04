/**
 * The dashboard screen: its route component and loaders, and the parts of its Ask panel that
 * questions about a report's run show too.
 */

export { loadDashboardAlerts } from './alerts-data.ts';
export { AnswerText, EvidenceList } from './ask-answer.tsx';
export { ConfirmBin, useBinConversation } from './ask-bin.tsx';
export {
  binConversation,
  loadConversation,
  loadConversations,
  loadSimilarQuestions,
  loadSources,
} from './ask-data.ts';
export { AskForm, ExplainOnlyCard, SimilarQuestions, WhoCanAsk } from './ask-form.tsx';
export { HistoryTab } from './ask-history.tsx';
export { Asked } from './ask-message.tsx';
export { useCanAsk, useConversations } from './ask-state.ts';
export { answerMessages, type StreamedAnswer, streamedAnswer } from './ask-stream.ts';
export { dayLabel, instantLabel } from './ask-words.ts';
export { DashboardCanvas } from './canvas.tsx';
export { changeDashboard, loadDashboard, loadPanelRun, loadVariableOptions } from './data.ts';
export { loadExplanation } from './explain-data.ts';
export { FrozenCanvas } from './frozen-canvas.tsx';
export { type Loaded, loaded } from './loaded.ts';
export { type PanelPlanMark, usePanelRunData } from './panel-card.tsx';
export { PanelPreview } from './panel-preview.tsx';
export { PanelView } from './panel-views.tsx';
export { loadDashboardSnapshots } from './snapshot-data.ts';
export { dateTimeWords, rangeWords, untilWords } from './snapshot-words.ts';
export { refusalOf } from './use-ask.ts';
export { useCanEdit } from './use-can-edit.ts';
export { versionNote } from './version-note.ts';
