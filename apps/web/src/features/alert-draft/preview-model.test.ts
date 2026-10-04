import { describe, expect, test } from 'bun:test';
import { previewView, unescapeMarkdown, unescapeSlack } from './preview-model.ts';

describe('reading a channel preview back', () => {
  test('takes Slack’s escapes off, and reads its bar, header, body, fields and context', () => {
    const body = {
      text: 'Checkout 5xx',
      attachments: [
        {
          color: '#8f2a1c',
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: 'Checkout &lt;5xx&gt;' } },
            { type: 'section', text: { type: 'mrkdwn', text: 'At 3​.​1% &amp; rising' } },
            { type: 'section', fields: [{ type: 'mrkdwn', text: '*Value*\n3.1%' }] },
            { type: 'context', elements: [{ type: 'mrkdwn', text: 'firing · critical' }] },
          ],
        },
      ],
    };
    expect(previewView('slack', body)).toEqual({
      look: 'slack',
      color: '#8f2a1c',
      title: 'Checkout <5xx>',
      body: 'At 3.1% & rising',
      fields: [{ label: 'Value', value: '3.1%' }],
      context: 'firing · critical',
    });
  });

  test('reads a Discord embed with its colour as CSS', () => {
    const body = {
      embeds: [
        {
          title: 'Checkout 5xx',
          description: 'service\\=checkout at 3\\.1%',
          color: 0x8f2a1c,
          fields: [{ name: 'Value', value: '3\\.1%', inline: true }],
          footer: { text: 'firing' },
        },
      ],
    };
    expect(previewView('discord', body)).toMatchObject({
      color: '#8f2a1c',
      body: 'service\\=checkout at 3.1%',
      fields: [{ label: 'Value', value: '3.1%' }],
      context: 'firing',
    });
  });

  test('reads a Teams card, a PagerDuty event and a webhook’s JSON', () => {
    const teams = {
      attachments: [
        {
          content: {
            body: [
              {
                type: 'Container',
                style: 'attention',
                items: [{ type: 'TextBlock', text: 'Title' }],
              },
              { type: 'TextBlock', text: 'Body' },
              { type: 'FactSet', facts: [{ title: 'Value', value: '3' }] },
              { type: 'TextBlock', text: 'firing', isSubtle: true },
            ],
          },
        },
      ],
    };
    expect(previewView('teams', teams)).toMatchObject({
      title: 'Title',
      body: 'Body',
      context: 'firing',
    });
    const pagerDuty = {
      event_action: 'trigger',
      payload: {
        summary: 'Checkout 5xx',
        severity: 'critical',
        custom_details: { body: 'Up', Value: '3', labels: {} },
      },
    };
    expect(previewView('pagerduty', pagerDuty)).toMatchObject({
      title: 'Checkout 5xx',
      body: 'Up',
      fields: [{ label: 'Value', value: '3' }],
      context: 'trigger · critical',
    });
    const webhook = { event: 'alert.firing', message: { title: 'T', body: 'B' } };
    expect(previewView('webhook', webhook)).toMatchObject({ look: 'json', title: 'T' });
    expect(previewView('webhook', webhook).json).toContain('"event": "alert.firing"');
  });

  test('never turns text into markup', () => {
    expect(unescapeSlack('&lt;script&gt;')).toBe('<script>');
    expect(unescapeMarkdown('\\*bold\\*')).toBe('*bold*');
  });
});
