import { describe, expect, test } from 'bun:test';
import { alertLabels, labelName } from './alertmanager.ts';

describe('the labels of an Alertmanager alert', () => {
  test('names become valid for Prometheus', () => {
    expect(labelName('k8s.pod-name')).toBe('k8s_pod_name');
    expect(labelName('2xx')).toBe('_2xx');
    expect(labelName('région')).toBe('r_gion');
  });

  test('a series label never takes a reserved name, and a clash resolves the same way', () => {
    const own = { alertname: 'Errors', severity: 'critical', quanthea_alert: 'a1' };
    const series = { severity: 'high', alertname: 'x', quanthea_alert: 'y', 'a.b': '1', a_b: '2' };
    const labels = alertLabels(own, series);
    expect(labels).toEqual({
      ...own,
      a_b: '1',
      a_b_2: '2',
      series_alertname: 'x',
      series_quanthea_alert: 'y',
      series_severity: 'high',
    });
    const reversed = Object.fromEntries(Object.entries(series).reverse());
    expect(alertLabels(own, reversed)).toEqual(labels);
  });

  test('a label without a value is left out', () => {
    expect(alertLabels({ alertname: 'Errors' }, { region: '' })).toEqual({ alertname: 'Errors' });
  });
});
