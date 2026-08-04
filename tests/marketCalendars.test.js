var assert = require('assert');
var calendars = require('../lib/marketCalendars');

assert.strictEqual(calendars.isJpxSession('2026-01-01'), false);
assert.strictEqual(calendars.isJpxSession('2026-01-02'), false);
assert.strictEqual(calendars.isJpxSession('2026-01-05'), true);
assert.strictEqual(calendars.isJpxSession('2026-02-11'), false);
assert.strictEqual(calendars.isJpxSession('2026-02-12'), true);

assert.strictEqual(calendars.isUsEquitySession('2026-01-01'), false);
assert.strictEqual(calendars.isUsEquitySession('2026-01-02'), true);
assert.strictEqual(calendars.isUsEquitySession('2026-04-03'), false);
assert.strictEqual(calendars.isUsEquitySession('2026-04-06'), true);
assert.strictEqual(calendars.isUsEquitySession('2025-01-09'), false);

assert.deepStrictEqual(
  calendars.getExpectedDates({ assetType: 'STOCK' }, 'JQUANTS', '2026-02-09', '2026-02-13'),
  ['2026-02-09', '2026-02-10', '2026-02-12', '2026-02-13']
);
assert.deepStrictEqual(
  calendars.getExpectedDates({ assetType: 'US_STOCK' }, 'YAHOO_CHART', '2026-04-02', '2026-04-06'),
  ['2026-04-02', '2026-04-06']
);

console.log('marketCalendars tests passed');
