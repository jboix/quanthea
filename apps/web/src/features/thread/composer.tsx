import { type FormEvent, type KeyboardEvent, useRef } from 'react';
import styles from './composer.module.css';

/** A panel the person can mention. */
interface MentionablePanel {
  /** The panel id. */
  readonly id: string;
  /** Its title, written `@Title` in the message. */
  readonly title: string;
}

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
 * The `@` word being typed at the end of the text, if any.
 *
 * @param text - The text.
 * @returns What follows the last `@`, when nothing but letters, digits and spaces follow it.
 */
function mentionQuery(text: string): string | undefined {
  const match = /(?:^|\s)@([\w ·,-]{0,40})$/.exec(text);
  return match?.[1];
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
 * The menu of panels matching an `@` being typed.
 *
 * @param props - The matching panels and the pick callback.
 * @param props.matches - The panels.
 * @param props.onPick - Called with the picked panel.
 * @returns The menu.
 */
function MentionMenu({
  matches,
  onPick,
}: {
  readonly matches: readonly MentionablePanel[];
  readonly onPick: (panel: MentionablePanel) => void;
}) {
  return (
    <ul className={styles.menu} aria-label="Mention a panel">
      {matches.map((panel) => (
        <li key={panel.id}>
          <button
            type="button"
            className={styles.menuItem}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(panel)}
          >
            {panel.title}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The composer's behaviour: the mention menu, picking a panel, sending, and the keys.
 *
 * @param props - The composer's props.
 * @returns The input ref, the matching panels and the handlers.
 */
function useComposer(props: ComposerProps) {
  const { draft, onDraft, panels, running } = props;
  const input = useRef<HTMLTextAreaElement>(null);
  const query = mentionQuery(draft);
  const needle = query?.trim().toLowerCase() ?? '';
  const matches =
    query === undefined
      ? []
      : panels.filter((panel) => panel.title.toLowerCase().includes(needle)).slice(0, 6);
  const pick = (panel: MentionablePanel) => {
    onDraft(`${draft.slice(0, draft.length - (query?.length ?? 0) - 1)}@${panel.title} `);
    input.current?.focus();
  };
  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (running || draft.trim() === '') return;
    props.onSend(draft.trim(), mentionsIn(draft, panels));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    if (matches[0]) pick(matches[0]);
    else send();
  };
  return { input, matches, pick, send, onKeyDown };
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
 * The composer: a message, `@` mentions of the draft's panels, the model and access chips, and
 * send or stop.
 *
 * @param props - The text, the panels, the chips, and the callbacks.
 * @returns The composer.
 */
export function Composer(props: ComposerProps) {
  const { input, matches, pick, send, onKeyDown } = useComposer(props);
  return (
    <form className={styles.composer} onSubmit={send}>
      {matches.length > 0 && <MentionMenu matches={matches} onPick={pick} />}
      <textarea
        ref={input}
        className={styles.input}
        rows={2}
        placeholder="Reply, or @mention a panel…"
        aria-label="Message"
        value={props.draft}
        onChange={(event) => props.onDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <ComposerBar {...props} />
    </form>
  );
}
