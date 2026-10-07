/**
 * What the alert page's header offers each person: the sections of its actions, which fold into one
 * menu on a phone, and the item that starts or stops evaluation.
 */
import type { AlertDetail, Role } from '@quanthea/shared';
import type { AlertIntent } from './data.ts';
import { canMute } from './mute-options.ts';

/** A section of the header's actions. */
export type HeaderSection = 'Change' | 'Mute' | 'Versions';

/**
 * The sections of the header's actions a person sees: Change for whoever may change the alert
 * (the owner of its thread or an admin), Mute for analysts and above, Versions for everyone.
 *
 * @param role - The role.
 * @param canChange - Whether they may change the alert.
 * @returns The sections, in order.
 */
export function headerSections(role: Role, canChange: boolean): HeaderSection[] {
  return [
    ...(canChange ? (['Change'] as const) : []),
    ...(canMute(role) ? (['Mute'] as const) : []),
    'Versions',
  ];
}

/** The item that starts or stops evaluation. */
export interface EvaluationAction {
  /** Its label. */
  readonly label: string;
  /** What it does. */
  readonly hint: string;
  /** What it submits. */
  readonly intent: AlertIntent;
}

/**
 * The item that starts or stops evaluation: deactivate an active alert, activate a deactivated
 * one again, or activate a draft's latest version.
 *
 * @param alert - The alert.
 * @returns The item.
 */
export function evaluationAction(alert: AlertDetail): EvaluationAction {
  const version = alert.activeVersion ?? alert.latestVersion;
  if (version !== null && (alert.deactivated || alert.activeVersion === null))
    return {
      label: alert.deactivated ? 'Activate again' : `Activate v${version}`,
      hint: `Checks v${version}, runs its query once, then evaluates it.`,
      intent: { intent: 'activate', version },
    };
  return {
    label: 'Deactivate',
    hint: 'Stops evaluating it. Its series end, and a firing one sends resolved.',
    intent: { intent: 'deactivate' },
  };
}
