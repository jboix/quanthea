/**
 * The alert draft: the draft pane of an alert thread, its data and actions. Its pieces (the
 * condition as a sentence, the draggable threshold, the channel previews) are its own files, for
 * the alert page to share once it uses them.
 */
export { AlertDraftPane } from './alert-draft-pane.tsx';
export {
  type AlertDraftData,
  type AlertIntent,
  alertPreviewsAction,
  errorText,
  isAlertIntent,
  loadAlertDraft,
  runAlertIntent,
} from './data.ts';
