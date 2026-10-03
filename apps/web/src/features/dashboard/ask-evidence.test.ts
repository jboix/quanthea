import { describe, expect, test } from 'bun:test';
import { evidenceLines } from './ask-evidence.ts';

describe('evidence lines', () => {
  test('sums up a level 3 read: rows, then each field with its extremes and when', () => {
    const result = {
      ok: true,
      columns: ['time', 'service', 'value'],
      frames: [
        {
          fields: [],
          rowCount: 90,
          truncated: false,
          summaries: [
            {
              field: 'time',
              type: 'time',
              count: 90,
              nulls: 0,
              from: '2026-09-26T11:30:00Z',
              to: '2026-09-26T13:00:00Z',
            },
            {
              field: 'value',
              type: 'number',
              count: 90,
              nulls: 0,
              min: 0.003,
              max: 0.08412,
              mean: 0.0213,
              spikes: [],
              minAt: '2026-09-26T11:30:00Z',
              maxAt: '2026-09-26T12:05:00Z',
              spikeWindows: [
                { from: '2026-09-26T12:04:00Z', to: '2026-09-26T12:41:00Z', peak: 0.08412 },
              ],
            },
            {
              field: 'code',
              type: 'string',
              count: 90,
              nulls: 0,
              distinct: 3,
              top: [
                { value: '502', count: 61 },
                { value: '504', count: 20 },
                { value: '500', count: 9 },
                { value: '503', count: 1 },
              ],
            },
          ],
        },
      ],
    };
    expect(evidenceLines(result, 'Europe/Zurich')).toEqual([
      '90 rows',
      'time 26 Sep 13:30 – 26 Sep 15:00',
      'value min 0.003 @26 Sep 13:30 · max 0.08412 @26 Sep 14:05 · mean 0.0213 · spike 26 Sep 14:04–26 Sep 14:41 (peak 0.08412)',
      'code top: 502 (61), 504 (20), 500 (9) · 3 distinct',
    ]);
  });

  test('says what failed, what ran without numbers, and what it cannot read', () => {
    expect(evidenceLines({ ok: false, error: 'timeout' }, 'UTC')).toEqual(['Failed: timeout']);
    expect(evidenceLines({ ok: true }, 'UTC')).toEqual([
      'It ran; its access level shows nothing more.',
    ]);
    expect(evidenceLines({ ok: true, frames: [{ rowCount: 1, truncated: true }] }, 'UTC')).toEqual([
      '1 row, cut at the row limit',
    ]);
    expect(evidenceLines('rows', 'UTC')).toEqual(['A result in a shape this page cannot show.']);
  });
});
