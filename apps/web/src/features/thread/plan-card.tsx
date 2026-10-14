import {
  type AccessLevel,
  type DefinitionVersion,
  type Plan,
  type PlanView,
  queryLanguageNames,
} from '@quanthea/shared';
import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { CheckIcon } from '../../ui/icons.tsx';
import { Pill } from '../../ui/pill.tsx';
import styles from './cards.module.css';
import { ChangeList } from './change-list.tsx';
import { changeRows, type DraftPanel, isChangePlan } from './plan-changes.ts';
import { definitionMarkOf } from './plan-definitions.ts';

/** What each access level lets the model see, in the plan card's words. */
const accessWords: Readonly<Record<AccessLevel, string>> = {
  1: 'Schema only. No values leave the connectors.',
  2: 'Schema and label values. No rows leave the connectors.',
  3: 'Summaries of results. No rows leave the connectors.',
  4: 'Full access: result rows, capped at the row limit.',
};

/** Props of {@link PlanCard}. */
export interface PlanCardProps {
  /** The plan. */
  readonly plan: Plan;
  /** Its id. */
  readonly planId: string;
  /** Its status, as the thread knows it. */
  readonly status: PlanView['status'];
  /** The access level of each connector. */
  readonly levels: Readonly<Record<string, AccessLevel>>;
  /** The definitions there are, for the marks of the panels that follow one. */
  readonly definitions?: readonly DefinitionVersion[] | undefined;
  /** Whether a decision or a run is on its way. */
  readonly busy: boolean;
  /** Approves the plan. */
  readonly onApprove: (planId: string) => void;
  /** Rejects it and asks for changes in the composer. */
  readonly onEdit: (planId: string) => void;
  /** The draft's panels the plan changes, while it waits; absent before the first build. */
  readonly draftPanels?: readonly DraftPanel[] | undefined;
}

/**
 * The lowest access level among the plan's connectors.
 *
 * @param plan - The plan.
 * @param levels - The access level of each connector.
 * @returns The level, or `undefined` when none is known.
 */
function lowestLevel(plan: Plan, levels: PlanCardProps['levels']): AccessLevel | undefined {
  const known = plan.panels.flatMap((panel) =>
    levels[panel.connector] ? [levels[panel.connector] as AccessLevel] : [],
  );
  return known.length > 0 ? (Math.min(...known) as AccessLevel) : undefined;
}

/**
 * A first plan's panels: one row each, with its kind, the definition it follows, and its language.
 *
 * @param props - The plan and the definitions.
 * @param props.plan - The plan.
 * @param props.definitions - The definitions there are.
 * @returns The list.
 */
function PanelList({
  plan,
  definitions = [],
}: {
  readonly plan: Plan;
  readonly definitions?: readonly DefinitionVersion[] | undefined;
}) {
  return (
    <ul className={styles.planPanels}>
      {plan.panels.map((panel) => {
        const mark = definitionMarkOf(panel, definitions);
        return (
          <li key={`${panel.kind}:${panel.title}`}>
            <span className={styles.kind}>{panel.kind.toUpperCase()}</span>
            <span className={styles.panelTitle}>{panel.title}</span>
            {mark && <Pill tone={mark.tone}>{mark.text}</Pill>}
            <span className={styles.language} data-language={panel.language}>
              {queryLanguageNames[panel.language]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The body of a plan: variables, access, and its panels, or its changes to the draft.
 *
 * @param props - The plan and the access levels.
 * @returns The rows.
 */
function PlanBody({
  plan,
  levels,
  draftPanels,
  definitions,
}: Pick<PlanCardProps, 'plan' | 'levels' | 'draftPanels' | 'definitions'>) {
  const level = lowestLevel(plan, levels);
  return (
    <div className={styles.planBody}>
      <dl className={styles.planFacts}>
        {plan.variables.length > 0 && (
          <>
            <dt>Variables</dt>
            <dd className={styles.mono}>{plan.variables.join(' · ')}</dd>
          </>
        )}
        {level !== undefined && (
          <>
            <dt>Access</dt>
            <dd>{accessWords[level]}</dd>
          </>
        )}
      </dl>
      {isChangePlan(plan, draftPanels) ? (
        <ChangeList rows={changeRows(plan, draftPanels)} />
      ) : (
        <PanelList plan={plan} definitions={definitions} />
      )}
    </div>
  );
}

/**
 * A plan the agent proposed: approve it, edit it, or reply to change it. Once decided, it folds
 * into one line.
 *
 * @param props - The plan, its status, the access levels and the callbacks.
 * @returns The card.
 */
export function PlanCard(props: PlanCardProps) {
  const { plan, status } = props;
  const [open, setOpen] = useState(false);
  if (status !== 'pending') {
    return (
      <div className={styles.folded} data-status={status}>
        {status === 'approved' && <CheckIcon />}
        <span>
          Plan {status} · {plan.panels.length} panels
        </span>
        <button type="button" className={styles.link} onClick={() => setOpen(!open)}>
          {open ? 'Hide plan' : 'Show plan'}
        </button>
        {open && <PlanBody plan={plan} levels={props.levels} definitions={props.definitions} />}
      </div>
    );
  }
  return (
    <section className={styles.plan} aria-label="Plan">
      <header className={styles.planHead}>
        <span className={styles.planLabel}>Plan</span>
        <span className={styles.planTitle}>{plan.title}</span>
        <span className={styles.planCount}>{plan.panels.length} panels</span>
      </header>
      <PlanBody
        plan={plan}
        levels={props.levels}
        draftPanels={props.draftPanels}
        definitions={props.definitions}
      />
      <footer className={styles.planActions}>
        <Button
          variant="primary"
          disabled={props.busy}
          onClick={() => props.onApprove(props.planId)}
        >
          Approve &amp; build
        </Button>
        <Button disabled={props.busy} onClick={() => props.onEdit(props.planId)}>
          Edit plan
        </Button>
        <span className={styles.hint}>or reply to change it</span>
      </footer>
    </section>
  );
}
