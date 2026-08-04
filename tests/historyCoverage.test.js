var assert = require('assert');
var coverage = require('../lib/historyCoverage');

var jpAsset = { symbol: '7203.T', assetType: 'STOCK' };
var sourceRanges = [{ source: 'JQUANTS', startDate: '2026-02-09', endDate: '2026-02-13' }];
var rowsWithHole = [
  { symbol: '7203.T', source: 'JQUANTS', priceDate: '2026-02-09', close: 100, sessionStatus: 'COMPLETED' },
  { symbol: '7203.T', source: 'JQUANTS', priceDate: '2026-02-10', close: 101, sessionStatus: 'COMPLETED' },
  { symbol: '7203.T', source: 'JQUANTS', priceDate: '2026-02-13', close: 103, sessionStatus: 'COMPLETED' }
];

var windows = coverage.buildPendingWindows({
  asset: jpAsset,
  sourceRanges: sourceRanges,
  rows: rowsWithHole,
  intervals: [],
  nowText: '2026-08-05T00:00:00.000Z'
});
assert.strictEqual(windows.length, 1);
assert.deepStrictEqual(windows[0].expectedDates, ['2026-02-12']);
assert.strictEqual(windows[0].reason, 'GAP');

var classified = coverage.classifyAttempt({
  asset: jpAsset,
  window: windows[0],
  rows: [],
  allRows: rowsWithHole,
  intervals: [],
  now: new Date('2026-08-05T00:00:00.000Z')
});
assert.strictEqual(classified.length, 1);
assert.strictEqual(classified[0].status, 'FAILED');
assert.strictEqual(classified[0].reason, 'EMPTY_RESPONSE');

var deferred = coverage.buildPendingWindows({
  asset: jpAsset,
  sourceRanges: sourceRanges,
  rows: rowsWithHole,
  intervals: classified,
  nowText: '2026-08-05T00:30:00.000Z'
});
assert.strictEqual(deferred.length, 0);
assert.strictEqual(deferred.deferredCount, 1);

var completed = coverage.classifyAttempt({
  asset: jpAsset,
  window: windows[0],
  rows: [{ symbol: '7203.T', source: 'JQUANTS', priceDate: '2026-02-12', close: 102, sessionStatus: 'COMPLETED' }],
  allRows: rowsWithHole,
  intervals: classified,
  now: new Date('2026-08-05T03:00:00.000Z')
});
assert.strictEqual(completed.length, 1);
assert.strictEqual(completed[0].status, 'COMPLETE');

var oldWindow = {
  source: 'JQUANTS',
  startDate: '2024-01-04',
  endDate: '2024-01-05',
  expectedDates: ['2024-01-04', '2024-01-05']
};
var noData = coverage.classifyAttempt({
  asset: jpAsset,
  window: oldWindow,
  rows: [],
  allRows: rowsWithHole,
  intervals: [],
  now: new Date('2026-08-05T00:00:00.000Z')
});
assert.strictEqual(noData.length, 1);
assert.strictEqual(noData[0].status, 'NO_DATA');
assert.strictEqual(noData[0].reason, 'BEFORE_FIRST_AVAILABLE_PRICE');

var forbiddenBeforeListing = coverage.classifyAttempt({
  asset: jpAsset,
  window: oldWindow,
  rows: [],
  allRows: rowsWithHole,
  intervals: [],
  now: new Date('2026-08-05T00:00:00.000Z'),
  error: 'HTTP 403'
});
assert.strictEqual(forbiddenBeforeListing[0].status, 'NO_DATA');
assert.strictEqual(forbiddenBeforeListing[0].retryAfter, '');

var snapshotOnly = coverage.summarizeCoverage(
  { symbol: 'MCD', assetType: 'US_STOCK' },
  [{ source: 'YAHOO_CHART', startDate: '2026-08-03', endDate: '2026-08-04' }],
  [{ symbol: 'MCD', source: 'YAHOO_CHART_SNAPSHOT', priceDate: '2026-08-04', close: 300, sessionStatus: 'SNAPSHOT' }],
  [],
  '2026-08-05T00:00:00.000Z'
);
assert.strictEqual(snapshotOnly.latestSnapshotDate, '2026-08-04');
assert.ok(snapshotOnly.pendingCount > 0);

var invalidCloseWindows = coverage.buildPendingWindows({
  asset: { symbol: 'GOLD_JPY', assetType: 'GOLD' },
  sourceRanges: [{ source: 'YAHOO_GOLD_HISTORY', startDate: '2026-08-03', endDate: '2026-08-03' }],
  rows: [{ symbol: 'GOLD_JPY', source: 'YAHOO_GOLD_HISTORY', priceDate: '2026-08-03', close: null, sessionStatus: 'COMPLETED' }],
  intervals: [],
  nowText: '2026-08-05T00:00:00.000Z'
});
assert.strictEqual(invalidCloseWindows.length, 1);

var movedBoundaryWindows = coverage.buildPendingWindows({
  asset: jpAsset,
  sourceRanges: [{ source: 'JQUANTS', startDate: '2026-02-12', endDate: '2026-02-12' }],
  rows: [{ symbol: '7203.T', source: 'YAHOO_CHART', priceDate: '2026-02-12', close: 102, sessionStatus: 'COMPLETED' }],
  intervals: [],
  nowText: '2026-08-05T00:00:00.000Z'
});
assert.strictEqual(movedBoundaryWindows.length, 0);

var disjointWindows = coverage.buildPendingWindows({
  asset: jpAsset,
  sourceRanges: [{ source: 'JQUANTS', startDate: '2026-02-09', endDate: '2026-02-20' }],
  rows: [
    { symbol: '7203.T', source: 'JQUANTS', priceDate: '2026-02-10', close: 101, sessionStatus: 'COMPLETED' },
    { symbol: '7203.T', source: 'JQUANTS', priceDate: '2026-02-13', close: 103, sessionStatus: 'COMPLETED' },
    { symbol: '7203.T', source: 'JQUANTS', priceDate: '2026-02-19', close: 106, sessionStatus: 'COMPLETED' }
  ],
  intervals: [],
  nowText: '2026-08-05T00:00:00.000Z'
});
assert.ok(disjointWindows.length >= 3);
assert.strictEqual(disjointWindows[0].endDate, '2026-02-20');

console.log('historyCoverage tests passed');
