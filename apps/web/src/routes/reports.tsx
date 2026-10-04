/** The routes of the reports: the list, a run's page, and their resource routes. */
import type { RouteObject } from 'react-router';
import { guarded, requireRole } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import {
  binRunConversation,
  changeReport,
  loadLatestRun,
  loadReportSettings,
  loadReports,
  loadRun,
  loadRunConversation,
  loadRunConversations,
  loadRunSources,
  loadSimilarRunQuestions,
  loadUnseen,
  reportSettingsPath,
  reportsRouteId,
  saveReportSettings,
  unseenPath,
} from '../features/reports/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The resource routes of a run's side panel: its conversations, one conversation (and moving it
 * to the bin, for analysts and above), the earlier questions like a text, and its sources.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route objects.
 */
function askRoutes(loadSession: SessionLoader, api: ApiClient): RouteObject[] {
  const conversations = '/reports/:reportId/runs/:runId/conversations';
  const conversation = '/reports/:reportId/runs/:runId/conversations/:conversationId';
  const similar = '/reports/:reportId/runs/:runId/similar-questions';
  const sources = '/reports/:reportId/runs/:runId/sources';
  const analyst = requireRole(loadSession, 'analyst');
  const bin = binRunConversation(api);
  return [
    {
      path: conversations,
      loader: guarded(loadSession, conversations, loadRunConversations(api)),
      shouldRevalidate: () => false,
    },
    {
      path: conversation,
      loader: guarded(loadSession, conversation, loadRunConversation(api)),
      action: async (args) => {
        await analyst(args);
        return bin(args);
      },
      shouldRevalidate: () => false,
    },
    { path: similar, loader: guarded(loadSession, similar, loadSimilarRunQuestions(api)) },
    {
      path: sources,
      loader: guarded(loadSession, sources, loadRunSources(api)),
      shouldRevalidate: () => false,
    },
  ];
}

/**
 * The reports routes, for every role. The API refuses what a role may not change.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route objects.
 */
export function reportRoutes(loadSession: SessionLoader, api: ApiClient): RouteObject[] {
  const screens = async () => import('../features/reports/screens.ts');
  const editor = requireRole(loadSession, 'editor');
  const change = changeReport(api);
  // Run now, activate and deactivate are for editors; the page shows others none of them.
  const action = async (args: Parameters<typeof change>[0]) => {
    await editor(args);
    return change(args);
  };
  const runScreen = { Component: async () => (await screens()).RunScreen };
  return [
    {
      id: reportsRouteId,
      path: '/reports',
      loader: guarded(loadSession, '/reports', loadReports(api)),
      lazy: { Component: async () => (await screens()).ReportsScreen },
    },
    // Counts the reports with an unopened run, for the rail; again after every action.
    { path: unseenPath, loader: guarded(loadSession, unseenPath, loadUnseen(api)) },
    // The report settings, for admins: the Settings dialog loads them when it opens and saves them.
    {
      path: reportSettingsPath,
      loader: guarded(loadSession, reportSettingsPath, loadReportSettings(api)),
      action: guarded(loadSession, reportSettingsPath, saveReportSettings(api)),
      shouldRevalidate: () => false,
    },
    {
      path: '/reports/:reportId',
      loader: guarded(loadSession, '/reports/:reportId', loadLatestRun(api)),
      action,
      lazy: runScreen,
    },
    {
      path: '/reports/:reportId/runs/:runId',
      loader: guarded(loadSession, '/reports/:reportId/runs/:runId', loadRun(api)),
      lazy: runScreen,
    },
    ...askRoutes(loadSession, api),
  ];
}
