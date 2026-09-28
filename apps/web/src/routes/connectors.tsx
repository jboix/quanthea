import { useParams } from 'react-router';
import { Button } from '../ui/button.tsx';
import { Page } from '../ui/page.tsx';
import { Pill } from '../ui/pill.tsx';
import { Placeholder } from '../ui/placeholder.tsx';

/**
 * The Connectors screen: the list, and the selected connector's access level and guardrails.
 *
 * @returns The screen.
 */
export function ConnectorsRoute() {
  const { connectorId } = useParams();
  return (
    <Page
      title="Connectors"
      subtitle="Credentials stay on this machine. The model only ever sees what each connector's access level allows."
      actions={
        <Button variant="primary" disabled>
          Add
        </Button>
      }
    >
      {connectorId !== undefined && <Pill mono>{connectorId}</Pill>}
      <Placeholder title="Connectors, access levels, hidden columns and guardrails go here.">
        Only admins see this screen.
      </Placeholder>
    </Page>
  );
}
