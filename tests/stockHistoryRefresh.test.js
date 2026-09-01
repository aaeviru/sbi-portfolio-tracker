var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbi-stock-history-refresh-'));
process.env.SBI_PORTFOLIO_DB_PATH = path.join(tmpDir, 'test.sqlite');

var app = require('../app');
var withDb = require('../lib/db').withDb;

function openDb() {
  return new Promise(function (resolve, reject) {
    withDb(function (err, db, close) {
      if (err) reject(err);
      else resolve({ db: db, close: close });
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

function updateOne(collection, filter, update, options) {
  return new Promise(function (resolve, reject) {
    collection.updateOne(filter, update, options || {}, function (err, result) {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function fetchHistory(asset, startDate, endDate, options) {
  return new Promise(function (resolve, reject) {
    app.fetchYahooChartDailyPriceHistory(asset, startDate, endDate, options, function (err, rows) {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function makeYahooBoundaryAdapter() {
  return {
    fetchText: function (url, callback) {
      var parsed = new URL(url);
      var requestedStart = new Date(Number(parsed.searchParams.get('period1')) * 1000);
      var includesLookback = requestedStart.toISOString() == '2026-08-27T00:00:00.000Z';
      var timestamp = Date.parse('2026-08-28T13:30:00.000Z') / 1000;
      var result = {
        meta: {
          exchangeTimezoneName: 'America/New_York',
          currentTradingPeriod: {
            regular: { end: Date.parse('2026-08-31T20:00:00.000Z') / 1000 }
          }
        },
        timestamp: includesLookback ? [timestamp] : [],
        indicators: {
          quote: [{ close: includesLookback ? [164.25] : [] }]
        }
      };
      callback(null, JSON.stringify({ chart: { result: [result] } }));
    }
  };
}

async function main() {
  var rows = await fetchHistory(
    { symbol: 'AMD', assetType: 'US_STOCK' },
    '2026-08-28',
    '2026-08-28',
    makeYahooBoundaryAdapter()
  );

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].priceDate, '2026-08-28');
  assert.strictEqual(rows[0].close, 164.25);

  var opened = await openDb();
  var emptyFetchCount = 0;
  var fundAsset = {
    symbol: 'FUND:empty-retry',
    name: 'Empty retry fund',
    assetType: 'FUND',
    assetSubType: '',
    latestPriceDate: '2026-08-25',
    latestPriceDateBasis: 'PROVIDER_DATE',
    priceHistoryStartDate: '2026-08-24',
    priceHistoryCoverageVersion: 1
  };
  await updateOne(opened.db.collection('assets'), { symbol: fundAsset.symbol }, { $set: fundAsset }, { upsert: true });

  var budget = {
    remaining: 5,
    deadline: Date.parse('2026-08-25T16:00:00.000Z'),
    requests: 0,
    forceRetry: true
  };
  var emptyResult = await refreshHistory(opened.db, fundAsset, {
    now: new Date('2026-08-25T15:41:00.000Z'),
    budget: budget,
    yahooFundProvider: {
      fetchPriceHistory: function (asset, startDate, endDate, callback) {
        emptyFetchCount++;
        callback(null, [{
          symbol: asset.symbol,
          assetType: 'FUND',
          priceDate: '2026-08-24',
          currency: 'JPY',
          open: 100000,
          high: 100000,
          low: 100000,
          close: 100000,
          volume: null,
          netAssetsBalance: 1,
          source: 'YAHOO_FUND_HISTORY',
          sessionStatus: 'COMPLETED',
          status: 'OK',
          error: ''
        }]);
      }
    }
  });
  opened.close();

  assert.strictEqual(emptyFetchCount, 1);
  assert.strictEqual(budget.requests, 1);
  assert.strictEqual(emptyResult.reason, 'RETRY_SCHEDULED');

  console.log('stockHistoryRefresh tests passed');
}

main().catch(function (err) {
  console.error(err);
  process.exitCode = 1;
});
