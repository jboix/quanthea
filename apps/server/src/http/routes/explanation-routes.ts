/**
 * The endpoints of panel explanations. Every role reads a panel's latest explanation; analysts
 * and above ask for one, or a new one, which streams and is stored when it holds. The request to
 * the answering service carries the spec and the panel only: no range, no variables, no data.
 */
import { explainPanelEndpoint, getPanelExplanationEndpoint } from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Answers, ExplainRequest } from '../../agent/answer-types.ts';
import type { Users } from '../../auth/users.ts';
import type { Explanations, PreparedExplanation } from '../../dashboards/explanations.ts';
import type { ThreadOwner } from '../../threads/bin.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint, mountStreamEndpoint } from '../endpoint.ts';
import { ownerNames, roleForDashboard } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the explanation endpoints need. */
export interface ExplanationRouteServices {
  /** The explanations. */
  readonly explanations: Explanations;
  /** The answering service. */
  readonly answers: Pick<Answers, 'stream'>;
  /** The users, for the names of who asked. */
  readonly users: Pick<Users, 'nameOf'>;
  /** The thread a dashboard belongs to, in the bin or not. */
  readonly ownerOf: (dashboardId: string) => ThreadOwner | null;
}

/**
 * The panel a request names.
 *
 * @param params - The path parameters.
 * @param params.dashboardId - The dashboard.
 * @param params.version - The version, as digits.
 * @param params.panelId - The panel.
 * @returns The panel of a version.
 */
function panelOf(params: { dashboardId: string; version: string; panelId: string }) {
  return {
    dashboardId: params.dashboardId,
    version: Number(params.version),
    panelId: params.panelId,
  };
}

/**
 * The answering service's request for an explanation: the spec and the panel, nothing else.
 *
 * @param prepared - The explanation.
 * @param signal - Aborted when the person leaves.
 * @returns The request.
 */
function explainRequestOf(prepared: PreparedExplanation, signal: AbortSignal): ExplainRequest {
  const { dashboardId, spec, panelId, explainedBy: actor } = prepared;
  return { mode: 'explain', dashboardId, spec, panelId, actor, signal };
}

/**
 * Mounts the endpoint that asks for an explanation: it claims the panel, streams the explanation,
 * then stores it when it holds. A refusal before the stream releases the claim.
 *
 * @param app - The app.
 * @param services - The explanations and the answering service.
 */
function mountExplainEndpoint(app: Hono<AppEnv>, services: ExplanationRouteServices): void {
  const { explanations, answers } = services;
  mountStreamEndpoint(app, explainPanelEndpoint, {
    access: 'analyst',
    handle: async ({ params, body, principal, signal }) => {
      const prepared = explanations.prepare(panelOf(params), body.replaces, actorOf(principal));
      try {
        return await answers.stream(explainRequestOf(prepared, signal), (outcome) =>
          explanations.record(prepared, outcome),
        );
      } catch (error) {
        explanations.release(prepared);
        throw error;
      }
    },
  });
}

/**
 * Mounts every explanation endpoint.
 *
 * @param app - The app.
 * @param services - The explanations, the answering service, the users and a dashboard's owner.
 */
export function mountExplanationEndpoints(
  app: Hono<AppEnv>,
  services: ExplanationRouteServices,
): void {
  const { explanations } = services;
  const nameOf = ownerNames(services.users);
  mountExplainEndpoint(app, services);
  mountEndpoint(app, getPanelExplanationEndpoint, {
    access: 'viewer',
    handle: async ({ params, principal }) => {
      const role = roleForDashboard(signedIn(principal), services.ownerOf(params.dashboardId));
      const { explanation, generating } = explanations.latest(panelOf(params), role);
      if (!explanation) return { explanation, generating };
      const { explainerId, ...rest } = explanation;
      return { explanation: { ...rest, explainedBy: await nameOf(explainerId) }, generating };
    },
  });
}
