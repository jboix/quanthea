/**
 * The agent's way to suggest showing the alert on a dashboard panel. The server finds the pinned
 * panels whose query matches the draft's; the agent reads them in its instructions and may
 * propose one with `propose_link`, which streams a card. Only the person's click on the card
 * links them: the agent never links by itself.
 */
import type { LinkSuggestion } from '@quanthea/shared';
import { tool } from 'ai';
import { z } from 'zod';
import { currentAlert } from './alert-edit.ts';
import type { RunContext } from './run-context.ts';
import { providerSchema } from './tool-schema.ts';

/** The most matching panels the instructions name. */
const maxCandidates = 5;

/**
 * The pinned panels the draft's query matches, not linked or turned down yet.
 *
 * @param context - The run.
 * @returns The panels, and the draft's alert.
 */
function linkCandidates(context: RunContext): { alertId: string; panels: LinkSuggestion[] } {
  const draft = currentAlert(context);
  if (!draft || !context.panelLinks) return { alertId: '', panels: [] };
  return { alertId: draft.alertId, panels: context.panelLinks.candidates(draft.alertId) };
}

/**
 * The lines of the instructions that name the matching panels, if any.
 *
 * @param context - The run.
 * @returns The lines.
 */
export function linkLines(context: RunContext): string[] {
  const { panels } = linkCandidates(context);
  if (panels.length === 0) return [];
  const listed = panels
    .slice(0, maxCandidates)
    .map(
      (panel) =>
        `- dashboardId ${panel.dashboardId}, panelId ${panel.panelId}: "${panel.panelTitle}" on "${panel.dashboardTitle}"`,
    );
  return [
    `This alert's query is the same as these panels' on pinned dashboards:\n${listed.join('\n')}\nOnce, when it helps, offer to show the alert on one of them with propose_link: the card asks the person, and only their click links it. Never say it is linked.`,
  ];
}

/**
 * The tool that proposes showing the alert on a matching panel.
 *
 * @param context - The run.
 * @returns The tool.
 */
export function proposeLinkTool(context: RunContext) {
  return tool({
    description:
      'Offer to show the alert on a pinned dashboard panel that watches the same query, from the list in your instructions. It shows the person a card with Link and Not now; nothing is linked until they click Link.',
    inputSchema: providerSchema(
      z.strictObject({
        dashboardId: z.string().min(1).max(64),
        panelId: z.string().min(1).max(64),
      }),
    ),
    execute: ({ dashboardId, panelId }) => {
      const { alertId, panels } = linkCandidates(context);
      const panel = panels.find(
        (each) => each.dashboardId === dashboardId && each.panelId === panelId,
      );
      if (!panel)
        return {
          ok: false,
          error:
            'That panel is not in the list: it does not match, or it was linked or turned down.',
        };
      const { dashboardTitle, panelTitle } = panel;
      const data = { alertId, dashboardId, panelId, dashboardTitle, panelTitle };
      context.writer.write({ type: 'data-linkProposal', data });
      return { ok: true, next: 'The person decides on the card. Do not say it is linked.' };
    },
  });
}
