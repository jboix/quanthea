/**
 * The body of a run's page: the headline numbers with their change against the period before,
 * the other panels drawn from the frozen results with the dashboard's panel components, and the
 * links to dashboards opened on the run's period. Nothing runs to draw it.
 */

import {
  type DashboardSpec,
  dashboardOfReport,
  type Headline,
  type ReportRunDetail,
} from '@quanthea/shared';
import { Link } from 'react-router';
import { fittedNumber } from '../../ui/fitted-number.ts';
import { FrozenCanvas } from '../dashboard/index.ts';
import styles from './run.module.css';

/**
 * The report's panels without its headline numbers, moved up so the first row starts at the top.
 *
 * @param run - The run.
 * @returns The dashboard the frozen canvas draws.
 */
export function canvasSpec(run: ReportRunDetail): DashboardSpec {
  const spec = dashboardOfReport(run.spec, run.period);
  const headlines = new Set(run.spec.summaryPanels);
  const panels = spec.panels.filter((panel) => !headlines.has(panel.id));
  const top = Math.min(...panels.map((panel) => panel.grid.y));
  const moved = panels.map((panel) => ({
    ...panel,
    grid: { ...panel.grid, y: panel.grid.y - top },
  }));
  return { ...spec, panels: moved };
}

/**
 * One headline number: the panel's title, the number, and its change against the period before.
 *
 * @param props - The headline and the period it compares with.
 * @param props.headline - The headline.
 * @param props.before - The name of the period before, such as `week 39`, if any.
 * @returns The card.
 */
function HeadlineCard({
  headline,
  before,
}: {
  readonly headline: Headline;
  readonly before: string | undefined;
}) {
  const against = before && headline.change ? ` vs ${before}` : '';
  return (
    <section className={styles.headline} aria-label={headline.title}>
      <h2 className={styles.headlineTitle}>{headline.title}</h2>
      <p className={styles.headlineValue} style={fittedNumber(headline.text, 26)}>
        {headline.text}
      </p>
      {headline.change && (
        <p className={styles.headlineChange} data-direction={headline.change.direction}>
          {headline.change.text}
          {against}
        </p>
      )}
      {!headline.change && headline.previousText !== null && (
        <p className={styles.headlineChange}>Before: {headline.previousText}</p>
      )}
    </section>
  );
}

/**
 * The links to dashboards, each opened on the run's period.
 *
 * @param props - The links and the period's short name.
 * @param props.links - The links.
 * @param props.period - Such as `week 40`.
 * @returns The section, or nothing without links.
 */
function SeeAlso({
  links,
  period,
}: {
  readonly links: ReportRunDetail['seeAlso'];
  readonly period: string;
}) {
  if (links.length === 0) return null;
  return (
    <section className={styles.seeAlso} aria-labelledby="see-also">
      <h2 id="see-also" className={styles.sectionTitle}>
        See also
      </h2>
      <ul className={styles.links}>
        {links.map((link) => (
          <li key={link.dashboardId}>
            <Link to={link.path}>
              {link.label}, on {period}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The body of a run that succeeded.
 *
 * @param props - The run.
 * @param props.run - The run, with its frozen results.
 * @returns The headlines, the panels and the links.
 */
export function RunBody({ run }: { readonly run: ReportRunDetail }) {
  const short = (label: string) => label.split(',')[0] ?? label;
  const spec = canvasSpec(run);
  return (
    <>
      {run.headlines.length > 0 && (
        <div className={styles.headlines}>
          {run.headlines.map((headline) => (
            <HeadlineCard
              key={headline.panelId}
              headline={headline}
              before={run.comparison ? short(run.comparison.label) : undefined}
            />
          ))}
        </div>
      )}
      {spec.panels.length > 0 && run.panels && (
        <FrozenCanvas
          spec={spec}
          panels={run.panels}
          time={run.period}
          variables={run.variables}
          hiddenMarkers={[]}
        />
      )}
      <SeeAlso links={run.seeAlso} period={short(run.period.label)} />
    </>
  );
}
