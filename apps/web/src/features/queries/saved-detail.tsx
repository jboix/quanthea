import type { SavedQuery } from '@querent/shared';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Pill } from '../../ui/pill.tsx';
import type { PreviewConnector } from './data.ts';
import styles from './queries.module.css';
import { SavedPreview } from './saved-preview.tsx';

/** How each view kind reads. */
const showLabels: Readonly<Record<SavedQuery['show'], string>> = {
  line: 'a line over time',
  bar: 'bars over time',
  'category-bar': 'bars by category',
  pie: 'a pie',
  stat: 'one number',
  table: 'a table',
};

/**
 * The query template and its placeholders.
 *
 * @param props - The recipe.
 * @param props.recipe - The recipe.
 * @returns The card.
 */
function TemplateCard({ recipe }: { readonly recipe: SavedQuery }) {
  const columns = recipe.columns?.length ? `, columns ${recipe.columns.join(', ')}` : '';
  return (
    <Card
      title="Query"
      description={`Shows as ${showLabels[recipe.show]}, in ${recipe.unit}${columns}.`}
    >
      <pre className={styles.code}>{recipe.query}</pre>
      <table className={styles.fields}>
        <tbody>
          {recipe.params.map((param) => (
            <tr key={param.name}>
              <td className={styles.fieldName}>{`{{${param.name}}}`}</td>
              <td>
                <code className={styles.fieldType}>{param.kind}</code>
                {param.description && <div className={styles.hint}>{param.description}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** Props of {@link SavedDetail}. */
interface SavedDetailProps {
  /** The recipe. */
  readonly recipe: SavedQuery;
  /** The connectors a preview can run on. */
  readonly connectors: readonly PreviewConnector[];
  /** Opens it in the editor. */
  readonly onEdit: () => void;
  /** Removes it. */
  readonly onRemove: () => void;
}

/**
 * One of your recipes: its query, its placeholders and a preview.
 *
 * @param props - The recipe, the connectors and the actions.
 * @returns The detail.
 */
export function SavedDetail({ recipe, connectors, onEdit, onRemove }: SavedDetailProps) {
  return (
    <div className={styles.detail}>
      <header className={styles.detailHead}>
        <div className={styles.titleRow}>
          <h2 className={styles.detailTitle}>{recipe.name}</h2>
          <Pill mono>{recipe.id}</Pill>
          <span className={styles.spacer} />
          <Button size="small" onClick={onEdit}>
            Edit
          </Button>
          <Button size="small" variant="danger" onClick={onRemove}>
            Remove
          </Button>
        </div>
        <p className={styles.hint}>{recipe.description}</p>
      </header>
      <TemplateCard recipe={recipe} />
      <Card
        title="Preview"
        description="A value for each placeholder, as the agent would give them. Nothing is saved."
      >
        <SavedPreview
          key={recipe.id}
          recipe={recipe}
          language={recipe.language}
          connectors={connectors}
        />
      </Card>
    </div>
  );
}
