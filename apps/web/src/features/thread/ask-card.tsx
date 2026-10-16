import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import styles from './cards.module.css';
import type { ToolPart } from './messages.ts';

/** Props of {@link AskCard}. */
interface AskCardProps {
  /** The `ask_person` tool part. */
  readonly part: ToolPart;
  /** Whether the question still waits for an answer: the latest message, with no run going. */
  readonly answerable: boolean;
  /** Sends an option as the person's answer. */
  readonly onAnswer: (answer: string) => void;
}

/** A question of the agent, as far as it has streamed. */
interface Ask {
  /** The question. */
  readonly question: string;
  /** The options that are complete strings. */
  readonly options: string[];
  /** Whether the person may pick several options. */
  readonly multiple: boolean;
}

/**
 * The question and options of an `ask_person` call, as far as they have streamed.
 *
 * @param part - The tool part.
 * @returns The question, the options that are complete strings, and whether several can be picked.
 */
function askOf(part: ToolPart): Ask {
  const input = (part.input ?? {}) as { question?: unknown; options?: unknown; multiple?: unknown };
  const options = Array.isArray(input.options) ? input.options : [];
  return {
    question: typeof input.question === 'string' ? input.question : '',
    options: options.filter((option): option is string => typeof option === 'string'),
    multiple: input.multiple === true,
  };
}

/**
 * The options as buttons: picking one sends it as the answer.
 *
 * @param props - The options, whether they can be picked, and the answer callback.
 * @param props.options - The options.
 * @param props.answerable - Whether the question still waits for an answer.
 * @param props.onAnswer - Sends the answer.
 * @returns The buttons.
 */
function SingleChoice({
  options,
  answerable,
  onAnswer,
}: { readonly options: readonly string[] } & Omit<AskCardProps, 'part'>) {
  return (
    <div className={styles.askOptions}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={styles.option}
          disabled={!answerable}
          onClick={() => onAnswer(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/**
 * The options ticked, and the way to tick or untick one.
 *
 * @returns The ticked options and the toggle.
 */
function useTicked() {
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const toggle = (option: string) =>
    setTicked((current) =>
      current.includes(option) ? current.filter((each) => each !== option) : [...current, option],
    );
  return { ticked, toggle };
}

/**
 * The options as toggles, and a button that sends those ticked, joined with commas, as the answer.
 *
 * @param props - The options, whether they can be picked, and the answer callback.
 * @param props.options - The options.
 * @param props.answerable - Whether the question still waits for an answer.
 * @param props.onAnswer - Sends the answer.
 * @returns The toggles and the button.
 */
function MultipleChoice({
  options,
  answerable,
  onAnswer,
}: { readonly options: readonly string[] } & Omit<AskCardProps, 'part'>) {
  const { ticked, toggle } = useTicked();
  const answer = options.filter((option) => ticked.includes(option));
  return (
    <>
      <div className={styles.askOptions}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={styles.option}
            aria-pressed={ticked.includes(option)}
            disabled={!answerable}
            onClick={() => toggle(option)}
          >
            {ticked.includes(option) ? `✓ ${option}` : option}
          </button>
        ))}
      </div>
      {answerable && (
        <Button
          size="small"
          variant="primary"
          className={styles.askSend}
          disabled={answer.length === 0}
          onClick={() => onAnswer(answer.join(', '))}
        >
          {answer.length > 1 ? `Send these ${answer.length}` : 'Send'}
        </Button>
      )}
    </>
  );
}

/**
 * A question the agent asks, with its options as buttons. Picking one sends it as the answer, or,
 * when several can be picked, ticking them and Send; typing in the composer works too.
 *
 * @param props - The tool part, whether it can be answered, and the answer callback.
 * @returns The card.
 */
export function AskCard({ part, answerable, onAnswer }: AskCardProps) {
  const { question, options, multiple } = askOf(part);
  if (question === '') return null;
  const Choice = multiple ? MultipleChoice : SingleChoice;
  return (
    <section className={styles.ask} aria-label="Question">
      <p className={styles.askQuestion}>{question}</p>
      {multiple && answerable && <span className={styles.hint}>Pick one or more.</span>}
      <Choice options={options} answerable={answerable} onAnswer={onAnswer} />
      {answerable && <span className={styles.hint}>or type your own answer below</span>}
    </section>
  );
}
