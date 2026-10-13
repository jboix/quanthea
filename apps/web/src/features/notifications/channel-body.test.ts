import { describe, expect, test } from 'bun:test';
import { channelInputSchema, channelPatchSchema } from '@quanthea/shared';
import { type ChannelFields, createBody, updateBody } from './channel-body.ts';

/** An Alertmanager channel's fields, as the form starts them. */
const fields: ChannelFields = {
  name: 'On-call',
  kind: 'alertmanager',
  target: 'http://alertmanager:9093',
  signingSecret: '',
  unsign: false,
  credentials: 'none',
  username: '',
  password: '',
  token: '',
  mentions: '',
};

describe('the channel form’s bodies', () => {
  test('a new channel carries the credentials chosen, and none by default', () => {
    expect(createBody(fields)).toEqual({
      name: 'On-call',
      kind: 'alertmanager',
      target: 'http://alertmanager:9093',
      mentions: [],
    });
    const basic = { ...fields, credentials: 'basic' as const, username: 'ops', password: 'pw' };
    expect(createBody(basic).auth).toEqual({ type: 'basic', username: 'ops', password: 'pw' });
    const bearer = createBody({ ...fields, credentials: 'bearer', token: 'abc' });
    expect(bearer.auth).toEqual({ type: 'bearer', token: 'abc' });
    expect(channelInputSchema.safeParse(bearer).success).toBe(true);
  });

  test('a change keeps the stored credentials, drops them, or sets new ones', () => {
    const empty = { ...fields, target: '' };
    expect(updateBody({ ...empty, credentials: 'keep' })).toEqual({
      name: 'On-call',
      mentions: [],
    });
    expect(updateBody({ ...empty, credentials: 'none' }).auth).toBeNull();
    const bearer = updateBody({ ...empty, credentials: 'bearer', token: 'abc' });
    expect(bearer.auth).toEqual({ type: 'bearer', token: 'abc' });
    expect(channelPatchSchema.safeParse(bearer).success).toBe(true);
  });

  test('a kind that sends no credentials never carries any', () => {
    const slack = { ...fields, kind: 'slack' as const, credentials: 'bearer' as const, token: 'x' };
    expect(createBody(slack)).not.toHaveProperty('auth');
    expect(updateBody({ ...slack, credentials: 'none' })).not.toHaveProperty('auth');
  });
});
