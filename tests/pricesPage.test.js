var assert = require('assert');
var ejs = require('ejs');
var path = require('path');
var buildPriceUpdateRows = require('../app').buildPriceUpdateRows;

var fundSummaryRows = [{
  symbol: 'FUND:pending',
  code: 'TEST1234',
  name: 'Pending publication fund',
  assetType: 'FUND',
  assetSubType: '',
  netQty: 1
}, {
  symbol: 'FUND:failed',
  code: 'TEST5678',
  name: 'Failed fund',
  assetType: 'FUND',
  assetSubType: '',
  netQty: 1
}];
var fundAssets = {
  'FUND:pending': {
    symbol: 'FUND:pending',
    assetType: 'FUND',
    latestPrice: 12.3456,
    latestPriceDate: '2026-08-25',
    latestPriceDateBasis: 'PROVIDER_DATE',
    priceHistoryFetchStatus: 'PENDING_PUBLICATION',
    priceHistoryFetchError: ''
  },
  'FUND:failed': {
    symbol: 'FUND:failed',
    assetType: 'FUND',
    latestPrice: 23.4567,
    latestPriceDate: '2026-08-25',
    latestPriceDateBasis: 'PROVIDER_DATE',
    priceHistoryFetchStatus: 'ERROR',
    priceHistoryFetchError: 'Yahoo fund token not found'
  }
};
var fundHistoryRows = [{
  symbol: 'FUND:pending',
  source: 'YAHOO_FUND_HISTORY',
  priceDate: '2026-08-25',
  close: 123456,
  netAssetsBalance: 999999,
  sessionStatus: 'COMPLETED'
}, {
  symbol: 'FUND:failed',
  source: 'YAHOO_FUND_HISTORY',
  priceDate: '2026-08-24',
  close: 234567,
  netAssetsBalance: 999999,
  sessionStatus: 'COMPLETED'
}];
var fundCoverageRows = [{
  symbol: 'FUND:pending',
  source: 'YAHOO_FUND_HISTORY',
  startDate: '2024-08-26',
  endDate: '2026-08-25',
  status: 'COMPLETE',
  retryAfter: ''
}, {
  symbol: 'FUND:failed',
  source: 'YAHOO_FUND_HISTORY',
  startDate: '2024-08-26',
  endDate: '2026-08-24',
  status: 'COMPLETE',
  retryAfter: ''
}, {
  symbol: 'FUND:failed',
  source: 'YAHOO_FUND_HISTORY',
  startDate: '2026-08-25',
  endDate: '2026-08-25',
  status: 'FAILED',
  reason: 'FETCH_ERROR',
  error: 'Yahoo fund token not found',
  retryAfter: '2026-08-25T16:41:00.000Z'
}];
var fundRows = buildPriceUpdateRows(
  fundSummaryRows,
  fundAssets,
  fundHistoryRows,
  fundCoverageRows,
  [],
  new Date('2026-08-25T15:41:00.000Z')
);
var pendingFundRow = fundRows.filter(function (row) { return row.symbol == 'FUND:pending'; })[0];
var failedFundRow = fundRows.filter(function (row) { return row.symbol == 'FUND:failed'; })[0];
assert.strictEqual(pendingFundRow.status, 'NEEDS_UPDATE');
assert.strictEqual(pendingFundRow.pendingCount, 1);
assert.strictEqual(pendingFundRow.nextRetryAt, '');
assert.strictEqual(pendingFundRow.historyError, '');
assert.strictEqual(failedFundRow.status, 'FAILED');
assert.strictEqual(failedFundRow.pendingCount, 1);
assert.strictEqual(failedFundRow.deferredCount, 1);
assert.strictEqual(failedFundRow.nextRetryAt, '2026-08-25T16:41:00.000Z');
assert.strictEqual(failedFundRow.historyError, 'Yahoo fund token not found');

ejs.renderFile(path.join(__dirname, '..', 'views', 'prices.ejs'), {
  appVersion: '0.1.2',
  reportDate: '2026-08-05',
  message: '',
  refreshStatus: {
    status: 'COMPLETED',
    totalAssets: 1,
    processedAssets: 1,
    currentSymbol: '',
    ok: 1,
    failed: 0,
    historyRequests: 2
  },
  rows: [{
    symbol: '7203.T',
    name: 'Toyota',
    status: 'NEEDS_UPDATE',
    currentPrice: 3000,
    currentPriceDate: '2026-08-05',
    currentPriceDateBasis: 'EXCHANGE_SESSION',
    currentPriceSourceTimezone: 'Asia/Tokyo',
    firstCompletedDate: '2024-08-05',
    lastCompletedDate: '2026-08-04',
    latestSnapshotDate: '2026-08-05',
    pendingCount: 1,
    deferredCount: 0,
    sources: 'YAHOO_CHART, JQUANTS',
    lastAttemptAt: '2026-08-05T00:00:00.000Z',
    nextRetryAt: '',
    historyError: '',
    priceError: '',
    intervals: [{
      source: 'JQUANTS',
      startDate: '2024-08-05',
      endDate: '2026-03-31',
      status: 'COMPLETE',
      reason: 'SAVED_PRICE_ROW',
      attemptCount: 0,
      retryAfter: ''
    }]
  }]
}, function (err, html) {
  if (err) {
    throw err;
  }
  assert.ok(html.indexOf('Price Update') >= 0);
  assert.ok(html.indexOf('/prices/7203.T/refresh') >= 0);
  assert.ok(html.indexOf('NEEDS UPDATE') >= 0);
  assert.ok(html.indexOf('JQUANTS') >= 0);
  console.log('pricesPage tests passed');
});
