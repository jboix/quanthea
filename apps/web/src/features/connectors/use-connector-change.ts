/** Submits changes to a connector from the sections of its screen. */
import { type SubmitTarget, useFetcher } from 'react-router';
import type { ChangeOutcome, ConnectorIntent } from './data.ts';

/**
 * Hands a JSON body to React Router. Its type wants JSON values only; settings are JSON already,
 * since they come from form inputs, but their types say `unknown`.
 *
 * @param body - The body.
 * @returns The same body, as a submit target.
 */
export function asJsonBody(body: object): SubmitTarget {
  return body as SubmitTarget;
}

/** A section's channel for changing its connector. */
export interface ConnectorChange {
  /** Sends a change to the connector's route action. */
  readonly submit: (intent: ConnectorIntent) => void;
  /** Whether a change is on its way. */
  readonly pending: boolean;
  /** The change on its way, for showing it before the server confirms. */
  readonly pendingIntent: ConnectorIntent | undefined;
  /** The outcome of the last change, until the next one. */
  readonly outcome: ChangeOutcome | undefined;
}

/**
 * A channel for changing a connector. Each section has its own, so their pending states and
 * errors stay apart.
 *
 * @param connectorId - The connector.
 * @returns The channel.
 */
export function useConnectorChange(connectorId: string): ConnectorChange {
  const fetcher = useFetcher<ChangeOutcome>();
  const pending = fetcher.state !== 'idle';
  return {
    submit: (intent) =>
      void fetcher.submit(asJsonBody(intent), {
        method: 'post',
        encType: 'application/json',
        action: `/connectors/${connectorId}`,
      }),
    pending,
    pendingIntent: pending ? (fetcher.json as ConnectorIntent | undefined) : undefined,
    outcome: fetcher.data,
  };
}

/**
 * The error message of an outcome, if it failed.
 *
 * @param outcome - The outcome.
 * @param key - The field whose issue to prefer, such as `guardrails.maxRows`.
 * @returns The field's issue, else the general message, or `undefined` when it succeeded.
 */
export function failureOf(outcome: ChangeOutcome | undefined, key?: string): string | undefined {
  if (!outcome || outcome.ok) return undefined;
  return (key !== undefined ? outcome.issues[key] : undefined) ?? outcome.message;
}
