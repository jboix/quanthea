import { type DashboardDetail, type DashboardSpec, type Panel, queryText } from '@querent/shared';
import { useState } from 'react';
import { Tabs } from '../../ui/tabs.tsx';
import { usePanelRunData, versionNote } from '../dashboard/index.ts';
import styles from './inspector.module.css';
import { shapeOf } from './messages.ts';

/** The inspector's tabs. */
const tabs = [
  { id: 'query', label: 'Query' },
  { id: 'spec', label: 'Chart spec' },
  { id: 'history', label: 'History' },
];

/** Props of {@link Inspector}. */
interface InspectorProps {
  /** The dashboard. */
  readonly dashboard: DashboardDetail;
  /** The version shown. */
  readonly version: number;
  /** Its spec. */
  readonly spec: DashboardSpec;
  /** The panel inspected. */
  readonly panel: Panel;
  /** Shows a version in the pane. */
  readonly onShowVersion: (version: number) => void;
  /** Closes the inspector. */
  readonly onClose: () => void;
}

/**
 * The name of a panel's format, for the facts column.
 *
 * @param panel - The panel.
 * @returns Such as `percent`, or a dash.
 */
function formatName(panel: Panel): string {
  const { view } = panel;
  if (view.kind === 'stat') return typeof view.format === 'string' ? view.format : view.format.$fmt;
  const text = JSON.stringify(view);
  return /"\$fmt":"(\w+)"/.exec(text)?.[1] ?? 'none';
}

/**
 * The query tab: each query with its connector, and what its last run showed.
 *
 * @param props - The panel and where its run comes from.
 * @returns The tab.
 */
function QueryTab({
  dashboard,
  version,
  panel,
}: Pick<InspectorProps, 'dashboard' | 'version' | 'panel'>) {
  const run = usePanelRunData(dashboard.id, version, panel.id);
  const frames = run?.ok
    ? run.value.queries.flatMap((query) =>
        query.frames.map((frame) => ({ rowCount: frame.meta.rowCount })),
      )
    : [];
  const facts = [
    ['Formatter', formatName(panel)],
    ['Last run', run?.ok ? `${run.value.durationMs} ms` : 'none'],
    ['Shape', run?.ok ? shapeOf(frames) : 'none'],
    [
      'Markers',
      run?.ok
        ? String(run.value.markers.reduce((sum, marker) => sum + marker.points.length, 0))
        : 'none',
    ],
  ];
  return (
    <div className={styles.queryTab}>
      <div className={styles.queries}>
        {panel.queries.map((query) => (
          <pre key={query.refId} className={styles.code}>
            {queryText(query)}
          </pre>
        ))}
      </div>
      <dl className={styles.facts}>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The history tab: every version, the one shown marked.
 *
 * @param props - The dashboard, the version shown and the show callback.
 * @returns The tab.
 */
function HistoryTab({
  dashboard,
  version,
  onShowVersion,
}: Pick<InspectorProps, 'dashboard' | 'version' | 'onShowVersion'>) {
  return (
    <ol className={styles.history}>
      {dashboard.versions.map((each) => (
        <li key={each.version} data-current={each.version === version}>
          <button
            type="button"
            className={styles.versionButton}
            onClick={() => onShowVersion(each.version)}
          >
            v{each.version} · {versionNote(each, dashboard.pinnedVersion)}
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * The inspector under the draft: the selected panel's query, its chart spec, and the history.
 *
 * @param props - The dashboard, the version, the panel and the callbacks.
 * @returns The drawer.
 */
export function Inspector(props: InspectorProps) {
  const [tab, setTab] = useState('query');
  const { panel } = props;
  const connectors = [...new Set(panel.queries.map((query) => query.connector))].join(', ');
  return (
    <section className={styles.drawer} aria-label="Inspector">
      <header className={styles.head}>
        <Tabs label="Inspector" tabs={tabs} selected={tab} onSelect={setTab} />
        <span className={styles.subject}>
          {panel.title} · {connectors}
        </span>
        <button
          type="button"
          className={styles.close}
          aria-label="Close the inspector"
          onClick={props.onClose}
        >
          ×
        </button>
      </header>
      <div role="tabpanel" className={styles.body}>
        {tab === 'query' && <QueryTab {...props} />}
        {tab === 'spec' && <pre className={styles.code}>{JSON.stringify(panel.view, null, 2)}</pre>}
        {tab === 'history' && <HistoryTab {...props} />}
      </div>
    </section>
  );
}
