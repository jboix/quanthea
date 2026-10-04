/**
 * Link to a panel…, on the alert page for editors: pick a pinned dashboard, then one of its
 * panels. The dashboards and their panels load when the picker opens.
 */
import type { AlertLinks, LinkTarget } from '@quanthea/shared';
import { useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Popover } from '../../ui/popover.tsx';
import { Select } from '../../ui/select.tsx';
import type { LinkLoad } from './link-data.ts';
import styles from './shown-on.module.css';

/** The resource route of the pinned dashboards' panels. */
export const linkTargetsPath = '/alert-link-targets';

/** A panel to link. */
export interface PickedPanel {
  /** The dashboard. */
  readonly dashboardId: string;
  /** The panel. */
  readonly panelId: string;
}

/** Props of {@link LinkPicker}. */
interface LinkPickerProps {
  /** Where the alert is shown already, so those panels are left out. */
  readonly links: AlertLinks;
  /** Links the panel picked. */
  readonly onLink: (panel: PickedPanel) => void;
  /** Whether a change is on its way. */
  readonly busy: boolean;
}

/**
 * The panels of a dashboard not linked yet.
 *
 * @param target - The dashboard.
 * @param links - Where the alert is shown already.
 * @returns The panels as options.
 */
function panelOptions(target: LinkTarget | undefined, links: AlertLinks) {
  if (!target) return [];
  const linked = new Set(
    links.links
      .filter((link) => link.dashboardId === target.dashboardId)
      .map((link) => link.panelId),
  );
  return target.panels
    .filter((panel) => !linked.has(panel.id))
    .map((panel) => ({ value: panel.id, label: panel.title }));
}

/**
 * The pinned dashboards and their panels, loaded once the picker opens.
 *
 * @returns The load's outcome, once it ends.
 */
function useTargets(): LinkLoad<LinkTarget[]> | undefined {
  const fetcher = useFetcher<LinkLoad<LinkTarget[]>>();
  const { load } = fetcher;
  useEffect(() => void load(linkTargetsPath), [load]);
  return fetcher.data;
}

/**
 * The dashboard and the panel picked: the first of each until the person picks.
 *
 * @param targets - The pinned dashboards.
 * @param links - Where the alert is shown already.
 * @returns The dashboard, its panels not linked yet, the panel, and the setters.
 */
function usePick(targets: readonly LinkTarget[], links: AlertLinks) {
  const [dashboardId, setDashboardId] = useState('');
  const [panelId, setPanelId] = useState('');
  const target = targets.find((each) => each.dashboardId === dashboardId) ?? targets[0];
  const panels = panelOptions(target, links);
  const panel = panels.find((each) => each.value === panelId) ?? panels[0];
  return { target, panels, panel, setDashboardId, setPanelId };
}

/**
 * The form inside the picker: the dashboard, the panel, and Link.
 *
 * @param props - What is linked, the callback and whether busy, and the close callback.
 * @param props.close - Closes the picker.
 * @returns The form.
 */
function PickerForm({ links, onLink, busy, close }: LinkPickerProps & { close: () => void }) {
  const loaded = useTargets();
  const targets = loaded?.ok ? loaded.value : [];
  const { target, panels, panel, setDashboardId, setPanelId } = usePick(targets, links);
  if (loaded?.ok === false) return <p className={styles.error}>{loaded.message}</p>;
  if (!loaded) return <p className={styles.note}>Loading the dashboards…</p>;
  if (!target) return <p className={styles.note}>No dashboard is pinned yet.</p>;
  const link = () => {
    if (panel) onLink({ dashboardId: target.dashboardId, panelId: panel.value });
    close();
  };
  const dashboards = targets.map((each) => ({ value: each.dashboardId, label: each.title }));
  return (
    <div className={styles.picker}>
      <Select
        label="Pinned dashboard"
        options={dashboards}
        value={target.dashboardId}
        onChange={(event) => setDashboardId(event.target.value)}
      />
      <PanelField panels={panels} value={panel?.value} onPick={setPanelId} />
      <Button variant="primary" disabled={busy || !panel} onClick={link}>
        Link
      </Button>
    </div>
  );
}

/**
 * The panel to link, or why there is none.
 *
 * @param props - The panels, the one picked and the pick callback.
 * @param props.panels - The panels not linked yet, as options.
 * @param props.value - The panel picked.
 * @param props.onPick - Picks a panel.
 * @returns The field.
 */
function PanelField({
  panels,
  value,
  onPick,
}: {
  readonly panels: readonly { readonly value: string; readonly label: string }[];
  readonly value: string | undefined;
  readonly onPick: (panelId: string) => void;
}) {
  if (panels.length === 0)
    return <p className={styles.note}>Every panel of this dashboard shows the alert already.</p>;
  return (
    <Select
      label="Panel"
      options={panels}
      value={value}
      onChange={(event) => onPick(event.target.value)}
    />
  );
}

/**
 * Link to a panel…: a button that opens the picker.
 *
 * @param props - What is linked, the link callback and whether busy.
 * @returns The picker.
 */
export function LinkPicker(props: LinkPickerProps) {
  return (
    <Popover label="Link to a panel…" trigger="Link to a panel…" shape="button" align="end">
      {(close) => <PickerForm {...props} close={close} />}
    </Popover>
  );
}
