import { describe, expect, test } from 'bun:test';
import { promqlReads } from './promql-metrics.ts';

describe('promqlReads', () => {
  test('finds the metrics of an expression, not its functions, labels or keywords', () => {
    const reads = promqlReads(
      'sum by (job, instance) (rate(http_requests_total{job="api", code=~"5.."}[5m])) / ignoring(code) group_left sum without (code) (rate(http_requests_total[5m] offset 1h)) > bool 0.5 or vector(0) + node:cpu:ratio',
    );
    expect(reads.metrics).toEqual(['http_requests_total', 'http_requests_total', 'node:cpu:ratio']);
    expect(reads.unnamed).toBe(false);
  });

  test('reads a subquery, a comment and strings outside braces', () => {
    const reads = promqlReads(
      'max_over_time(up[1h:5m]) # hidden_metric\n + label_replace(build_info, "a", "$1", "b", "(.*)") + count_values("v", go_info) + Inf',
    );
    expect(reads.metrics).toEqual(['up', 'build_info', 'go_info']);
  });

  test('takes an equality on __name__ and a quoted name for the metric', () => {
    expect(promqlReads('{__name__="up", job="api"}')).toEqual({ metrics: ['up'], unnamed: false });
    expect(promqlReads('{"http.requests", "service.name"="api"}')).toEqual({
      metrics: ['http.requests'],
      unnamed: false,
    });
  });

  test('reports a selector that can read metrics it does not name', () => {
    expect(promqlReads('{job="api"}').unnamed).toBe(true);
    expect(promqlReads('sum({__name__=~"http_.*"})').unnamed).toBe(true);
    expect(promqlReads('{__name__!="up"}').unnamed).toBe(true);
    expect(promqlReads('{__name__="\\x75p"}').unnamed).toBe(true);
    expect(promqlReads('up{job="api"} + {job="x"}').unnamed).toBe(true);
  });
});
