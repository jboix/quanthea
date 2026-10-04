/**
 * The alert page's header actions: Change for editors, Mute for analysts and above, and Versions.
 * Below the narrow breakpoint they fold into one menu with a section each, as a dashboard's do.
 */
import type { AlertDetail } from '@quanthea/shared';
import type { ReactNode } from 'react';
import { MoreIcon } from '../../ui/icons.tsx';
import { Popover } from '../../ui/popover.tsx';
import { useMediaQuery } from '../../ui/use-media-query.ts';
import styles from './alert-actions.module.css';
import {
  ChangeItems,
  ChangePopover,
  type MenuProps,
  MuteItems,
  MutePopover,
} from './alert-menus.tsx';
import { VersionsBody, VersionsPopover } from './alert-versions.tsx';
import { type HeaderSection, headerSections } from './header-sections.ts';
import { useRole } from './use-role.ts';

/** Below this width the header actions fold into one menu. */
const narrowScreen = '(max-width: 720px)';

/** What each section of the folded menu holds. */
const sectionItems: Readonly<Record<HeaderSection, (props: MenuProps) => ReactNode>> = {
  Change: ChangeItems,
  Mute: MuteItems,
  Versions: VersionsBody,
};

/**
 * The actions folded into one menu: a heading and the items of each section the role sees.
 *
 * @param props - The alert and the closer.
 * @returns The menu's content.
 */
function FoldedActions(props: MenuProps) {
  return (
    <div className={styles.folded}>
      {headerSections(useRole()).map((section) => {
        const Items = sectionItems[section];
        return (
          <section key={section} aria-label={section} className={styles.section}>
            <h2 className={styles.heading}>{section}</h2>
            <Items {...props} />
          </section>
        );
      })}
    </div>
  );
}

/**
 * The header's actions, folded into one menu on a narrow screen.
 *
 * @param props - The alert.
 * @param props.alert - The alert.
 * @returns The actions.
 */
export function HeaderActions({ alert }: { readonly alert: AlertDetail }) {
  const narrow = useMediaQuery(narrowScreen);
  if (narrow)
    return (
      <Popover label="Alert actions" trigger={<MoreIcon />} align="end">
        {(close) => <FoldedActions alert={alert} close={close} />}
      </Popover>
    );
  return (
    <div className={styles.actions}>
      <ChangePopover alert={alert} />
      <MutePopover alert={alert} />
      <VersionsPopover alert={alert} />
    </div>
  );
}
