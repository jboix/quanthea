import type { DefinitionMark, DefinitionVersion } from '@quanthea/shared';
import { useEffect } from 'react';
import { Link, useFetcher } from 'react-router';
import styles from './panels.module.css';

/**
 * What the info bubble says of the definition a panel was copied from: which version, its meaning
 * now, and that the panel keeps its copy when the definition changed since.
 *
 * @param mark - What the panel recorded.
 * @param current - The definition's latest version, if it still exists.
 * @returns The lines.
 */
export function definitionLines(
  mark: DefinitionMark,
  current: DefinitionVersion | undefined,
): { heading: string; meaning?: string; note?: string } {
  if (!current)
    return {
      heading: `From the definition ${mark.id}, v${mark.version}`,
      note: 'It was deleted since; this panel keeps its copy.',
    };
  const heading = `From ${current.definition.name}, v${mark.version}`;
  if (current.version === mark.version) return { heading, meaning: current.definition.meaning };
  return {
    heading,
    meaning: current.definition.meaning,
    note: `It changed since: now v${current.version}, whose meaning is above. This panel keeps v${mark.version}; ask the agent to rebuild it to use v${current.version}.`,
  };
}

/**
 * The definition a panel was copied from, in its info bubble. The definitions load when the bubble
 * opens.
 *
 * @param props - The mark.
 * @param props.mark - What the panel recorded.
 * @returns The section.
 */
export function PanelDefinition({ mark }: { readonly mark: DefinitionMark }) {
  const fetcher = useFetcher<{ definitions: readonly DefinitionVersion[] }>();
  const { load, state, data } = fetcher;
  useEffect(() => {
    if (state === 'idle' && !data) void load('/definitions');
  }, [load, state, data]);
  const current = data?.definitions.find((each) => each.definition.id === mark.id);
  const lines = data
    ? definitionLines(mark, current)
    : { heading: `From the definition ${mark.id}, v${mark.version}` };
  return (
    <div className={styles.infoQuery}>
      <span className={styles.infoSource}>
        <Link to="/definitions">{lines.heading}</Link>
      </span>
      {'meaning' in lines && <p className={styles.infoText}>{lines.meaning}</p>}
      {'note' in lines && <p className={styles.infoText}>{lines.note}</p>}
    </div>
  );
}
