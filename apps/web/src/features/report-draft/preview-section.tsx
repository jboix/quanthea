/**
 * The draft's preview over its latest period: the headline numbers with their change against the
 * period before, then the other panels drawn by the dashboard's own panel components from the
 * preview's results. Nothing runs in the browser; the preview route ran the draft once and
 * stored nothing.
 */
import {
  dashboardOfReport,
  type Headline,
  type ReportPeriod,
  type ReportPreview,
  type ReportSpec,
} from '@quanthea/shared';
import { useEffect } from 'react';
import { useFetcher } from 'react-router';
import { FrozenCanvas } from '../dashboard/index.ts';
import type { PreviewOutcome } from './data.ts';
import styles from './report-draft.module.css';

/** The latest period of each kind, in words. */
const lastWords: Readonly<Record<ReportPeriod, string>> = {
  previous_day: 'yesterday',
  previous_week: 'last week',
  previous_month: 'last month',
  week_to_date: 'this week so far',
};

/**
 * Loads the preview of the thread's latest draft from the preview route.
 *
 * @param threadId - The thread.
 * @param version - The draft's version, so a new version previews again.
 * @returns The outcome, once loaded.
 */
function usePreview(threadId: string, version: number): PreviewOutcome | undefined {
  const { load, data } = useFetcher<PreviewOutcome>({ key: `report-preview-${threadId}` });
  const url = `/threads/${threadId}/report-preview?v=${version}`;
  useEffect(() => {
    void load(url);
  }, [load, url]);
  return data?.ok && data.version !== version ? undefined : data;
}

/**
 * One headline number, with how it moved since the period before.
 *
 * @param props - The headline.
 * @param props.headline - The headline.
 * @returns The tile.
 */
function HeadlineTile({ headline }: { readonly headline: Headline }) {
  const { change, previousText } = headline;
  return (
    <div className={styles.headline}>
      <span className={styles.headlineTitle}>{headline.title}</span>
      <span className={styles.headlineValue}>{headline.text}</span>
      {change && (
        <span className={styles.change} data-direction={change.direction}>
          {change.text}
          {previousText ? ` · was ${previousText}` : ''}
        </span>
      )}
    </div>
  );
}

/**
 * The panels that are not headlines, moved up into the rows the headlines left.
 *
 * @param spec - The spec.
 * @returns The panels.
 */
function otherPanels(spec: ReportSpec): ReportSpec['panels'] {
  const panels = spec.panels.filter((panel) => !spec.summaryPanels.includes(panel.id));
  const top = Math.min(...panels.map((panel) => panel.grid.y));
  if (!Number.isFinite(top) || top === 0) return panels;
  return panels.map((panel) => ({ ...panel, grid: { ...panel.grid, y: panel.grid.y - top } }));
}

/**
 * The preview's results: the headlines, then the other panels.
 *
 * @param props - The spec and the preview.
 * @param props.spec - The draft's spec.
 * @param props.preview - The preview.
 * @returns The results.
 */
function PreviewResults({
  spec,
  preview,
}: {
  readonly spec: ReportSpec;
  readonly preview: ReportPreview;
}) {
  const time = { from: preview.period.from, to: preview.period.to };
  const shown = { ...spec, panels: otherPanels(spec) };
  return (
    <>
      {preview.failure && <p className={styles.failure}>{preview.failure}</p>}
      {preview.headlines.length > 0 && (
        <div className={styles.headlines}>
          {preview.headlines.map((headline) => (
            <HeadlineTile key={headline.panelId} headline={headline} />
          ))}
        </div>
      )}
      {shown.panels.length > 0 && (
        <FrozenCanvas
          spec={dashboardOfReport(shown, preview.period)}
          panels={preview.panels}
          time={time}
          variables={{}}
          hiddenMarkers={[]}
          fixedNote="The latest period the report covers"
        />
      )}
    </>
  );
}

/**
 * The preview of the draft on its latest period.
 *
 * @param props - The thread, the version and its spec.
 * @param props.threadId - The thread.
 * @param props.version - The draft's version.
 * @param props.spec - Its spec.
 * @returns The section.
 */
export function PreviewSection({
  threadId,
  version,
  spec,
}: {
  readonly threadId: string;
  readonly version: number;
  readonly spec: ReportSpec;
}) {
  const outcome = usePreview(threadId, version);
  const label = outcome?.ok ? ` · ${outcome.preview.period.label}` : '';
  return (
    <section className={styles.preview} aria-label="Preview">
      <h3 className={styles.previewHead}>
        Preview on {lastWords[spec.period]}
        {label}
      </h3>
      {!outcome && <p className={styles.note}>Running the report over its latest period…</p>}
      {outcome && !outcome.ok && <p className={styles.failure}>{outcome.message}</p>}
      {outcome?.ok && <PreviewResults spec={spec} preview={outcome.preview} />}
    </section>
  );
}
