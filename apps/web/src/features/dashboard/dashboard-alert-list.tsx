/**
 * Alerts on this dashboard, in its About: each alert linked to one of its panels, with its state
 * and a link to it. It reads the alerts the panels loaded.
 */
import { Link } from 'react-router';
import { Pill } from '../../ui/pill.tsx';
import { useDashboardAlertsData } from './alerts-data.ts';
import dashboard from './dashboard.module.css';
import styles from './panel-alerts.module.css';
import { linkedAlertsOf, listedState } from './panel-alerts.ts';

/**
 * The alerts linked to the dashboard's panels, each with its state. Nothing shows before they load
 * or when there are none.
 *
 * @param props - The dashboard.
 * @param props.dashboardId - The dashboard.
 * @returns The list, or nothing.
 */
export function DashboardAlertList({ dashboardId }: { readonly dashboardId: string }) {
  const alerts = linkedAlertsOf(useDashboardAlertsData(dashboardId));
  if (alerts.length === 0) return null;
  return (
    <>
      <h2 className={dashboard.sideHeading}>Alerts on this dashboard</h2>
      <ul className={styles.list}>
        {alerts.map((alert) => {
          const { words, tone } = listedState(alert);
          return (
            <li key={alert.id} className={styles.listItem}>
              <Link to={`/alerts/${alert.id}`}>{alert.title}</Link>
              <Pill tone={tone}>{words}</Pill>
            </li>
          );
        })}
      </ul>
    </>
  );
}
