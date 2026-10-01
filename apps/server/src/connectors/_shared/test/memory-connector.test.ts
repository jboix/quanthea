import { testConnectorConformance } from '@querent/plugin-kit/testing';
import { memoryConnector } from './memory-connector.ts';

testConnectorConformance(memoryConnector, {
  config: { rowCount: 5 },
  secret: { token: 'test' },
  query: { language: 'sql', text: 'SELECT * FROM events', parameters: [] },
  invalidQuery: { language: 'sql', text: 'nonsense', parameters: [] },
  sampleField: { entity: 'events', field: 'service' },
  timeRange: { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') },
  live: true,
});
