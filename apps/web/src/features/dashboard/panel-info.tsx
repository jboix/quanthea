import { type Panel, queryLanguageNames, queryText } from '@quanthea/shared';
import { InfoIcon } from '../../ui/icons.tsx';
import { Popover } from '../../ui/popover.tsx';
import { type ExplainPlace, PanelExplain } from './panel-explain.tsx';
import styles from './panels.module.css';

/**
 * How a panel draws, in words: its chart recipe and variants, or quanthea's own number or table.
 *
 * @param panel - The panel.
 * @returns Such as `trend.line · stacked`, or `number`.
 */
function drawnAs(panel: Panel): string {
  const { view } = panel;
  if (view.kind === 'stat') return 'number';
  if (view.kind === 'table') return 'table';
  if (!view.recipe) return 'chart';
  return [view.recipe.id, ...view.recipe.variants].join(' · ');
}

/** Props of {@link PanelInfo}. */
interface PanelInfoProps {
  /** The panel. */
  readonly panel: Panel;
  /** Where its explanation is kept, on a pinned version; left out elsewhere. */
  readonly explain?: ExplainPlace | undefined;
}

/**
 * The info bubble by a panel's title. On a pinned version it opens on the panel's explanation;
 * below, or alone elsewhere, where its data comes from: each query with its connector and
 * language, and how it draws.
 *
 * @param props - The panel, and where its explanation is kept.
 * @returns The popover.
 */
export function PanelInfo({ panel, explain }: PanelInfoProps) {
  const label = explain ? `Explain ${panel.title}` : `Where ${panel.title} comes from`;
  return (
    <Popover label={label} trigger={<InfoIcon />} align="end">
      <div className={styles.info}>
        {explain && (
          <PanelExplain
            target={{
              dashboardId: explain.dashboardId,
              version: explain.version,
              panelId: panel.id,
            }}
            timeZone={explain.timeZone}
          />
        )}
        {explain && <span className={styles.infoHeading}>Where it comes from</span>}
        {panel.description && <p className={styles.infoText}>{panel.description}</p>}
        {panel.queries.map((query) => (
          <div key={query.refId} className={styles.infoQuery}>
            <span className={styles.infoSource}>
              {query.connector} · {queryLanguageNames[query.language]}
              {'instant' in query && query.instant ? ' · instant' : ''}
            </span>
            <pre className={styles.infoCode}>{queryText(query)}</pre>
          </div>
        ))}
        <span className={styles.infoSource}>Drawn as {drawnAs(panel)}</span>
      </div>
    </Popover>
  );
}
