var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbi-fund-refresh-'));
process.env.SBI_PORTFOLIO_DB_PATH = path.join(tmpDir, 'test.sqlite');

var withDb = require('../lib/db').withDb;
var app = require('../app');
var historyCoverage = require('../lib/historyCoverage');

function openDb() {
  return new Promise(function (resolve, reject) {
    withDb(function (err, db, close) {
      if (err) {
        reject(err);
      } else {
        resolve({ db: db, close: close });
      }
    });
  });
}

function updateOne(collection, filter, update, options) {
  return new Promise(function (resolve, reject) {
    collection.updateOne(filter, update, options || {}, function (err, result) {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function findOne(collection, filter) {
  return new Promise(function (resolve, reject) {
    collection.findOne(filter, function (err, row) {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function toArray(cursor) {
  return new Promise(function (resolve, reject) {
    cursor.toArray(function (err, rows) {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function refreshPrice(db, asset, options) {
  return new Promise(function (resolve, reject) {
    app.refreshAssetPrice(db, asset, options, function (err, result) {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function refreshHistory(db, asset, options) {
  return new Promise(function (resolve, reject) {
    app.refreshAssetPriceHistory(db, asset, options, function (err, result) {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function makeFundHistoryRow(symbol, priceDate, close) {
  return {
    symbol: symbol,
    assetType: 'FUND',
    priceDate: priceDate,
    currency: 'JPY',
    open: close,
    high: close,
    low: close,
    close: close,
    volume: null,
    netAssetsBalance: 999999,
    source: 'YAHOO_FUND_HISTORY',
    sourceTimezone: 'Asia/Tokyo',
    dateBasis: 'PROVIDER_DATE',
    sessionStatus: 'COMPLETED',
    status: 'OK',
    error: ''
  };
}

async function main() {
  var page = [
    '<div>投資信託</div><div>TEST1234</div><div>123,456</div><div>前日比 +100</div>',
    '<script>self.__next_f.push([1,"{\\"priceBoard\\":{\\"value\\":\\"123,456\\",\\"updateDate\\":\\"8/25\\"},\\"jwtToken\\":\\"synthetic.header.signature\\"}"])</script>'
  ].join('');
  var provider = app.createYahooFundProvider({
    fetchFundPage: function (fundCode, callback) {
      callback(null, page);
    },
    fetchFundHistoryPage: function (request, callback) {
      if (request.endDate != '2026-08-25') {
        callback(new Error('Requested unpublished fund date ' + request.endDate));
        return;
      }
      callback(null, JSON.stringify({
        histories: [{
          date: '2026年8月25日',
          price: '123,456',
          priceChange: '100',
          netAssetsBalance: '999,999'
        }],
        paging: { hasNext: false, totalPage: 1 }
      }));
    }
  });
  var asset = {
    symbol: 'FUND:synthetic',
    name: 'Synthetic fund',
    assetType: 'FUND',
    assetSubType: '',
    priceSourceUrl: 'https://finance.yahoo.co.jp/quote/TEST1234',
    priceHistoryCoverageVersion: 1,
    priceHistoryStartDate: '2026-08-25'
  };
  var opened = await openDb();
  await updateOne(opened.db.collection('assets'), { symbol: asset.symbol }, { $set: asset }, { upsert: true });
  var priorCoverage = {
    coverageKey: 'FUND%3Asynthetic|YAHOO_FUND_HISTORY|COMPLETE|2024-08-26|2026-08-24',
    symbol: asset.symbol,
    source: 'YAHOO_FUND_HISTORY',
    startDate: '2024-08-26',
    endDate: '2026-08-24',
    status: 'COMPLETE',
    reason: 'SAVED_PRICE_ROW',
    expectedCount: 486,
    receivedCount: 486,
    calendarId: 'JP_FUND_PUBLICATION'
  };
  await updateOne(opened.db.collection('priceHistoryCoverage'), { coverageKey: priorCoverage.coverageKey }, { $set: priorCoverage }, { upsert: true });
  var priorHistoryRow = makeFundHistoryRow(asset.symbol, '2026-08-24', 120000);
  await updateOne(
    opened.db.collection('priceHistory'),
    { symbol: priorHistoryRow.symbol, priceDate: priorHistoryRow.priceDate, source: priorHistoryRow.source },
    { $set: priorHistoryRow },
    { upsert: true }
  );
  var options = {
    yahooFundProvider: provider,
    now: new Date('2026-08-25T15:41:00.000Z'),
    budget: { remaining: 5, deadline: Date.parse('2026-08-25T15:51:00.000Z'), requests: 0 }
  };

  await refreshPrice(opened.db, asset, options);
  var result = await refreshHistory(opened.db, asset, options);
  var stored = await findOne(opened.db.collection('assets'), { symbol: asset.symbol });
  var intervals = await toArray(opened.db.collection('priceHistoryCoverage').find({ symbol: asset.symbol }));
  var storedHistoryRows = await toArray(opened.db.collection('priceHistory').find({ symbol: asset.symbol }));
  storedHistoryRows.sort(function (a, b) { return a.priceDate.localeCompare(b.priceDate); });

  assert.strictEqual(stored.latestPrice, 12.3456);
  assert.strictEqual(stored.latestPriceDate, '2026-08-25');
  assert.strictEqual(stored.latestPriceDateBasis, 'PROVIDER_DATE');
  assert.strictEqual(stored.priceHistoryFetchStatus, 'PENDING_PUBLICATION');
  assert.strictEqual(stored.priceHistoryPendingSessions, 1);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, 'PENDING_PUBLICATION');
  assert.strictEqual(result.pendingSessions, 1);
  assert.strictEqual(app.countFailedAssetRefreshes([result]), 0);
  assert.strictEqual(intervals.length, 2);
  assert.strictEqual(intervals.every(function (interval) { return interval.status == 'COMPLETE'; }), true);
  assert.strictEqual(intervals.some(function (interval) { return interval.endDate == '2026-08-25'; }), true);
  assert.strictEqual(intervals.some(function (interval) { return interval.startDate == '2024-08-26'; }), true);
  assert.deepStrictEqual(
    storedHistoryRows.map(function (row) { return [row.priceDate, row.close]; }),
    [['2026-08-24', 120000], ['2026-08-25', 123456]]
  );

  var ordinaryPage = [
    '<div>投資信託</div><div>TEST1234</div><div>123,456</div><div>前日比 +100</div>',
    '<script>{"priceBoard":{"value":"123,456","updateDate":"8/25"},"jwtToken":"synthetic.ordinary.signature"}</script>'
  ].join('');
  var ordinaryProvider = app.createYahooFundProvider({
    fetchFundPage: function (fundCode, callback) {
      callback(null, ordinaryPage);
    },
    fetchFundHistoryPage: function (request, callback) {
      if (request.token != 'synthetic.ordinary.signature' || request.endDate != '2026-08-25') {
        callback(new Error('Unexpected ordinary token request'));
        return;
      }
      callback(null, JSON.stringify({
        histories: [{
          date: '2026年8月25日',
          price: '123,456',
          priceChange: '100',
          netAssetsBalance: '999,999'
        }],
        paging: { hasNext: false, totalPage: 1 }
      }));
    }
  });
  var ordinaryAsset = Object.assign({}, asset, {
    symbol: 'FUND:ordinary',
    name: 'Synthetic ordinary fund',
    latestPrice: null,
    latestPriceDate: '',
    latestPriceDateBasis: ''
  });
  var ordinaryCoverage = Object.assign({}, priorCoverage, {
    coverageKey: 'FUND%3Aordinary|YAHOO_FUND_HISTORY|COMPLETE|2024-08-26|2026-08-24',
    symbol: ordinaryAsset.symbol
  });
  await updateOne(opened.db.collection('assets'), { symbol: ordinaryAsset.symbol }, { $set: ordinaryAsset }, { upsert: true });
  await updateOne(opened.db.collection('priceHistoryCoverage'), { coverageKey: ordinaryCoverage.coverageKey }, { $set: ordinaryCoverage }, { upsert: true });
  var ordinaryOptions = Object.assign({}, options, {
    yahooFundProvider: ordinaryProvider,
    budget: { remaining: 5, deadline: Date.parse('2026-08-25T15:51:00.000Z'), requests: 0 }
  });
  await refreshPrice(opened.db, ordinaryAsset, ordinaryOptions);
  var ordinaryResult = await refreshHistory(opened.db, ordinaryAsset, ordinaryOptions);
  var storedOrdinary = await findOne(opened.db.collection('assets'), { symbol: ordinaryAsset.symbol });
  var ordinaryHistoryRows = await toArray(opened.db.collection('priceHistory').find({ symbol: ordinaryAsset.symbol }));
  assert.strictEqual(ordinaryResult.ok, true);
  assert.strictEqual(ordinaryResult.reason, 'PENDING_PUBLICATION');
  assert.strictEqual(storedOrdinary.latestPriceDate, '2026-08-25');
  assert.strictEqual(storedOrdinary.priceHistoryFetchStatus, 'PENDING_PUBLICATION');
  assert.strictEqual(storedOrdinary.priceHistoryPendingSessions, 1);
  assert.strictEqual(ordinaryHistoryRows.length, 1);
  assert.strictEqual(ordinaryHistoryRows[0].priceDate, '2026-08-25');
  assert.strictEqual(ordinaryHistoryRows[0].close, 123456);

  var historyFallbackProvider = app.createYahooFundProvider({
    fetchFundPage: function (fundCode, callback) {
      callback(null, [
        '<script>{"priceBoard":{"updateDate":"8/25"},"jwtToken":"synthetic.fallback.signature"}</script>'
      ].join(''));
    },
    fetchFundHistoryPage: function (request, callback) {
      if (request.endDate != '2026-08-25') {
        callback(new Error('Current-price fallback requested an unpublished date'));
        return;
      }
      callback(null, JSON.stringify({
        histories: [{
          date: '2026年8月25日',
          price: '123,456',
          priceChange: '100',
          netAssetsBalance: '999,999'
        }],
        paging: { hasNext: false, totalPage: 1 }
      }));
    }
  });
  var historyFallbackAsset = Object.assign({}, asset, {
    symbol: 'FUND:history-fallback',
    name: 'Synthetic history fallback fund',
    latestPrice: null,
    latestPriceDate: '',
    latestPriceDateBasis: ''
  });
  await updateOne(opened.db.collection('assets'), { symbol: historyFallbackAsset.symbol }, { $set: historyFallbackAsset }, { upsert: true });
  var fallbackPriceResult = await refreshPrice(opened.db, historyFallbackAsset, {
    yahooFundProvider: historyFallbackProvider,
    now: new Date('2026-08-25T15:41:00.000Z')
  });
  var storedHistoryFallback = await findOne(opened.db.collection('assets'), { symbol: historyFallbackAsset.symbol });
  assert.strictEqual(fallbackPriceResult.ok, true);
  assert.strictEqual(storedHistoryFallback.latestPrice, 12.3456);
  assert.strictEqual(storedHistoryFallback.latestPriceDate, '2026-08-25');
  assert.strictEqual(storedHistoryFallback.latestPriceDateBasis, 'PROVIDER_DATE');

  var tokenlessPage = [
    '<div>投資信託</div><div>TEST1234</div><div>123,456</div><div>前日比 +100</div>',
    '<script>{"priceBoard":{"value":"123,456","updateDate":"8/25"}}</script>'
  ].join('');
  var tokenlessProvider = app.createYahooFundProvider({
    fetchFundPage: function (fundCode, callback) {
      callback(null, tokenlessPage);
    },
    fetchFundHistoryPage: function (request, callback) {
      callback(new Error('History request must not be sent'));
    }
  });
  var retryAsset = Object.assign({}, asset, {
    symbol: 'FUND:retry',
    name: 'Synthetic retry fund',
    latestPrice: null,
    latestPriceDate: '',
    latestPriceDateBasis: ''
  });
  var retryCoverage = Object.assign({}, priorCoverage, {
    coverageKey: 'FUND%3Aretry|YAHOO_FUND_HISTORY|COMPLETE|2024-08-26|2026-08-24',
    symbol: retryAsset.symbol
  });
  await updateOne(opened.db.collection('assets'), { symbol: retryAsset.symbol }, { $set: retryAsset }, { upsert: true });
  await updateOne(opened.db.collection('priceHistoryCoverage'), { coverageKey: retryCoverage.coverageKey }, { $set: retryCoverage }, { upsert: true });
  var retryPriorHistoryRow = makeFundHistoryRow(retryAsset.symbol, '2026-08-24', 110000);
  await updateOne(
    opened.db.collection('priceHistory'),
    { symbol: retryPriorHistoryRow.symbol, priceDate: retryPriorHistoryRow.priceDate, source: retryPriorHistoryRow.source },
    { $set: retryPriorHistoryRow },
    { upsert: true }
  );

  var failedOptions = {
    yahooFundProvider: tokenlessProvider,
    now: new Date('2026-08-25T15:41:00.000Z'),
    budget: { remaining: 5, deadline: Date.parse('2026-08-25T15:51:00.000Z'), requests: 0 }
  };
  await refreshPrice(opened.db, retryAsset, failedOptions);
  var failedResult = await refreshHistory(opened.db, retryAsset, failedOptions);
  var failedAsset = await findOne(opened.db.collection('assets'), { symbol: retryAsset.symbol });
  var failedIntervals = await toArray(opened.db.collection('priceHistoryCoverage').find({ symbol: retryAsset.symbol }));
  var failedHistoryRows = await toArray(opened.db.collection('priceHistory').find({ symbol: retryAsset.symbol }));
  var failedInterval = failedIntervals.filter(function (interval) { return interval.status == 'FAILED'; })[0];

  assert.strictEqual(failedResult.ok, false);
  assert.strictEqual(failedAsset.priceHistoryFetchStatus, 'ERROR');
  assert.strictEqual(failedAsset.priceHistoryFetchError, 'Yahoo fund token not found');
  assert.strictEqual(failedAsset.priceHistoryPendingSessions, 2);
  assert.ok(failedInterval);
  assert.strictEqual(failedInterval.startDate, '2026-08-25');
  assert.strictEqual(failedInterval.retryAfter, '2026-08-25T16:41:00.000Z');
  assert.strictEqual(JSON.stringify(failedIntervals).indexOf('synthetic.header.signature'), -1);
  assert.strictEqual(failedHistoryRows.length, 1);
  assert.strictEqual(failedHistoryRows[0].priceDate, '2026-08-24');
  assert.strictEqual(failedHistoryRows[0].close, 110000);

  var retryResult = await refreshHistory(opened.db, retryAsset, {
    yahooFundProvider: provider,
    now: new Date('2026-08-25T15:42:00.000Z'),
    budget: {
      remaining: 5,
      deadline: Date.parse('2026-08-25T15:52:00.000Z'),
      requests: 0,
      forceRetry: true
    }
  });
  var recoveredAsset = await findOne(opened.db.collection('assets'), { symbol: retryAsset.symbol });
  var recoveredIntervals = await toArray(opened.db.collection('priceHistoryCoverage').find({ symbol: retryAsset.symbol }));
  var recoveredHistoryRows = await toArray(opened.db.collection('priceHistory').find({ symbol: retryAsset.symbol }));
  recoveredHistoryRows.sort(function (a, b) { return a.priceDate.localeCompare(b.priceDate); });

  assert.strictEqual(retryResult.ok, true);
  assert.strictEqual(retryResult.reason, 'PENDING_PUBLICATION');
  assert.strictEqual(recoveredAsset.priceHistoryFetchStatus, 'PENDING_PUBLICATION');
  assert.strictEqual(recoveredAsset.priceHistoryFetchError, '');
  assert.strictEqual(recoveredAsset.priceHistoryPendingSessions, 1);
  assert.strictEqual(app.countFailedAssetRefreshes([retryResult]), 0);
  assert.strictEqual(recoveredIntervals.length, 2);
  assert.strictEqual(recoveredIntervals.every(function (interval) { return interval.status == 'COMPLETE'; }), true);
  assert.strictEqual(recoveredIntervals.some(function (interval) { return interval.startDate == '2024-08-26'; }), true);
  assert.deepStrictEqual(
    recoveredHistoryRows.map(function (row) { return [row.priceDate, row.close]; }),
    [['2026-08-24', 110000], ['2026-08-25', 123456]]
  );

  var staleAsset = Object.assign({}, asset, {
    symbol: 'FUND:stale-failure',
    name: 'Synthetic stale failure fund',
    priceHistoryFetchStatus: 'ERROR',
    latestPriceDate: '2026-08-26',
    latestPriceDateBasis: 'FETCH_DATE_ESTIMATE',
    priceHistoryFetchError: 'Yahoo fund token not found'
  });
  await updateOne(opened.db.collection('assets'), { symbol: staleAsset.symbol }, { $set: staleAsset }, { upsert: true });
  var staleHistoryRow = makeFundHistoryRow(staleAsset.symbol, '2026-08-25', 123456);
  await updateOne(
    opened.db.collection('priceHistory'),
    { symbol: staleHistoryRow.symbol, priceDate: staleHistoryRow.priceDate, source: staleHistoryRow.source },
    { $set: staleHistoryRow },
    { upsert: true }
  );
  var staleCompleteInterval = historyCoverage.makeIntervalsForDates(
    staleAsset,
    'YAHOO_FUND_HISTORY',
    staleAsset.symbol,
    ['2026-08-25'],
    { status: 'COMPLETE', reason: 'PROVIDER_ROW' }
  )[0];
  staleCompleteInterval.startDate = '2024-08-26';
  staleCompleteInterval.coverageKey = historyCoverage.makeCoverageKey(staleCompleteInterval);
  var staleFailedInterval = historyCoverage.makeIntervalsForDates(
    staleAsset,
    'YAHOO_FUND_HISTORY',
    staleAsset.symbol,
    ['2026-08-26'],
    {
      status: 'FAILED',
      reason: 'FETCH_ERROR',
      error: 'Yahoo fund token not found',
      attemptCount: 1,
      lastAttemptAt: '2026-08-25T15:41:00.000Z',
      retryAfter: '2026-08-25T16:41:00.000Z',
      receivedCount: 0
    }
  )[0];
  await updateOne(
    opened.db.collection('priceHistoryCoverage'),
    { coverageKey: staleCompleteInterval.coverageKey },
    { $set: staleCompleteInterval },
    { upsert: true }
  );
  await updateOne(
    opened.db.collection('priceHistoryCoverage'),
    { coverageKey: staleFailedInterval.coverageKey },
    { $set: staleFailedInterval },
    { upsert: true }
  );

  var staleProviderCalled = false;
  var staleResult = await refreshHistory(opened.db, staleAsset, {
    yahooFundProvider: {
      fetchPriceHistory: function (requestAsset, startDate, endDate, callback) {
        staleProviderCalled = true;
        callback(new Error('Stale interval should be outside the publication range'));
      }
    },
    now: new Date('2026-08-25T15:42:00.000Z'),
    budget: { remaining: 5, deadline: Date.parse('2026-08-25T15:52:00.000Z'), requests: 0 }
  });
  var reconciledAsset = await findOne(opened.db.collection('assets'), { symbol: staleAsset.symbol });
  var reconciledIntervals = await toArray(opened.db.collection('priceHistoryCoverage').find({ symbol: staleAsset.symbol }));

  assert.strictEqual(staleProviderCalled, false);
  assert.strictEqual(staleResult.ok, true);
  assert.strictEqual(staleResult.reason, 'PENDING_PUBLICATION');
  assert.strictEqual(reconciledAsset.priceHistoryFetchStatus, 'PENDING_PUBLICATION');
  assert.strictEqual(reconciledAsset.priceHistoryFetchError, '');
  assert.strictEqual(reconciledIntervals.some(function (interval) { return interval.status == 'FAILED'; }), false);

  opened.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('fundRefresh tests passed');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
