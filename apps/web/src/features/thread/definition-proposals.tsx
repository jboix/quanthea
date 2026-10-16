/**
 * The definitions the agent proposes, as a card: each with its meaning and its checked filters in
 * words, and Save, or Save all. Nothing is saved until the person saves. The card reads the
 * definitions there are, so it says which are saved after a reload too.
 */
import type { DefinitionVersion, ThreadData } from '@quanthea/shared';
import { useEffect } from 'react';
import { Link, type SubmitTarget, useFetcher, useLocation } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { CheckIcon } from '../../ui/icons.tsx';
import { Pill } from '../../ui/pill.tsx';
import {
  bodyPlace,
  bodyWords,
  type DefinitionsData,
  type DefinitionsIntent,
  type DefinitionsOutcome,
} from '../definitions/index.ts';
import styles from './definition-proposals.module.css';

/** One proposed definition. */
type Proposal = ThreadData['definitionProposals']['proposals'][number];

/** Where a proposal stands against the definitions there are. */
type Standing =
  | { readonly kind: 'saved'; readonly version: number }
  | { readonly kind: 'new' }
  | { readonly kind: 'change'; readonly version: number };

/**
 * A value as JSON with its keys sorted, so two equal definitions read the same.
 *
 * @param value - The value.
 * @returns The JSON.
 */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

/**
 * Where a proposal stands: saved as it is, new, or a change of a definition there is.
 *
 * @param proposal - The proposal.
 * @param current - The definitions there are, once loaded.
 * @returns Its standing.
 */
export function standingOf(proposal: Proposal, current: readonly DefinitionVersion[]): Standing {
  const now = current.find((each) => each.definition.id === proposal.definition.id);
  if (!now) return { kind: 'new' };
  if (stableJson(now.definition) === stableJson(proposal.definition))
    return { kind: 'saved', version: now.version };
  return { kind: 'change', version: now.version };
}

/**
 * The definitions there are, loaded when the card shows and again after each save.
 *
 * @returns The definitions, once loaded.
 */
function useCurrentDefinitions(): readonly DefinitionVersion[] | undefined {
  const fetcher = useFetcher<DefinitionsData>({ key: 'definitions-for-proposals' });
  const { load } = fetcher;
  useEffect(() => void load('/definitions'), [load]);
  return fetcher.data?.definitions;
}

/**
 * Saves proposals through the definitions screen's action.
 *
 * @returns The save function, whether a save is on its way, and why each refused one was.
 */
function useSaveProposals() {
  const fetcher = useFetcher<DefinitionsOutcome>();
  const save = (items: readonly { proposal: Proposal; standing: Standing }[]) => {
    const intent: DefinitionsIntent = {
      intent: 'saveMany',
      items: items.map(({ proposal, standing }) => ({
        definition: proposal.definition,
        basedOn: standing.kind === 'change' ? standing.version : null,
      })),
    };
    void fetcher.submit(intent as unknown as SubmitTarget, {
      method: 'post',
      encType: 'application/json',
      action: '/definitions',
    });
  };
  const outcome = fetcher.data;
  const refused = new Map(
    outcome?.ok && 'saved' in outcome
      ? outcome.saved.flatMap((each) => (each.refused ? [[each.id, each.refused] as const] : []))
      : [],
  );
  return { save, busy: fetcher.state !== 'idle', refused };
}

/**
 * The pill that says where a proposal stands.
 *
 * @param props - The standing.
 * @param props.standing - Where the proposal stands.
 * @returns The pill.
 */
function StandingPill({ standing }: { readonly standing: Standing }) {
  if (standing.kind === 'saved')
    return (
      <Pill tone="ok" mono>
        saved · v{standing.version}
      </Pill>
    );
  if (standing.kind === 'change') return <Pill mono>changes v{standing.version}</Pill>;
  return (
    <Pill tone="draft" mono>
      new
    </Pill>
  );
}

/**
 * A proposal's checked filters in words, each with how its test run went.
 *
 * @param props - The proposal.
 * @param props.proposal - The proposal.
 * @returns The list, or a line saying it has the meaning only.
 */
function ProposalBodies({ proposal }: { readonly proposal: Proposal }) {
  const { bodies } = proposal.definition;
  if (bodies.length === 0)
    return <p className={styles.note}>Meaning only: dashboards follow it in words.</p>;
  return (
    <ul className={styles.bodies}>
      {bodies.map((body, index) => {
        const test = proposal.tests[index];
        return (
          <li key={bodyPlace(body)}>
            <span className={styles.place}>{bodyPlace(body)}</span>
            <span>{bodyWords(body)}</span>
            {test && (
              <span className={styles.note}>
                Checked on {test.connector}: {test.rows.toLocaleString()}{' '}
                {test.rows === 1 ? 'row' : 'rows'} over the last day.
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Props of {@link ProposalRow}. */
interface ProposalRowProps {
  readonly proposal: Proposal;
  readonly standing: Standing | undefined;
  readonly refused: string | undefined;
  readonly busy: boolean;
  readonly onSave: () => void;
}

/**
 * One proposal: its name and standing, meaning, synonyms, filters, and Save.
 *
 * @param props - The proposal, where it stands, why it was refused, and the save callback.
 * @returns The row.
 */
function ProposalRow({ proposal, standing, refused, busy, onSave }: ProposalRowProps) {
  const { name, meaning, synonyms } = proposal.definition;
  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <strong className={styles.name}>{name}</strong>
        {standing && <StandingPill standing={standing} />}
        {standing && standing.kind !== 'saved' && (
          <Button size="small" className={styles.save} disabled={busy} onClick={onSave}>
            Save
          </Button>
        )}
      </div>
      <p className={styles.meaning}>{meaning}</p>
      {synonyms.length > 0 && <p className={styles.note}>Also: {synonyms.join(', ')}</p>}
      <ProposalBodies proposal={proposal} />
      {refused && (
        <p className={styles.refused} role="alert">
          {refused}
        </p>
      )}
    </li>
  );
}

/**
 * Each proposal with where it stands, and those not saved yet.
 *
 * @param data - The proposals.
 * @param current - The definitions there are, once loaded.
 * @returns The rows, and the unsaved ones with their standing.
 */
function rowsOf(
  data: ThreadData['definitionProposals'],
  current: readonly DefinitionVersion[] | undefined,
) {
  const rows = data.proposals.map((proposal) => ({
    proposal,
    standing: current ? standingOf(proposal, current) : undefined,
  }));
  const unsaved = rows.flatMap((row) =>
    row.standing && row.standing.kind !== 'saved' ? [{ ...row, standing: row.standing }] : [],
  );
  return { rows, unsaved };
}

/**
 * The card's head: how many are proposed, or that all are saved, and Save all.
 *
 * @param props - The count, whether all are saved, and the unsaved ones with the save callback.
 * @param props.count - How many are proposed.
 * @param props.allSaved - Whether every one is saved.
 * @param props.unsaved - How many are not saved yet.
 * @param props.busy - Whether a save is on its way.
 * @param props.onSaveAll - Saves the unsaved ones.
 * @returns The head.
 */
function CardHead(props: {
  readonly count: number;
  readonly allSaved: boolean;
  readonly unsaved: number;
  readonly busy: boolean;
  readonly onSaveAll: () => void;
}) {
  return (
    <header className={styles.head}>
      <span className={styles.title}>
        {props.allSaved && <CheckIcon />}
        {props.allSaved ? 'Definitions saved' : `Proposed definitions · ${props.count}`}
      </span>
      {props.unsaved > 1 && (
        <Button size="small" variant="primary" disabled={props.busy} onClick={props.onSaveAll}>
          Save all {props.unsaved}
        </Button>
      )}
    </header>
  );
}

/**
 * The card of definitions the agent proposes.
 *
 * @param props - The proposals.
 * @param props.data - The part's data.
 * @returns The card.
 */
export function DefinitionProposalsCard({
  data,
}: {
  readonly data: ThreadData['definitionProposals'];
}) {
  const current = useCurrentDefinitions();
  const { save, busy, refused } = useSaveProposals();
  const onDefinitions = useLocation().pathname.startsWith('/definitions');
  const { rows, unsaved } = rowsOf(data, current);
  return (
    <section className={styles.card} aria-label="Proposed definitions">
      <CardHead
        count={data.proposals.length}
        allSaved={current !== undefined && unsaved.length === 0}
        unsaved={unsaved.length}
        busy={busy}
        onSaveAll={() => save(unsaved)}
      />
      <ul className={styles.rows}>
        {rows.map((row) => (
          <ProposalRow
            key={row.proposal.definition.id}
            proposal={row.proposal}
            standing={row.standing}
            refused={refused.get(row.proposal.definition.id)}
            busy={busy}
            onSave={() =>
              row.standing && save([{ proposal: row.proposal, standing: row.standing }])
            }
          />
        ))}
      </ul>
      {!onDefinitions && (
        <Link className={styles.more} to="/definitions">
          Open the definitions
        </Link>
      )}
    </section>
  );
}
