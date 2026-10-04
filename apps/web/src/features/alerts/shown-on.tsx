/**
 * Shown on, on the alert page: the dashboard panels the alert is linked to, each with its
 * dashboard and panel and a link to it, and for editors × to unlink, Link to a panel…, and the
 * pinned panels whose query matches the alert's, to link or dismiss.
 */
import { type AlertLinks, hasRole, type LinkSuggestion, type ShownOn } from '@quanthea/shared';
import { Link } from 'react-router';
import { Button } from '../../ui/button.tsx';
import styles from './alert.module.css';
import { LinkPicker } from './link-picker.tsx';
import local from './shown-on.module.css';
import { useAlertChange } from './use-alert-change.ts';
import { useRole } from './use-role.ts';

/**
 * The address of a panel on its dashboard.
 *
 * @param panel - The dashboard and the panel.
 * @param panel.dashboardId - The dashboard.
 * @param panel.panelId - The panel.
 * @returns The address, which scrolls to the panel.
 */
function panelPath(panel: { readonly dashboardId: string; readonly panelId: string }): string {
  return `/d/${panel.dashboardId}#panel-${encodeURIComponent(panel.panelId)}`;
}

/** Props of {@link ShownOnRow}. */
interface ShownOnRowProps {
  /** The link. */
  readonly link: ShownOn;
  /** Unlinks it, for editors. */
  readonly onUnlink: (() => void) | undefined;
}

/**
 * One panel the alert is shown on: the dashboard, the panel, and × for editors.
 *
 * @param props - The link and the unlink callback.
 * @returns The row.
 */
function ShownOnRow({ link, onUnlink }: ShownOnRowProps) {
  const panel = link.panelTitle ?? link.panelId;
  return (
    <li className={local.row}>
      <span className={local.where}>
        <Link to={`/d/${link.dashboardId}`}>{link.dashboardTitle}</Link>
        <span aria-hidden="true"> · </span>
        {link.panelTitle === null ? (
          <span className={local.missing}>{panel}: not on the shown version</span>
        ) : (
          <Link to={panelPath(link)}>{panel}</Link>
        )}
        {!link.pinned && <span className={local.missing}> (not pinned)</span>}
      </span>
      {onUnlink && (
        <button
          type="button"
          className={local.unlink}
          aria-label={`Unlink from ${panel} on ${link.dashboardTitle}`}
          title="Unlink"
          onClick={onUnlink}
        >
          ×
        </button>
      )}
    </li>
  );
}

/** Props of {@link SuggestionRow}. */
interface SuggestionRowProps {
  /** The panel whose query matches the alert's. */
  readonly suggestion: LinkSuggestion;
  /** Whether a change is on its way. */
  readonly busy: boolean;
  /** Links it. */
  readonly onLink: () => void;
  /** Dismisses it. */
  readonly onDismiss: () => void;
}

/**
 * A pinned panel whose query matches the alert's: Link or Dismiss.
 *
 * @param props - The panel, whether busy, and the callbacks.
 * @returns The row.
 */
function SuggestionRow({ suggestion, busy, onLink, onDismiss }: SuggestionRowProps) {
  return (
    <li className={local.suggestion}>
      <span className={local.where}>
        Also on <Link to={`/d/${suggestion.dashboardId}`}>{suggestion.dashboardTitle}</Link>
        <span aria-hidden="true"> · </span>
        <Link to={panelPath(suggestion)}>{suggestion.panelTitle}</Link>
      </span>
      <span className={local.actions}>
        <Button size="small" variant="primary" disabled={busy} onClick={onLink}>
          Link
        </Button>
        <Button size="small" disabled={busy} onClick={onDismiss}>
          Dismiss
        </Button>
      </span>
    </li>
  );
}

/** Picks the dashboard and panel of a link or a suggestion. */
const panelOf = (each: { readonly dashboardId: string; readonly panelId: string }) => ({
  dashboardId: each.dashboardId,
  panelId: each.panelId,
});

/**
 * The links, then for editors the suggestions.
 *
 * @param props - Where the alert is shown, and whether the person is an editor.
 * @param props.links - Where the alert is shown, and the suggestions.
 * @param props.editor - Whether the person may change links.
 * @returns The list.
 */
function ShownOnList({ links, editor }: { readonly links: AlertLinks; readonly editor: boolean }) {
  const { submit, busy } = useAlertChange();
  return (
    <ul className={local.list}>
      {links.links.map((link) => (
        <ShownOnRow
          key={`${link.dashboardId}/${link.panelId}`}
          link={link}
          onUnlink={editor ? () => submit({ intent: 'unlink', ...panelOf(link) }) : undefined}
        />
      ))}
      {links.suggestions.map((suggestion) => (
        <SuggestionRow
          key={`${suggestion.dashboardId}/${suggestion.panelId}`}
          suggestion={suggestion}
          busy={busy}
          onLink={() => submit({ intent: 'link', ...panelOf(suggestion), how: 'query_match' })}
          onDismiss={() => submit({ intent: 'dismissLink', ...panelOf(suggestion) })}
        />
      ))}
    </ul>
  );
}

/**
 * The Shown on card.
 *
 * @param props - Where the alert is shown, and the suggestions.
 * @param props.links - Where the alert is shown, and for editors the suggestions.
 * @returns The card.
 */
export function ShownOnCard({ links }: { readonly links: AlertLinks }) {
  const editor = hasRole(useRole(), 'editor');
  const { submit, busy } = useAlertChange();
  return (
    <section className={styles.card} aria-labelledby="alert-shown-on" data-busy={busy}>
      <div className={styles.cardHead}>
        <h2 id="alert-shown-on" className={styles.cardTitle}>
          Shown on
        </h2>
        {editor && (
          <LinkPicker
            links={links}
            busy={busy}
            onLink={(picked) => submit({ intent: 'link', ...picked, how: 'by_hand' })}
          />
        )}
      </div>
      {links.links.length === 0 && (
        <p className={styles.chartNote}>Not shown on any dashboard panel.</p>
      )}
      <ShownOnList links={links} editor={editor} />
    </section>
  );
}
