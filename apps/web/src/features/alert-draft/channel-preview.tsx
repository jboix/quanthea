/**
 * What a channel would send, drawn roughly as its service shows it: a Slack message with a
 * coloured bar, a Discord embed, a Teams card, a PagerDuty incident line, or a webhook's JSON.
 * Every text is plain text, never markup.
 */
import styles from './channel-preview.module.css';
import { type PreviewView, previewView } from './preview-model.ts';

/** Props of {@link ChannelPreview}. */
interface ChannelPreviewProps {
  /** The channel's name. */
  readonly name: string;
  /** The channel's service. */
  readonly kind: string;
  /** The body its recipe builds. */
  readonly body: unknown;
}

/**
 * The fields of a message.
 *
 * @param props - The view.
 * @param props.view - The view.
 * @returns The list, or nothing without fields.
 */
function Fields({ view }: { readonly view: PreviewView }) {
  if (view.fields.length === 0) return null;
  return (
    <dl className={styles.previewFields}>
      {view.fields.map((field) => (
        <div key={field.label}>
          <dt>{field.label}</dt>
          <dd>{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The message as a chat service shows it: title, body, fields and the context line.
 *
 * @param props - The view.
 * @param props.view - The view.
 * @returns The message.
 */
function ChatMessage({ view }: { readonly view: PreviewView }) {
  const header =
    view.look === 'teams' ? (
      <div className={styles.previewHeader} style={{ background: view.color ?? undefined }}>
        {view.title}
      </div>
    ) : (
      <span className={styles.previewTitle}>{view.title}</span>
    );
  return (
    <>
      {header}
      <p className={styles.previewText}>{view.body}</p>
      <Fields view={view} />
      {view.context && <span className={styles.previewContext}>{view.context}</span>}
    </>
  );
}

/**
 * The message as the service shows it.
 *
 * @param props - The view.
 * @param props.view - The view.
 * @returns The message.
 */
function Message({ view }: { readonly view: PreviewView }) {
  if (view.look === 'json') return <pre className={styles.json}>{view.json}</pre>;
  if (view.look !== 'pagerduty') return <ChatMessage view={view} />;
  return (
    <>
      <span className={styles.incident}>
        <span className={styles.dot} style={{ background: view.color ?? undefined }} />
        {view.context} · {view.title}
      </span>
      <p className={styles.previewText}>{view.body}</p>
      <Fields view={view} />
    </>
  );
}

/**
 * A channel's preview.
 *
 * @param props - The channel's name and service, and the body.
 * @returns The preview.
 */
export function ChannelPreview({ name, kind, body }: ChannelPreviewProps) {
  const view = previewView(kind, body);
  const bar = view.look === 'slack' || view.look === 'discord' ? view.color : null;
  return (
    <figure
      className={styles.preview}
      data-look={view.look}
      style={bar ? { borderLeftColor: bar } : undefined}
      aria-label={`What ${name} would show`}
    >
      <span className={styles.previewLabel}>
        {name} · {kind}
      </span>
      <Message view={view} />
    </figure>
  );
}
