/**
 * Asks a question about the dashboard and follows its answer as it streams. The request names the
 * version and what the dashboard shows; the server resolves the range and binds the variables,
 * and stores the question with its outcome.
 */
import {
  apiErrorBodySchema,
  askQuestionEndpoint,
  buildPath,
  type EndpointInput,
  questionIdHeader,
} from '@quanthea/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { answerMessages, type StreamedAnswer, streamedAnswer } from './ask-stream.ts';

/** What a question sends. */
export type AskBody = EndpointInput<typeof askQuestionEndpoint>['body'];

/** An answer on its way, or just ended. */
export interface LiveAnswer extends StreamedAnswer {
  /** The question. */
  readonly question: string;
  /** The question it follows up on. */
  readonly parentId: string | null;
  /** Whether it is still coming. */
  readonly answering: boolean;
  /** Why it stopped before an outcome, such as a refusal or a lost connection. */
  readonly error?: string | undefined;
  /** The stored question, once the server named it. */
  readonly questionId?: string | null | undefined;
}

/**
 * Sends a question.
 *
 * @param dashboardId - The dashboard.
 * @param body - The question and what the dashboard shows.
 * @param signal - Cancels the request.
 * @returns The response.
 */
function postQuestion(dashboardId: string, body: AskBody, signal: AbortSignal): Promise<Response> {
  return fetch(buildPath(askQuestionEndpoint.path, { dashboardId }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * The message of a refusal.
 *
 * @param response - A response with an error status.
 * @returns The server's message, or a plain one.
 */
export async function refusalOf(response: Response): Promise<string> {
  const parsed = apiErrorBodySchema.safeParse(await response.json().catch(() => undefined));
  return parsed.success ? parsed.data.error.message : `The server answered ${response.status}.`;
}

/**
 * Asks questions and follows the latest answer.
 *
 * @param dashboardId - The dashboard.
 * @param onEnd - Called with the stored question's id when an answer ends.
 * @returns The latest answer, the ask function, and a function that forgets the answer.
 */
export function useAsk(dashboardId: string, onEnd: (questionId: string | null) => void) {
  const [live, setLive] = useState<LiveAnswer | undefined>();
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const ask = useCallback(
    async (body: AskBody) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      const start = { question: body.question, parentId: body.parentId ?? null };
      const base = { ...start, text: '', reads: 0, outcome: undefined, answering: true };
      setLive(base);
      const ended = await follow(dashboardId, body, controller.signal, (next) =>
        setLive({ ...base, ...next }),
      );
      if (controller.signal.aborted) return;
      setLive((current) => current && { ...current, ...ended, answering: false });
      if (!ended.error) onEnd(ended.questionId ?? null);
    },
    [dashboardId, onEnd],
  );
  const clear = useCallback(() => setLive(undefined), []);
  return { live, ask, clear };
}

/**
 * Sends a question and reports its answer as it grows.
 *
 * @param dashboardId - The dashboard.
 * @param body - The question.
 * @param signal - Cancels the request.
 * @param onUpdate - Receives the answer so far.
 * @returns How it ended: the stored question's id, or why it stopped.
 */
async function follow(
  dashboardId: string,
  body: AskBody,
  signal: AbortSignal,
  onUpdate: (answer: Partial<LiveAnswer>) => void,
): Promise<Pick<LiveAnswer, 'error' | 'questionId'>> {
  try {
    const response = await postQuestion(dashboardId, body, signal);
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
