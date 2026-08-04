var assert = require('assert');
var ejs = require('ejs');
var path = require('path');

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
