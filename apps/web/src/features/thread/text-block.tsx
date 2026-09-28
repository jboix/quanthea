import { Fragment, type ReactNode } from 'react';
import styles from './conversation.module.css';
import { readableText } from './messages.ts';

/**
 * Renders one line of the model's text: `code` and **bold**, everything else as plain text. No
 * HTML from the model is ever rendered.
 *
 * @param line - The line.
 * @returns The inline content.
 */
function inline(line: string): ReactNode[] {
  return line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((piece, index) => {
    const key = `${index}:${piece}`;
    if (piece.startsWith('`') && piece.endsWith('`'))
      return <code key={key}>{piece.slice(1, -1)}</code>;
    if (piece.startsWith('**') && piece.endsWith('**'))
      return <strong key={key}>{piece.slice(2, -2)}</strong>;
    return <Fragment key={key}>{piece}</Fragment>;
  });
}

/**
 * The model's text, as paragraphs.
 *
 * @param props - The text.
 * @param props.text - The model's text, as it wrote it.
 * @returns The paragraphs, or nothing when only reasoning was written.
 */
export function TextBlock({ text }: { readonly text: string }) {
  const readable = readableText(text);
  if (readable === '') return null;
  const paragraphs = readable
    .split(/\n{2,}/)
    .map((text, position) => ({ key: String(position), text }));
  return (
    <div className={styles.text}>
      {paragraphs.map((paragraph) => (
        <p key={paragraph.key}>{inline(paragraph.text)}</p>
      ))}
    </div>
  );
}
