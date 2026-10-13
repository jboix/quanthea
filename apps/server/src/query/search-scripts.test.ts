import { describe, expect, test } from 'bun:test';
import { searchRatioScripts, searchScriptLength } from '../connectors/_shared/index.ts';
import { bindSearch } from './search-binder.ts';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * Binds a search body on a connector.
 *
 * @param body - The body.
 * @param bucketScripts - Whether the connector allows bucket scripts.
 * @param variables - The variable values.
 * @returns The bound body.
 */
function bind(
  body: Record<string, unknown>,
  bucketScripts: boolean,
  variables: Record<string, string> = {},
) {
  const bindings = Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [name, { value }]),
  );
  return bindSearch({ index: 'logs-*', body }, bindings, timeRange, { bucketScripts }).body;
}

/**
 * A terms aggregation with two counts and one bucket aggregation over them.
 *
 * @param aggregation - `bucket_script` or `bucket_selector`.
 * @param script - Its script.
 * @param paths - Its `buckets_path`, or `null` for none.
 * @returns The body.
 */
function over(
  aggregation: string,
  script: unknown,
  paths: unknown = { errors: '_errors>_count', warnings: '_warnings>_count' },
) {
  const bucket = { ...(paths === null ? {} : { buckets_path: paths }), script };
  return {
    size: 0,
    aggs: {
      service: {
        terms: { field: 'service' },
        aggs: {
          _errors: { filter: { term: { level: 'error' } } },
          _warnings: { filter: { term: { level: 'warn' } } },
          value: { [aggregation]: bucket },
        },
      },
    },
  };
}

/** Every place a script reads documents, one body each. */
const documentScripts: Record<string, Record<string, unknown>> = {
  script_fields: { script_fields: { secret: { script: { source: "doc['email'].value" } } } },
  runtime_mappings: {
    runtime_mappings: { secret: { type: 'keyword', script: "emit(doc['email'].value)" } },
  },
  'a runtime field of an aggregation': {
    aggs: { a: { terms: { field: 'x', runtime_mappings: { x: { type: 'keyword' } } } } },
  },
  scripted_metric: {
    aggs: { a: { scripted_metric: { map_script: 'state.x = params._source', init_script: '1' } } },
  },
  'a script query': { query: { bool: { filter: [{ script: { script: "doc['a'].value > 1" } }] } } },
  'a script sort': {
    sort: [{ _script: { type: 'number', script: { source: "doc['a'].value" } } }],
  },
  script_score: { query: { script_score: { query: { match_all: {} }, script: { source: '1' } } } },
  'a scripted terms aggregation': {
    aggs: { a: { terms: { script: { source: "doc['email'].value" } } } },
  },
  'a scripted metric aggregation': { aggs: { a: { avg: { script: "doc['a'].value" } } } },
  'a script in a filter beside a bucket aggregation': {
    aggs: { a: { filter: { script: { script: 'params.a - 1' } } } },
  },
  'a stored script in a query': { query: { script: { script: { id: 'reads-all' } } } },
  minimum_should_match_script: {
    query: { terms_set: { tags: { terms: ['a'], minimum_should_match_script: { source: '1' } } } },
  },
};

describe('a script that reads documents', () => {
  for (const [name, body] of Object.entries(documentScripts)) {
    test(`${name} is refused, whatever the connector allows`, () => {
      for (const bucketScripts of [false, true])
        expect(() => bind(body, bucketScripts)).toThrow('A query runs no script that reads');
    });
  }

  test('the refusal says what to use, by what the connector allows', () => {
    const body = documentScripts.script_fields ?? {};
    expect(() => bind(body, false)).toThrow('or a bucket_script with a ratio script.');
    expect(() => bind(body, true)).toThrow('or a script in a bucket_script or bucket_selector.');
  });
});

describe('the ratio scripts', () => {
  test('bind on every connector, as written', () => {
    for (const script of Object.values(searchRatioScripts)) {
      const body = over('bucket_script', script, { part: '_errors>_count', whole: '_count' });
      for (const bucketScripts of [false, true]) expect(bind(body, bucketScripts)).toEqual(body);
    }
  });

  test('need no buckets_path check of their own, as before', () => {
    const body = over('bucket_script', searchRatioScripts.ratio, null);
    for (const bucketScripts of [false, true]) expect(bind(body, bucketScripts)).toEqual(body);
  });
});

describe('a bucket script on a connector that does not allow one', () => {
  const cases: Record<string, Record<string, unknown>> = {
    'a bucket_script of its own': over('bucket_script', 'params.errors - params.warnings'),
    'a bucket_selector': over('bucket_selector', 'params.errors > 100'),
    'a ratio script as an object': over('bucket_script', { source: searchRatioScripts.ratio }),
    'a ratio script in a bucket_selector': over('bucket_selector', searchRatioScripts.ratio),
    'a stored script': over('bucket_script', { id: 'difference' }),
  };
  for (const [name, body] of Object.entries(cases)) {
    test(`${name} is refused, saying what the connector allows and who can change it`, () => {
      const refusal = () => bind(body, false);
      expect(refusal).toThrow('allows no script of the query');
      expect(refusal).toThrow('only the two ratio scripts');
      expect(refusal).toThrow('An admin can allow scripts in bucket_script and bucket_selector');
    });
  }
});

describe('a bucket script on a connector that allows one', () => {
  test('a difference of two counts binds as written', () => {
    const body = over('bucket_script', 'params.errors - params.warnings');
    expect(bind(body, true)).toEqual(body);
  });

  test('a bucket_selector that keeps the buckets above a number binds as written', () => {
    const body = over('bucket_selector', 'params.errors > 100');
    expect(bind(body, true)).toEqual(body);
  });

  test('a script as an object takes its values in params, a variable among them', () => {
    const script = {
      source: 'params.errors > params.min',
      lang: 'painless',
      params: { min: { $var: 'threshold' } },
    };
    const bound = bind(over('bucket_selector', script), true, { threshold: '100' });
    expect(bound).toEqual(
      over('bucket_selector', { ...script, params: { min: '100' } }) as typeof bound,
    );
  });

  test('takes the expressions a number of buckets is worked out with', () => {
    const sources = [
      'params.errors / (params.errors + params.warnings) * 100',
      'params.warnings > 0 ? params.errors / params.warnings : null',
      'Math.max(params.errors - params.warnings, 0)',
      'Math.round(Math.log10(params.errors + 1) * 1e2) / 100.0',
      'params.errors >= 10 && !(params.warnings == 0) || params.errors != 3',
      '-params.errors % 7',
      'params.errors > Double.parseDouble(params.min)',
    ];
    for (const source of sources)
      expect(() => bind(over('bucket_script', source), true)).not.toThrow();
  });

  test('a variable is never the script text, nor inside it', () => {
    const texts = [{ $var: 'source' }, { source: { $var: 'source' } }];
    for (const script of texts)
      expect(() => bind(over('bucket_script', script), true, { source: 'params.errors' })).toThrow(
        'holds no variable. Pass the value in "params"',
      );
  });

  test('a stored script, another key and another language are refused', () => {
    const inline = 'A stored script ("id") and any other key are refused';
    expect(() => bind(over('bucket_script', { id: 'difference' }), true)).toThrow(inline);
    const withOptions = { source: 'params.errors', options: { content_type: 'x' } };
    expect(() => bind(over('bucket_script', withOptions), true)).toThrow(inline);
    for (const lang of ['expression', 'mustache', 'java', 1])
      expect(() => bind(over('bucket_script', { source: 'params.errors', lang }), true)).toThrow(
        'A bucket script is Painless',
      );
  });

  test('a script that is not text, and params that are not an object, are refused', () => {
    for (const script of [1, null, ['params.errors'], { params: {} }, { source: 1 }])
      expect(() => bind(over('bucket_script', script), true)).toThrow('A bucket script is text');
    const listed = { source: 'params.errors', params: [1] };
    expect(() => bind(over('bucket_script', listed), true)).toThrow('is an object of values');
  });

  test(`a script longer than ${searchScriptLength} characters is refused`, () => {
    const term = 'params.errors + ';
    const longest = `${term.repeat(Math.floor((searchScriptLength - 1) / term.length))}1`;
    expect(() => bind(over('bucket_script', longest), true)).not.toThrow();
    const longer = `${term.repeat(Math.ceil(searchScriptLength / term.length))}1`;
    expect(() => bind(over('bucket_script', longer), true)).toThrow(
      `at most ${searchScriptLength} characters`,
    );
  });

  test('buckets_path is required: an object that names each path', () => {
    for (const paths of [null, {}, '_errors>_count', ['_errors>_count'], { errors: 1 }])
      for (const aggregation of ['bucket_script', 'bucket_selector'])
        expect(() => bind(over(aggregation, 'params.errors > 1', paths), true)).toThrow(
          'names the buckets its script reads in "buckets_path"',
        );
  });

  test('it is an aggregation: the same keys elsewhere are refused', () => {
    const misplaced = [
      { query: { bucket_selector: { buckets_path: { a: 'a' }, script: 'params.a > 1' } } },
      { bucket_script: { buckets_path: { a: 'a' }, script: 'params.a' } },
      {
        aggs: { a: { terms: { bucket_script: { buckets_path: { a: 'a' }, script: 'params.a' } } } },
      },
    ];
    for (const body of misplaced)
      expect(() => bind(body, true)).toThrow('is an aggregation: write it under "aggs"');
    const cased = { aggs: { a: { Bucket_Selector: { buckets_path: { a: 'a' }, script: '1' } } } };
    expect(() => bind(cased, true)).toThrow('A query runs no script that reads');
  });

  test('a script is one expression: nothing that reads, loops, allocates or calls', () => {
    const refused = [
      "doc['email'].value",
      'params._source.email',
      "params['_source']",
      'ctx',
      '_score',
      'state',
      'while (true) {}',
      'long i = 0; for (int j = 0; j < 2000000; j++) { i += j } return i',
      'def l = new ArrayList(); for (int i = 0; i < 9; i++) { l.add(new long[1000]) } return 1',
      "def s = 'aaaa'; s += s; s += s; return s.length()",
      'params.keySet().size()',
      'params.keySet ()',
      'params.errors.toString()',
      '(params.errors)(1)',
      'System.currentTimeMillis()',
      'new Date().getTime()',
      'Math.random()',
      'Math.PI',
      'Double.MAX_VALUE',
      'Double.parseDouble',
      'double f(double x) { return f(x + 1) } return f(1)',
      '/a+/.matcher("aaa").matches() ? 1 : 0',
      'Debug.explain(params)',
      'params.errors = 5',
      'x -> x',
      'return params.errors',
      'params.errors; params.warnings',
      '1L',
      '1.toString()',
      'params.errors // a comment',
      '',
      '   ',
    ];
    for (const source of refused) {
      expect(() => bind(over('bucket_script', source), true)).toThrow(
        'A bucket script is one expression',
      );
      expect(() => bind(over('bucket_selector', { source }), true)).toThrow(
        'A bucket script is one expression',
      );
    }
  });

  test('an operator stands between two values: no regex, increment, shift, elvis or comment', () => {
    const refused = [
      '/1+/ == null ? 1 : 0',
      'params.errors++ + params.errors++',
      '--params.errors',
      'params.errors--',
      'params.errors --1',
      '++params.errors',
      '1 << 62',
      'params.errors >> 1',
      'params.errors >>> 1',
      'params.errors ?: 1',
      'params.errors // 1',
      'params.errors /* 1 */',
      '1 /* 2 */ + 3',
      'params.errors +',
      '* params.errors',
      'params.errors params.warnings',
      '1 2',
      'params.errors !params.warnings',
      '()',
      'Math.abs()',
      '(params.errors',
      'params.errors)',
      ')params.errors(',
      'Math.max(params.errors,)',
    ];
    for (const source of refused)
      expect(() => bind(over('bucket_script', source), true)).toThrow(
        'A bucket script is one expression',
      );
  });

  test('a minus or a not before a value is read as a sign, after a value as an operator', () => {
    const sources = [
      'params.errors - -1',
      'params.errors * -params.warnings',
      '-(params.errors - 1)',
      '!(params.errors > 1) ? -1 : 1',
      'Math.pow(-params.errors, 2)',
      '- params.errors',
    ];
    for (const source of sources)
      expect(() => bind(over('bucket_script', source), true)).not.toThrow();
  });

  test('a variable stands only for a value inside params', () => {
    const variables = { p: '_count' };
    const paths = { buckets_path: { $var: 'p' }, script: 'params._value * 2' };
    const body = (bucket: unknown) => ({
      aggs: { a: { terms: { field: 'x' }, aggs: { value: { bucket_script: bucket } } } },
    });
    expect(() => bind(body(paths), true, variables)).toThrow('names the buckets its script reads');
    const params = { source: 'params.errors', params: { $var: 'p' } };
    expect(() => bind(over('bucket_script', params), true, variables)).toThrow(
      'is an object of values',
    );
    for (const aggregation of ['bucket_script', 'bucket_selector']) {
      const refusal = `A ${aggregation} is written out`;
      expect(() => bind(body({ $var: 'p' }), true, variables)).toThrow('is written out');
      const listed = { aggs: { a: { [aggregation]: [{ script: 'params.a' }] } } };
      expect(() => bind(listed, true)).toThrow(refusal);
      const text = { aggs: { a: { [aggregation]: 'params.a' } } };
      expect(() => bind(text, true)).toThrow(refusal);
    }
  });

  test('a long run of one token is read in linear time', () => {
    const started = performance.now();
    for (const filler of [' ', '1', '(', 'params.a']) {
      const source = `${filler.repeat(Math.floor(searchScriptLength / filler.length) - 1)}#`;
      expect(() => bind(over('bucket_script', source), true)).toThrow('one expression');
    }
    expect(performance.now() - started).toBeLessThan(500);
  });

  test('a script key under its params is still a script key', () => {
    const script = { source: 'params.errors', params: { script: { source: "doc['a']" } } };
    expect(() => bind(over('bucket_script', script), true)).toThrow(
      'A query runs no script that reads',
    );
  });
});
