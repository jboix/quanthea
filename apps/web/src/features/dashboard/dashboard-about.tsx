import { createFormatter, type DashboardSpec } from '@querent/shared';
import { Link } from 'react-router';
import { HistoryIcon, QuestionIcon } from '../../ui/icons.tsx';
import { Popover } from '../../ui/popover.tsx';
import styles from './dashboard.module.css';
import type { DashboardData } from './data.ts';

/**
 * How each connector is used: by how many panels, and whether for markers.
 *
 * @param spec - The spec.
 * @returns Pairs of connector name and usage, such as `5 panels` or `1 panel + markers`.
 */
function sourcesOf(spec: DashboardSpec): [string, string][] {
  const panels = new Map<string, number>();
  for (const panel of spec.panels) {
    for (const name of new Set(panel.queries.map((query) => query.connector))) {
      panels.set(name, (panels.get(name) ?? 0) + 1);
    }
  }
  const markers = new Set(spec.annotations.map((annotation) => annotation.query.connector));
  const names = [...new Set([...panels.keys(), ...markers])];
  return names.map((name) => {
    const count = panels.get(name) ?? 0;
    const used = count === 0 ? [] : [`${count} ${count === 1 ? 'panel' : 'panels'}`];
    return [name, [...used, ...(markers.has(name) ? ['markers'] : [])].join(' + ')];
  });
}

/**
 * The history: every version the role may see, the one shown highlighted.
 *
 * @param props - The dashboard and the version shown.
 * @returns The list.
 */
function History({ dashboard, version }: DashboardData) {
  const when = createFormatter({ $fmt: 'datetime' }, {});
  return (
    <ul className={styles.history}>
      {dashboard.versions.map((each) => {
        const what =
          each.pinnedAt === null
            ? (each.changeSummary ?? 'draft')
            : `pinned ${when(each.pinnedAt)}`;
        const label = `v${each.version} · ${what}`;
        const current = each.version === version.version;
        return (
          <li key={each.version} data-current={current}>
            {current ? (
              <strong aria-current="page">{label}</strong>
            ) : (
              <Link to={`/d/${dashboard.id}/v/${each.version}`}>{label}</Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What the dashboard is about, behind a question mark by its title: its description, tags and
 * sources.
 *
 * @param props - The dashboard and the version shown.
 * @returns The popover.
 */
export function AboutPopover({ dashboard, version }: DashboardData) {
  const { spec } = version;
  return (
    <Popover label="About this dashboard" trigger={<QuestionIcon />}>
      <div className={styles.popoverBody}>
        {spec.description ? (
          <p className={styles.about}>{spec.description}</p>
        ) : (
          <p className={styles.muted}>No description.</p>
        )}
        {dashboard.tags.length > 0 && (
          <p className={styles.tags}>{dashboard.tags.map((tag) => `#${tag}`).join(' ')}</p>
        )}
        <h2 className={styles.sideHeading}>Sources</h2>
        <dl className={styles.sources}>
          {sourcesOf(spec).map(([name, usage]) => (
            <div key={name} className={styles.source}>
              <dt>{name}</dt>
              <dd>{usage}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Popover>
  );
}

/**
 * The dashboard's versions, behind a History button in the header.
 *
 * @param props - The dashboard and the version shown.
 * @returns The popover.
 */
export function HistoryPopover(props: DashboardData) {
  return (
    <Popover
      label="History"
      shape="button"
      align="end"
      trigger={
        <>
          <HistoryIcon /> History
        </>
      }
    >
      <History {...props} />
    </Popover>
  );
}
