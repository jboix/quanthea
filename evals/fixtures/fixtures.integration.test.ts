import { afterEach, describe, expect, test } from 'bun:test';
import { integrationEnabled } from '@quanthea/server/src/connectors/_shared/test/dev-sources.ts';
import { alertFromPanel, aroundTheIncident, incidentAnswered } from './fixtures.ts';
import { closeWorlds, world } from './test-world.ts';

afterEach(closeWorlds);

// These fixtures pin the incident dashboard, and pinning runs its panels on the dev data.
describe.skipIf(!integrationEnabled)('the fixtures that pin a dashboard, on the dev data', () => {
  test('the incident question, asked and answered, for a follow-up to carry as history', async () => {
    const made = await world();
    const given = await incidentAnswered.prepare(made);
    const { questions } = made.services;
    const time = { from: 'now-28h', to: 'now-16h' };
    const followUp = { dashboardId: given.dashboardId as string, version: 1, time };
    const shown = { timeZone: 'Europe/Zurich', variables: {}, hiddenMarkers: [] };
    const asked = {
      ...followUp,
      ...shown,
      question: 'How long?',
      parentId: given.parentQuestionId,
    };
    const prepared = questions.prepare(asked, 'evals');
    expect(prepared.history).toHaveLength(1);
    expect(prepared.history[0]?.question).toBe(aroundTheIncident);
    expect(prepared.history[0]?.answer).toContain('Deploy #481 of checkout-svc');
  });

  test('an alert thread started from a panel of the pinned dashboard, with nothing said', async () => {
    const made = await world();
    const given = await alertFromPanel('error-rate-by-service').prepare(made);
    const row = made.services.threads.row(given.threadId as string);
    expect(row.seed).toMatchObject({
      dashboardId: given.dashboardId,
      panelId: 'error-rate-by-service',
    });
    expect(made.services.threads.get(given.threadId as string).messages).toEqual([]);
  });
});
