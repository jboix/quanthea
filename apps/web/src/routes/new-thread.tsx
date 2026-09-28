import { Button } from '../ui/button.tsx';
import { Page } from '../ui/page.tsx';
import { Placeholder } from '../ui/placeholder.tsx';

/**
 * The Plan screen: the thread on the left, the planned dashboard on the right.
 *
 * @returns The screen.
 */
export function NewThreadRoute() {
  return (
    <Page
      title="New thread"
      subtitle="Describe the dashboard you want. The agent explores your sources and proposes a plan."
      actions={
        <Button variant="primary" size="large" disabled>
          Start
        </Button>
      }
    >
      <Placeholder title="The thread and the plan card go here.">
        Exploration steps, a plan card, and Approve and build.
      </Placeholder>
    </Page>
  );
}
