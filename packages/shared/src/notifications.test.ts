import { describe, expect, test } from 'bun:test';
import { messageTemplateSchema, notificationSchema, unknownPlaceholders } from './notifications.ts';

const template = {
  title: '{alert} is firing for {series}',
  body: '5xx share is {value}, above {threshold} for {duration}.',
};

describe('message templates', () => {
  test('accept the known placeholders and default the fields', () => {
    expect(messageTemplateSchema.parse(template)).toEqual({ ...template, fields: [] });
  });

  test('refuse an unknown placeholder', () => {
    expect(unknownPlaceholders('{alert} at {host}')).toEqual(['host']);
    expect(messageTemplateSchema.safeParse({ ...template, body: 'on {host}' }).success).toBe(false);
  });
});

describe('notifications', () => {
  test('carry the template and the values to fill it with', () => {
    const notification = {
      event: 'alert.firing',
      alert: {
        id: 'a1',
        title: 'Checkout 5xx',
        version: 3,
        severity: 'critical',
        url: '/alerts/a1',
      },
      series: { key: 'service=checkout-svc', labels: { service: 'checkout-svc' } },
      template,
      values: { alert: 'Checkout 5xx', value: '3.4%' },
      at: '2026-10-04T12:22:00Z',
    };
    expect(notificationSchema.parse(notification).template.fields).toEqual([]);
  });
});
