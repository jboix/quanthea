import { type FormEvent, type KeyboardEvent, useRef } from 'react';
import styles from './composer.module.css';
import { MentionMenu, mentionMenuId, mentionOptionId } from './mention-menu.tsx';
import { composerInputId } from './mention-panel.ts';
import type { MentionablePanel } from './mention-query.ts';
import { useMentionMenu } from './use-mention.ts';

/** Props of {@link Composer}. */
interface ComposerProps {
  /** The text being written. */
  readonly draft: string;
  /** Changes the text. */
  readonly onDraft: (draft: string) => void;
  /** The panels of the current draft, for `@` mentions. */
  readonly panels: readonly MentionablePanel[];
  /** The chip that names the model. */
  readonly model: string;
  /** The chip that says what access the connectors give. */
  readonly access: string;
  /** Whether the agent is working. */
  readonly running: boolean;
  /** Sends the text with the panels it mentions. */
  readonly onSend: (text: string, mentions: readonly { panelId: string; title: string }[]) => void;
  /** Stops the agent. */
  readonly onStop: () => void;
}

/**
 * The panels a text mentions.
 *
 * @param text - The text.
 * @param panels - The panels.
 * @returns Each panel whose `@Title` appears in the text.
 */
function mentionsIn(text: string, panels: readonly MentionablePanel[]) {
  return panels
    .filter((panel) => text.includes(`@${panel.title}`))
    .map((panel) => ({ panelId: panel.id, title: panel.title }));
}

/**
 * The composer's behaviour: the mention menu, sending, and the keys.
 *
 * @param props - The composer's props.
 * @returns The input ref, the menu, and the handlers.
 */
function useComposer(props: ComposerProps) {
  const { draft, onDraft, panels, running } = props;
  const input = useRef<HTMLTextAreaElement>(null);
  const { menu, onChange } = useMentionMenu(draft, onDraft, panels, input);
  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (running || draft.trim() === '') return;
    props.onSend(draft.trim(), mentionsIn(draft, panels));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu.onKey(event)) return;
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    send();
  };
  return { input, menu, onChange, send, onKeyDown };
}

/**
 * The composer's bottom bar: the chips, and send or stop.
 *
 * @param props - The composer's props.
 * @returns The bar.
 */
function ComposerBar({ model, access, running, draft, onStop }: ComposerProps) {
  return (
    <div className={styles.bar}>
      <span className={styles.chip}>{model}</span>
      <span className={styles.chip}>Access: {access}</span>
      {running ? (
        <button type="button" className={styles.send} aria-label="Stop" onClick={onStop}>
          ■
        </button>
      ) : (
        <button
          type="submit"
          className={styles.send}
          aria-label="Send"
          disabled={draft.trim() === ''}
        >
          ↑
        </button>
      )}
    </div>
  );
}

/**
 * Scrolls the copy of the text behind the text box with it, so the greyed rest of a title stays
 * after the cursor.
 *
 * @param input - The text box.
 */
function syncMirror(input: HTMLTextAreaElement) {
  const mirror = input.previousElementSibling;
  if (mirror) mirror.scrollTop = input.scrollTop;
}

/**
 * The composer: a message, `@` mentions of the draft's panels, the model and access chips, and
 * send or stop.
 *
 * @param props - The text, the panels, the chips, and the callbacks.
 * @returns The composer.
 */
export function Composer(props: ComposerProps) {
  const { input, menu, onChange, send, onKeyDown } = useComposer(props);
  const listed = menu.matches.length > 0;
  return (
    <form className={styles.composer} onSubmit={send}>
      {listed && <MentionMenu menu={menu} />}
      <div className={styles.field}>
        <div className={styles.mirror} aria-hidden="true">
          {props.draft}
          <span className={styles.ghost}>{menu.ghost}</span>
        </div>
        <textarea
          id={composerInputId}
          ref={input}
          className={styles.input}
          rows={2}
          placeholder={props.panels.length > 0 ? 'Reply, or @mention a panel…' : 'Reply…'}
          aria-label="Message"
          aria-controls={listed ? mentionMenuId : undefined}
          aria-activedescendant={listed ? mentionOptionId(menu.active) : undefined}
          value={props.draft}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onScroll={(event) => syncMirror(event.currentTarget)}
        />
      </div>
      <ComposerBar {...props} />
    </form>
  );
}
