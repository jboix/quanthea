/**
 * The resource routes of the inspector's hand edits: a test run of an edited draft panel, which
 * saves nothing and so reloads nothing, and a save, which adds a version and reloads the thread.
 */
import {
  handEditPanelEndpoint,
  type PanelEdit,
  type PanelTestOutcome,
  testPanelEditEndpoint,
} from '@quanthea/shared';
import type { ActionFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What the inspector submits, as JSON: the panel and the edit. */
export interface PanelEditRequest {
  /** The panel edited. */
  readonly panelId: string;
  /** The edit. */
  readonly edit: PanelEdit;
}

/** A problem with an edited panel, at a path inside it. */
export interface PanelIssue {
  /** Such as `queries[0]` or `view.reduce`. */
  readonly path: string;
  /** What is wrong. */
  readonly message: string;
}

/** The outcome of a test run, or why it could not run. */
export type PanelTestResult =
  | { readonly ok: true; readonly outcome: PanelTestOutcome }
  | { readonly ok: false; readonly message: string };

/** The outcome of a save: the new version, or why not, with the problems. */
export type PanelSaveResult =
  | { readonly ok: true; readonly version: number }
  | { readonly ok: false; readonly message: string; readonly issues: readonly PanelIssue[] };

/**
 * The problems a refusal lists.
 *
 * @param error - The refusal.
 * @returns The problems, if it lists any.
 */
function issuesOf(error: ApiError): PanelIssue[] {
  if (!Array.isArray(error.details)) return [];
  return (error.details as Partial<PanelIssue>[]).flatMap((issue) =>
    typeof issue.message === 'string' ? [{ path: issue.path ?? '', message: issue.message }] : [],
  );
}

/**
 * The action of the test-run route.
 *
 * @param api - The API client.
 * @returns The action. A refusal comes back as a message.
 */
export function panelTestAction(api: ApiClient) {
  return async ({ request, params }: ActionFunctionArgs): Promise<PanelTestResult> => {
    const { panelId, edit } = (await request.json()) as PanelEditRequest;
    try {
      const path = { threadId: params.threadId ?? '', panelId };
      const outcome = await api.call(testPanelEditEndpoint, { params: path, body: edit });
      return { ok: true, outcome };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { ok: false, message: error.message };
    }
  };
}

/**
 * The action of the save route.
 *
 * @param api - The API client.
 * @returns The action. A refusal comes back as a message with the problems.
 */
export function panelSaveAction(api: ApiClient) {
  return async ({ request, params }: ActionFunctionArgs): Promise<PanelSaveResult> => {
    const { panelId, edit } = (await request.json()) as PanelEditRequest;
    try {
      const path = { threadId: params.threadId ?? '', panelId };
      const { version } = await api.call(handEditPanelEndpoint, { params: path, body: edit });
      return { ok: true, version };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { ok: false, message: error.message, issues: issuesOf(error) };
    }
  };
}
