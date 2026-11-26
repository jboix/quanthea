/** The card of Settings → MCP access that lists what tokens did: the latest tool calls. */
import { dayMonthTime, type McpCallView } from '@quanthea/shared';
import { Card } from '../../ui/card.tsx';
import styles from './tokens.module.css';

/** How each outcome reads. */
const outcomeLabels: Readonly<Record<McpCallView['outcome'], string>> = {
  ok: 'answered',
  refused: 'refused',
  failed: 'failed',
};

/**
 * One tool call as a row.
 *
 * @param props - The call and the current time.
 * @param props.call - The call.
 * @param props.now - The current time.
 * @returns The row.
 */
function CallRow({ call, now }: { readonly call: McpCallView; readonly now: number }) {
  return (
    <tr>
      <td>{dayMonthTime(call.at, now)}</td>
      <td>{call.userName ?? 'A removed user'}</td>
      <td>{`${call.tokenName} (${call.role})`}</td>
      <td className={styles.mono}>{call.tool}</td>
      <td className={styles.arguments} title={call.arguments}>
        {call.arguments}
      </td>
      <td className={call.outcome === 'ok' ? undefined : styles.notOk}>
        {outcomeLabels[call.outcome]}
      </td>
      <td className={styles.mono}>{call.address}</td>
    </tr>
  );
}

/**
 * The latest tool calls on the MCP endpoint, the newest first.
 *
 * @param props - The calls.
 * @param props.calls - The calls.
 * @returns The card.
 */
export function ActivityCard({ calls }: { readonly calls: readonly McpCallView[] }) {
  const now = Date.now();
  return (
    <Card
      title="Activity"
      description="Every tool call an assistant made: who, with which token, what it asked for and where it came from. The latest 200, kept 90 days. A result is never kept."
    >
      {calls.length === 0 ? (
        <p className={styles.note}>No assistant has called a tool yet.</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Token</th>
                <th>Tool</th>
                <th>Arguments</th>
                <th>Outcome</th>
                <th>From</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => (
                <CallRow key={call.id} call={call} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
