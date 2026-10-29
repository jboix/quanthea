/**
 * The inspector's JSON tab: the draft panel's spec as text, for any change the form does not
 * cover. Text that is not a JSON object stays in the box with why; the server checks the rest like
 * any write, and its problems point at the field.
 */
import type { Panel } from '@quanthea/shared';
import { useState } from 'react';
import { TextArea } from '../../ui/text-area.tsx';
import { EditFooter } from './edit-footer.tsx';
import styles from './panel-editor.module.css';
import type { PanelEditState } from './use-panel-edit.ts';

/**
 * Reads the text as a panel: any JSON object, which the server checks.
 *
 * @param text - The text.
 * @returns The panel, or why the text is no JSON object.
 */
export function parsePanel(text: string): { panel: Panel } | { error: string } {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return { error: 'The panel is a JSON object, between { and }.' };
    return { panel: value as Panel };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'This is not JSON.' };
  }
}

/**
 * The JSON tab. A chart picked in the form is dropped here: the JSON is the whole panel.
 *
 * @param props - The edit.
 * @param props.edit - The edit.
 * @returns The tab.
 */
export function PanelJson({ edit }: { readonly edit: PanelEditState }) {
  const [text, setText] = useState(() => JSON.stringify(edit.draft, null, 2));
  const [error, setError] = useState<string>();
  const change = (next: string) => {
    setText(next);
    const parsed = parsePanel(next);
    setError('error' in parsed ? parsed.error : undefined);
    if ('panel' in parsed) {
      edit.setChart(undefined);
      edit.setDraft(parsed.panel);
    }
  };
  return (
    <div className={styles.form}>
      <TextArea
        label="Panel JSON"
        hint="Checked by the server like any write: the schema, theme colours, and a test run."
        mono
        rows={18}
        spellCheck={false}
        value={text}
        error={error}
        onChange={(event) => change(event.target.value)}
      />
      <EditFooter edit={edit} />
    </div>
  );
}
