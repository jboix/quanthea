import { useState } from 'react';
import { BrandIcon, BrandMark, Logo } from '../ui/brand.tsx';
import { Button } from '../ui/button.tsx';
import { Card } from '../ui/card.tsx';
import { Input } from '../ui/input.tsx';
import { Page } from '../ui/page.tsx';
import { Pill } from '../ui/pill.tsx';
import { Select } from '../ui/select.tsx';
import { Switch } from '../ui/switch.tsx';
import { Tabs } from '../ui/tabs.tsx';
import styles from './ui-kit.module.css';

/** The inspector tabs of the thread screen, used as the tabs sample. */
const inspectorTabs = [
  { id: 'query', label: 'Query' },
  { id: 'spec', label: 'Chart spec' },
  { id: 'history', label: 'History' },
];

/**
 * Buttons and pills in every variant.
 *
 * @returns The card.
 */
function ButtonsAndPills() {
  return (
    <Card title="Buttons and pills" description="Actions, statuses, versions and tags.">
      <div className={styles.row}>
        <Button variant="primary">New thread</Button>
        <Button>Spec</Button>
        <Button variant="dark">Pin</Button>
        <Button variant="danger">Delete permanently</Button>
        <Button size="small">Undo</Button>
      </div>
      <div className={styles.row}>
        <Pill tone="draft" mono>
          v3 · draft
        </Pill>
        <Pill shape="tag">Pinned · v3</Pill>
        <Pill tone="ok">connected · 38 ms</Pill>
        <Pill tone="danger" mono>
          customers.email
        </Pill>
        <Pill tone="accent" mono>
          in chat
        </Pill>
      </div>
    </Card>
  );
}

/**
 * Tabs with a panel, as in the inspector.
 *
 * @returns The card.
 */
function TabsSample() {
  const [selected, setSelected] = useState('query');
  return (
    <Card title="Tabs" description="Left and right arrows move between tabs.">
      <Tabs label="Inspector" tabs={inspectorTabs} selected={selected} onSelect={setSelected} />
      <p role="tabpanel" className={styles.panel}>
        {selected === 'query' ? 'sum by (service) (rate(http_requests_total[1m]))' : selected}
      </p>
    </Card>
  );
}

/**
 * Inputs, a select and switches, as in the settings screens.
 *
 * @returns The card.
 */
function FormControls() {
  const [planApproval, setPlanApproval] = useState(true);
  return (
    <Card title="Form controls" description="Settings fields and behaviour switches.">
      <div className={styles.fields}>
        <Input label="Base URL" mono defaultValue="http://localhost:4000/v1" />
        <Select
          label="Plan and build dashboards"
          mono
          options={[{ value: 'build', label: 'claude-sonnet-5' }]}
        />
      </div>
      <Switch
        label="Ask for plan approval before building"
        description="Small edits to an existing panel skip the plan."
        checked={planApproval}
        onChange={setPlanApproval}
      />
      <Switch
        label="Custom JS formatters"
        description="Not available."
        checked={false}
        onChange={() => undefined}
        disabled
      />
    </Card>
  );
}

/**
 * The brand on light surfaces: the logo, the blue icon at the sizes it is used, and the bare mark.
 *
 * @returns The light half of the brand sample.
 */
function BrandOnLight() {
  return (
    <div className={styles.brandSurface}>
      <Logo height={40} />
      <div className={styles.row}>
        <BrandIcon size={64} label="querent icon" />
        <BrandIcon size={32} />
        <BrandIcon size={16} />
        <span className={styles.inkMark}>
          <BrandMark size={32} />
        </span>
        <span className={styles.accentMark}>
          <BrandMark size={32} />
        </span>
      </div>
    </div>
  );
}

/**
 * The brand on dark surfaces: white lettering, the ink icon for large sizes, blue below.
 *
 * @returns The dark half of the brand sample.
 */
function BrandOnDark() {
  return (
    <div className={`${styles.brandSurface} ${styles.inkSurface}`}>
      <Logo surface="dark" height={40} />
      <div className={styles.row}>
        <BrandIcon size={64} tone="ink" label="querent icon on dark" />
        <BrandIcon size={32} />
        <BrandIcon size={16} />
        <BrandMark size={32} />
      </div>
    </div>
  );
}

/**
 * Every brand style from docs/brand, on the surface each is meant for.
 *
 * @returns The card, spanning the grid.
 */
function BrandSample() {
  return (
    <div className={styles.wide}>
      <Card title="Brand" description="The logo, icon and mark from docs/brand.">
        <div className={styles.brandGrid}>
          <BrandOnLight />
          <BrandOnDark />
        </div>
      </Card>
    </div>
  );
}

/**
 * Every `ui/` primitive in querent's visual language, for checking them in one place.
 *
 * @returns The screen.
 */
export function UiKitRoute() {
  return (
    <Page title="UI kit" subtitle="The primitives in apps/web/src/ui.">
      <div className={styles.grid}>
        <BrandSample />
        <ButtonsAndPills />
        <TabsSample />
        <FormControls />
        <Card
          title="Dashed card"
          variant="dashed"
          description="Used for suggestions and placeholders."
        />
      </div>
    </Page>
  );
}
