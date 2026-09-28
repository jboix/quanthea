import { useParams } from 'react-router';
import { Page } from '../ui/page.tsx';
import { Pill } from '../ui/pill.tsx';
import { Placeholder } from '../ui/placeholder.tsx';

/**
 * The Build and refine screen, also used for variants: the thread next to its live draft dashboard.
 *
 * @returns The screen.
 */
export function ThreadRoute() {
  const { threadId = '' } = useParams();
  return (
    <Page title="Thread" actions={<Pill mono>{threadId}</Pill>}>
      <Placeholder title="The thread and its draft dashboard go here.">
        Build log, diff cards, the inspector, and Pin.
      </Placeholder>
    </Page>
  );
}
