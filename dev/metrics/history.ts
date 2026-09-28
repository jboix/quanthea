/**
 * Writes the synthetic metrics from eight hours before the incident until now, in OpenMetrics
 * format, for `promtool tsdb create-blocks-from openmetrics`. Usage: `bun history.ts <file>`.
 */
import { incidentStart } from './incident.ts';
import { advance, createSeries, type Series } from './series.ts';

/** The spacing of the samples, in seconds: two samples per minute keep `rate(…[1m])` working. */
const stepSeconds = 30;

/** How long before the incident the history starts, in milliseconds. */
const leadMilliseconds = 8 * 60 * 60 * 1000;

/**
 * The target labels Prometheus attaches to the live scrape, so the history and the live samples
 * form one series.
 */
const targetLabels = 'job="synthetic",instance="metrics:9464",';

/**
 * Renders the labels of a series with the target labels in front.
 *
 * @param series - The series.
 * @returns The `{…}` label set.
 */
function labelsOf(series: Series): string {
  return `{${targetLabels}${series.labels.slice(1)}`;
}

/** Every series with its values over time, and the sample times in seconds. */
interface Recording {
  /** Sample times, in Unix seconds. */
  readonly times: number[];
  /** Each series and its value at each sample time. */
  readonly values: Map<Series, number[]>;
}

/**
 * Runs the traffic model over the whole history and records every value.
 *
 * @param now - The end of the history.
 * @returns The recording.
 */
function record(now: Date): Recording {
  const incident = incidentStart(now);
  const groups = createSeries();
  const all = groups.flatMap((group) => [...group.requests, ...group.latency]);
  const recording: Recording = { times: [], values: new Map(all.map((series) => [series, []])) };
  for (
    let time = incident.getTime() - leadMilliseconds;
    time <= now.getTime();
    time += stepSeconds * 1000
  ) {
    advance(groups, new Date(time), stepSeconds, incident);
    recording.times.push(time / 1000);
    all.forEach((series) => {
      recording.values.get(series)?.push(series.value);
    });
  }
  return recording;
}

/**
 * Renders the request counters: one series at a time, each in time order.
 *
 * @param recording - The recorded values.
 * @returns The OpenMetrics lines of the counter family.
 */
function counterLines(recording: Recording): string[] {
  const lines = ['# TYPE http_requests counter'];
  recording.values.forEach((values, series) => {
    if (series.name !== 'http_requests_total') return;
    values.forEach((value, index) => {
      lines.push(`${series.name}${labelsOf(series)} ${value} ${recording.times[index]}`);
    });
  });
  return lines;
}

/**
 * Renders the latency histogram. OpenMetrics groups a histogram point, all its buckets, sum and
 * count, at one timestamp, so each route's series are written point by point.
 *
 * @param recording - The recorded values.
 * @returns The OpenMetrics lines of the histogram family.
 */
function histogramLines(recording: Recording): string[] {
  const lines = [
    '# TYPE http_request_duration_seconds histogram',
    '# UNIT http_request_duration_seconds seconds',
  ];
  const histogram = [...recording.values].filter(([series]) =>
    series.name.startsWith('http_request_duration'),
  );
  const pointSize = 10;
  for (let first = 0; first < histogram.length; first += pointSize) {
    const point = histogram.slice(first, first + pointSize);
    recording.times.forEach((time, index) => {
      point.forEach(([series, values]) => {
        lines.push(`${series.name}${labelsOf(series)} ${values[index]} ${time}`);
      });
    });
  }
  return lines;
}

const outputPath = Bun.argv[2];
if (!outputPath) throw new Error('Usage: bun history.ts <output file>');

const recording = record(new Date());
const text = [...counterLines(recording), ...histogramLines(recording), '# EOF', ''].join('\n');
await Bun.write(outputPath, text);
process.stdout.write(`Wrote ${recording.times.length} steps to ${outputPath}.\n`);
