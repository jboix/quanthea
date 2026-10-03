/**
 * A panel's explanation: the latest one stored, loaded through a fetcher, and a new one asked for
 * and followed as it streams. The request names the panel and the explanation it replaces, never
 * data: the server explains from the spec and the schema only, and stores what holds.
 */
import { buildPath, explainPanelEndpoint } from '@quanthea/shared';
import { useCallback, useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { answerMessages, streamedAnswer } from './ask-stream.ts';
import type { ExplanationState } from './explain-data.ts';
import type { Loaded } from './loaded.ts';
import { refusalOf } from './use-ask.ts';

/** How long to wait before looking again while someone else's explanation is written, in ms. */
const pollMs = 3000;

/** A panel of a version. */
export interface ExplanationTarget {
  /** The dashboard. */
  readonly dashboardId: string;
  /** The version. */
  readonly version: number;
  /** The panel. */
  readonly panelId: string;
}

/** An explanation asked for here: on its way, or how it ended. */
export interface LiveExplanation {
  /** The text as written so far. */
  readonly text: string;
  /** Whether it is still coming. */
  readonly writing: boolean;
  /** The explanation it replaces, `null` for the first. */
  readonly replaces: string | null;
  /** Why there is none, such as a refusal or a failed check. */
  readonly error?: string | undefined;
}

/**
 * The latest stored explanation of a panel, loaded when asked for, and again every few seconds
 * while one is being written.
 *
 * @param target - The panel of a version.
 * @returns The stored state once loaded, why it failed to load, and the reload function.
 */
export function useStoredExplanation(target: ExplanationTarget) {
  const { load, data, state } = useFetcher<Loaded<ExplanationState>>();
  const panel = encodeURIComponent(target.panelId);
  const url = `/d/${target.dashboardId}/v/${target.version}/panels/${panel}/explanation`;
  useEffect(() => {
    void load(url);
  }, [load, url]);
  const generating = data?.ok === true && data.value.generating;
  useEffect(() => {
    if (!generating || state !== 'idle') return;
    const timer = setTimeout(() => void load(url), pollMs);
    return () => clearTimeout(timer);
  }, [generating, state, load, url]);
  const reload = useCallback(() => void load(url), [load, url]);
  const stored = data?.ok ? data.value : undefined;
  return { stored, failed: data?.ok === false ? data.message : undefined, reload };
}

/**
 * Asks for an explanation and follows it as it streams. The request goes on when the bubble
 * closes, so the explanation is stored all the same.
 *
 * @param target - The panel of a version.
 * @param onEnd - Called when it ends, however it ends, to load the stored one.
 * @returns The explanation asked for here, and the function that asks.
 */
export function useExplain(target: ExplanationTarget, onEnd: () => void) {
  const [live, setLive] = useState<LiveExplanation | undefined>();
  const explain = useCallback(
    async (replaces: string | null) => {
      setLive({ text: '', writing: true, replaces });
      const ended = await follow(target, replaces, (text) =>
        setLive({ text, writing: true, replaces }),
      );
      setLive({ ...ended, writing: false, replaces });
      onEnd();
    },
    [target, onEnd],
  );
  return { live, explain };
}

/**
 * Sends the request and reports the text as it grows.
 *
 * @param target - The panel of a version.
 * @param replaces - The explanation it replaces.
 * @param onText - Receives the text so far.
 * @returns The final text, or why there is none.
 */
async function follow(
  target: ExplanationTarget,
  replaces: string | null,
  onText: (text: string) => void,
): Promise<{ text: string; error?: string }> {
  const { dashboardId, version, panelId } = target;
  const path = buildPath(explainPanelEndpoint.path, {
    dashboardId,
    version: String(version),
    panelId,
  });
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' },
      body: JSON.stringify({ replaces }),
    });
    if (!response.ok || !response.body) return { text: '', error: await refusalOf(response) };
    return await streamed(response.body, onText);
  } catch {
    return { text: '', error: 'The explanation stopped: the connection to the server was lost.' };
  }
}

/**
 * Reads an explanation's stream to its end.
 *
 * @param body - The response body.
 * @param onText - Receives the text so far.
 * @returns The final text, or why there is none.
 */
async function streamed(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
): Promise<{ text: string; error?: string }> {
  let last = streamedAnswer({ id: '', role: 'assistant', parts: [] });
  for await (const message of answerMessages(body)) {
    last = streamedAnswer(message);
    onText(last.text);
  }
  if (!last.outcome) return { text: '', error: 'The explanation stopped before its end.' };
  if (!last.outcome.ok) return { text: '', error: last.outcome.message };
  return { text: last.outcome.answer.text };
}
