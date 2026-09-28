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

/**
 * The question and options of an `ask_person` call, as far as they have streamed.
 *
 * @param part - The tool part.
 * @returns The question and the options that are complete strings.
 */
function askOf(part: ToolPart): { question: string; options: string[] } {
  const input = (part.input ?? {}) as { question?: unknown; options?: unknown };
  const options = Array.isArray(input.options) ? input.options : [];
  return {
    question: typeof input.question === 'string' ? input.question : '',
    options: options.filter((option): option is string => typeof option === 'string'),
  };
}

/**
 * A question the agent asks, with its options as buttons. Picking one sends it as the answer;
 * typing in the composer works too.
 *
 * @param props - The tool part, whether it can be answered, and the answer callback.
 * @returns The card.
 */
export function AskCard({ part, answerable, onAnswer }: AskCardProps) {
  const { question, options } = askOf(part);
  if (question === '') return null;
  return (
    <section className={styles.ask} aria-label="Question">
      <p className={styles.askQuestion}>{question}</p>
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
      {answerable && <span className={styles.hint}>or type your own answer below</span>}
    </section>
  );
}
