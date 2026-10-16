/**
 * Which part of a thread shows: the conversation beside the draft, or the draft alone, full
 * screen. A phone has room for one, so there the conversation shows alone until the person opens
 * the draft. The choice is in the address (`?view=draft`), so Back returns to the conversation.
 */
import { useSearchParams } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { BackIcon, ExpandIcon } from '../../ui/icons.tsx';
import styles from './thread.module.css';

/** The conversation beside the draft, or the draft alone. */
export type ThreadView = 'split' | 'draft';

/**
 * The view shown, and the way to change it.
 *
 * @returns The view and its setter.
 */
export function useThreadView(): {
  readonly view: ThreadView;
  readonly show: (view: ThreadView) => void;
} {
  const [search, setSearch] = useSearchParams();
  const view: ThreadView = search.get('view') === 'draft' ? 'draft' : 'split';
  const show = (next: ThreadView) => {
    if (next === view) return;
    setSearch((current) => {
      if (next === 'draft') current.set('view', 'draft');
      else current.delete('view');
      return current;
    });
  };
  return { view, show };
}

/** Props of {@link DraftViewButton} and {@link OpenDraftButton}. */
interface ViewButtonProps {
  /** The view shown. */
  readonly view: ThreadView;
  /** Changes it. */
  readonly onView: (view: ThreadView) => void;
  /** What the thread drafts: `dashboard`, `alert` or `report`. */
  readonly noun: string;
}

/**
 * The draft header's button: Full screen beside the conversation, where there is room for both,
 * or Back to the thread when the draft shows alone.
 *
 * @param props - The view, its setter and what the thread drafts.
 * @returns The button.
 */
export function DraftViewButton({ view, onView, noun }: ViewButtonProps) {
  if (view === 'draft') {
    return (
      <Button className={styles.viewButton} onClick={() => onView('split')}>
        <BackIcon />
        Thread
      </Button>
    );
  }
  return (
    <Button
      className={`${styles.viewButton} ${styles.wideOnly}`}
      aria-label={`Show the ${noun} full screen`}
      title={`Show the ${noun} full screen`}
      onClick={() => onView('draft')}
    >
      <ExpandIcon />
    </Button>
  );
}

/**
 * The thread header's button that opens the draft, on a screen too narrow to show it beside the
 * conversation.
 *
 * @param props - The view, its setter and what the thread drafts.
 * @returns The button.
 */
export function OpenDraftButton({ onView, noun }: ViewButtonProps) {
  return (
    <Button
      size="small"
      className={`${styles.viewButton} ${styles.narrowOnly}`}
      onClick={() => onView('draft')}
    >
      <ExpandIcon />
      Show the {noun}
    </Button>
  );
}
