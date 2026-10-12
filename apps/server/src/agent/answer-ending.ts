/**
 * Why a run of the answering model ended with no answer. A step that calls no tool ends the run
 * although no limit was reached: the model's output was cut, its call could not be read, its
 * provider withheld the response, or it stopped with nothing. Each has its own words, so the person
 * is not told of a limit that was never reached, and is told of the one that was. The provider's
 * own reason is for the log, never for the message.
 */
import { type FinishReason, type TextStreamPart, ToolChoiceViolationError, type ToolSet } from 'ai';

/**
 * How a run ended without a tool call: `cut` at the output limit, `malformed` for a call the
 * provider could not read, `withheld` by the provider's content filter, `silent` for a step that
 * stopped with no call for no reason given.
 */
export type Stall = 'cut' | 'malformed' | 'withheld' | 'silent';

/** Why an answer has no text to show: the model call failed, or one of the endings without one. */
export type AnswerEnding = 'error' | 'refused' | 'limit' | Stall;

/**
 * A limit of one answer that leaves a step only the answer to give: `calls` for the tool call
 * limit, `tokens` for the token budget.
 */
export type StepLimit = 'calls' | 'tokens';

/** A step that ended the run with no tool call. */
export interface StalledStep {
  /** How it ended. */
  readonly stall: Stall;
  /** The provider's own finish reason, such as `MAX_TOKENS`, when it gave one. */
  readonly finishReason?: string;
}

/** What is read of a step to know how it ended. */
interface EndedStep {
  /** The finish reason, as the SDK unifies it. */
  readonly finishReason: FinishReason;
  /** The provider's own finish reason. */
  readonly rawFinishReason: string | undefined;
  /** The tools the step called. */
  readonly toolCalls: readonly unknown[];
}

/** A provider's finish reason for a tool call it could not read, such as Gemini's. */
const malformedReason = /malformed|unexpected_tool_call|tool_use_failed/i;

/**
 * How a step without a tool call ended.
 *
 * @param finish - The unified finish reason.
 * @param raw - The provider's own.
 * @returns The kind of ending.
 */
function stallOf(finish: FinishReason, raw: string | undefined): Stall {
  if (malformedReason.test(raw ?? '')) return 'malformed';
  if (finish === 'length') return 'cut';
  return finish === 'content-filter' ? 'withheld' : 'silent';
}

/**
 * Whether a run ended on a step that called no tool, and how.
 *
 * @param step - The run's last step.
 * @param violation - The finish reason of the response that broke the required tool call, which
 *   the step itself reports as an error.
 * @returns The stalled step, or `undefined` when the last step called a tool or there is none.
 */
export function stalledStep(
  step: EndedStep | undefined,
  violation?: FinishReason,
): StalledStep | undefined {
  if (step === undefined || step.toolCalls.length > 0) return undefined;
  const raw = step.rawFinishReason;
  const stall = stallOf(violation ?? step.finishReason, raw);
  return { stall, ...(raw === undefined ? {} : { finishReason: raw }) };
}

/** What each ending without a tool call tells the person, before what was tried after it. */
const stallWords: Readonly<Record<Stall, string>> = {
  cut: "The model's output was cut at its limit before it gave an answer",
  malformed: 'The model wrote a tool call that could not be read',
  withheld: "The model's provider withheld the response",
  silent: 'The model stopped without giving an answer',
};

/** What the person is told of a limit that left the step only the answer to give. */
const limitWords: Readonly<Record<StepLimit, string>> = {
  calls: 'The tool calls of one answer were used up, so the model could only give its answer.',
  tokens: 'The token budget of one answer was used up, so the model could only give its answer.',
};

/** What happened around a step that ended the run with no tool call. */
export interface StallCircumstances {
  /** Whether the model was asked once more, in a pass that may only give the answer. */
  readonly askedAgain: boolean;
  /** The limit that had left the step only the answer to give, if one had. */
  readonly limit?: StepLimit | undefined;
}

/**
 * The message of an answer that never came. It never quotes the provider's own finish reason.
 *
 * @param step - The step the run ended on.
 * @param circumstances - Whether the model was asked once more, and the limit reached if any.
 * @returns The limit when one was reached, what happened, and what to try.
 */
export function stallMessage(step: StalledStep, circumstances: StallCircumstances): string {
  const { askedAgain, limit } = circumstances;
  const before = limit === undefined ? '' : `${limitWords[limit]} `;
  const again = askedAgain ? ', even when asked once more to answer from what it had read' : '';
  const narrowly = limit !== undefined || step.stall === 'cut' || step.stall === 'withheld';
  const advice = narrowly ? 'asking more narrowly' : 'again';
  return `${before}${stallWords[step.stall]}${again}. Try ${advice}.`;
}

/**
 * A model stream without the error of a required tool call that never came: the run handles that
 * ending itself, so it is not shown to the person as a failed call.
 *
 * @param stream - The model's stream.
 * @param onViolation - Called with the finish reason of the response that called no tool.
 * @returns The stream, without that error.
 */
export function withoutViolations<TOOLS extends ToolSet>(
  stream: ReadableStream<TextStreamPart<TOOLS>>,
  onViolation: (finish: FinishReason) => void,
): ReadableStream<TextStreamPart<TOOLS>> {
  return stream.pipeThrough(
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(part, controller) {
        const error = part.type === 'error' ? part.error : undefined;
        if (ToolChoiceViolationError.isInstance(error)) onViolation(error.finishReason);
        else controller.enqueue(part);
      },
    }),
  );
}
