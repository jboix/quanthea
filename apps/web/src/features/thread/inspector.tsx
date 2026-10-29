import {
  type DashboardDetail,
  type DashboardSpec,
  type DefinitionBody,
  type DefinitionVersion,
  type Panel,
  queryText,
} from '@quanthea/shared';
import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Tabs } from '../../ui/tabs.tsx';
import { usePanelRunData, versionNote } from '../dashboard/index.ts';
import styles from './inspector.module.css';
import { shapeOf } from './messages.ts';
import { PanelForm } from './panel-form.tsx';
import { PanelJson } from './panel-json.tsx';
import { SaveDefinition } from './save-definition.tsx';
import { type PanelEditState, usePanelEdit } from './use-panel-edit.ts';

/** The inspector's tabs. */
const tabs = [
  { id: 'query', label: 'Query' },
  { id: 'spec', label: 'Chart spec' },
  { id: 'history', label: 'History' },
];

/** The tabs of a panel that can be edited by hand. */
const editTabs = [
  { id: 'edit', label: 'Edit' },
  { id: 'json', label: 'JSON' },
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
  /** Puts the panel's mention in the composer, so the next turn is about it. */
  readonly onAsk?: (() => void) | undefined;
  /**
   * The panel's filters as a definition's body, and the definitions, when they can be saved; else
   * why not, which the disabled button says.
   */
  readonly savable?:
    | { readonly body: DefinitionBody; readonly definitions: readonly DefinitionVersion[] }
    | { readonly reason: string }
    | undefined;
  /**
   * Where a hand edit goes, when the person may edit the panel: the owner of the thread or an
   * admin, on the latest version. Key the inspector by the panel and the version.
   */
  readonly editing?: { readonly threadId: string; readonly basedOn: number } | undefined;
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
 * The buttons of the inspector's header: save the panel's filters as a definition, and ask about
 * the panel.
 *
 * @param props - The inspector's props.
 * @returns The buttons.
 */
function HeadActions(props: InspectorProps) {
  const { savable, onAsk } = props;
  return (
    <>
      {savable && 'reason' in savable && (
        <Button size="small" disabled title={savable.reason}>
          Save as definition
        </Button>
      )}
      {savable && 'body' in savable && (
        <SaveDefinition body={savable.body} definitions={savable.definitions} />
      )}
      {onAsk && (
        <Button size="small" onClick={onAsk}>
          Ask about this panel
        </Button>
      )}
    </>
  );
}

/**
 * The tab shown. The edit tabs share one edit, so a change in the form shows in the JSON.
 *
 * @param props - The tab, the inspector's props and the edit.
 * @param props.tab - The tab.
 * @param props.inspector - The inspector's props.
 * @param props.edit - The hand edit.
 * @returns The tab's content.
 */
function TabBody({
  tab,
  inspector,
  edit,
}: {
  readonly tab: string;
  readonly inspector: InspectorProps;
  readonly edit: PanelEditState;
}) {
  if (tab === 'query') return <QueryTab {...inspector} />;
  if (tab === 'history') return <HistoryTab {...inspector} />;
  if (inspector.editing && tab === 'edit') return <PanelForm edit={edit} />;
  if (inspector.editing && tab === 'json') return <PanelJson edit={edit} />;
  return <pre className={styles.code}>{JSON.stringify(inspector.panel.view, null, 2)}</pre>;
}

/**
 * The inspector under the draft: the selected panel's query, its chart spec, and the history; and
 * for the person who may edit it, a form for the common changes and the panel's JSON.
 *
 * @param props - The dashboard, the version, the panel and the callbacks.
 * @returns The drawer.
 */
export function Inspector(props: InspectorProps) {
  const [tab, setTab] = useState('query');
  const { panel, editing } = props;
  const edit = usePanelEdit({ threadId: '', basedOn: 0, ...editing, panel });
  const connectors = [...new Set(panel.queries.map((query) => query.connector))].join(', ');
  return (
    <section className={styles.drawer} aria-label="Inspector">
      <header className={styles.head}>
        <Tabs
          label="Inspector"
          tabs={editing ? [...tabs, ...editTabs] : tabs}
          selected={tab}
          onSelect={setTab}
        />
        <span className={styles.subject}>
          {panel.title} · {connectors}
        </span>
        <HeadActions {...props} />
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
        <TabBody tab={tab} inspector={props} edit={edit} />
      </div>
    </section>
  );
}
