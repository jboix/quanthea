import type { Panel } from '@querent/shared';
import { InfoIcon } from '../../ui/icons.tsx';
import { Popover } from '../../ui/popover.tsx';
import styles from './panels.module.css';

/**
 * How a panel draws, in words: its chart recipe and variants, or querent's own number or table.
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

/**
 * Where a panel's data comes from, behind an i by its title: each query with its connector and
 * language, and how it draws.
 *
 * @param props - The panel.
 * @param props.panel - The panel.
 * @returns The popover.
 */
export function PanelInfo({ panel }: { readonly panel: Panel }) {
  return (
    <Popover label={`Where ${panel.title} comes from`} trigger={<InfoIcon />} align="end">
      <div className={styles.info}>
        {panel.description && <p className={styles.infoText}>{panel.description}</p>}
        {panel.queries.map((query) => (
          <div key={query.refId} className={styles.infoQuery}>
            <span className={styles.infoSource}>
              {query.connector} · {query.language === 'sql' ? 'SQL' : 'PromQL'}
              {query.language === 'promql' && query.instant ? ' · instant' : ''}
            </span>
            <pre className={styles.infoCode}>
              {query.language === 'sql' ? query.sql : query.expr}
            </pre>
          </div>
        ))}
        <span className={styles.infoSource}>Drawn as {drawnAs(panel)}</span>
      </div>
    </Popover>
  );
}
