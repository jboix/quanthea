/**
 * Asks a question about a run and follows its answer as it streams. The request names the question
 * and the conversation it continues, never a query or a result; the server reads the run's frozen
 * results and stores the question with its outcome.
 */
import {
  askRunQuestionEndpoint,
  buildPath,
  type EndpointInput,
  questionIdHeader,
} from '@quanthea/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  answerMessages,
  refusalOf,
  type StreamedAnswer,
  streamedAnswer,
} from '../dashboard/index.ts';

/** What a question sends. */
type AskBody = EndpointInput<typeof askRunQuestionEndpoint>['body'];

/** The run a question is about. */
interface RunTarget {
  /** The report. */
  readonly reportId: string;
  /** The run. */
  readonly runId: string;
}

/** An answer on its way, or just ended. */
export interface LiveRunAnswer extends StreamedAnswer {
  /** The question. */
  readonly question: string;
  /** The conversation it continues, or `undefined` when it starts one. */
  readonly conversationId: string | undefined;
  /** Whether it is still coming. */
  readonly answering: boolean;
  /** Why it stopped before an outcome, such as a refusal or a lost connection. */
  readonly error?: string | undefined;
  /** The stored question, once the server named it. */
  readonly questionId?: string | null | undefined;
}

/**
 * Sends a question and reports its answer as it grows.
 *
 * @param target - The run.
 * @param body - The question.
 * @param signal - Cancels the request.
 * @param onUpdate - Receives the answer so far.
 * @returns How it ended: the stored question's id, or why it stopped.
 */
async function follow(
  target: RunTarget,
  body: AskBody,
  signal: AbortSignal,
  onUpdate: (answer: Partial<LiveRunAnswer>) => void,
): Promise<Pick<LiveRunAnswer, 'error' | 'questionId'>> {
  try {
    const response = await fetch(buildPath(askRunQuestionEndpoint.path, { ...target }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok || !response.body) return { error: await refusalOf(response) };
    const questionId = response.headers.get(questionIdHeader);
    for await (const message of answerMessages(response.body)) {
      onUpdate({ ...streamedAnswer(message), questionId });
    }
    return { questionId };
  } catch {
    return { error: 'The answer stopped: the connection to the server was lost.' };
  }
}

/**
 * Asks questions about a run and follows the latest answer.
 *
 * @param target - The run.
 * @param onEnd - Called with the stored question's id when an answer ends, and the conversation
 *   it continued.
 * @returns The latest answer, the ask function, and a function that forgets the answer.
 */
export function useRunAsk(
  target: RunTarget,
  onEnd: (questionId: string | null, conversationId: string | undefined) => void,
) {
  const [live, setLive] = useState<LiveRunAnswer | undefined>();
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const { reportId, runId } = target;
  const ask = useCallback(
    async (body: AskBody) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      const start = { question: body.question, conversationId: body.conversationId };
      const base = { ...start, text: '', reads: 0, outcome: undefined, answering: true };
      setLive(base);
      const ended = await follow({ reportId, runId }, body, controller.signal, (next) =>
        setLive({ ...base, ...next }),
      );
      if (controller.signal.aborted) return;
      setLive((current) => current && { ...current, ...ended, answering: false });
      if (!ended.error) onEnd(ended.questionId ?? null, body.conversationId);
    },
    [reportId, runId, onEnd],
  );
  const clear = useCallback(() => setLive(undefined), []);
  return { live, ask, clear };
}
