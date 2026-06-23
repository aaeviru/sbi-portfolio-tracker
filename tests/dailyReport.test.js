var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbi-daily-report-'));
process.env.SBI_PORTFOLIO_DB_PATH = path.join(tmpDir, 'test.sqlite');

var withDb = require('../lib/db').withDb;
var buildSnapshotFromData = require('../lib/dailyReport').buildSnapshotFromData;
var buildChatGptReportPrompt = require('../lib/openaiReport').buildChatGptReportPrompt;
var buildChineseChatGptReportPrompt = require('../lib/openaiReport').buildChineseChatGptReportPrompt;
var buildJapaneseChatGptReportPrompt = require('../lib/openaiReport').buildJapaneseChatGptReportPrompt;

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
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

function toArray(cursor) {
  return new Promise(function (resolve, reject) {
    cursor.toArray(function (err, rows) {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

function findOne(collection, filter) {
  return new Promise(function (resolve, reject) {
    collection.findOne(filter, function (err, row) {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

async function main() {
  var transactions = [{
    source: 'SBI',
    sourceHash: 'buy-7974',
    tradeDateTime: '2026-06-20',
    symbol: '7974.T',
    code: '7974',
    assetName: 'Nintendo',
    assetType: 'STOCK',
    side: 'BUY',
    quantity: 100,
    settlementAmount: 1000000
  }, {
    source: 'SBI',
    sourceHash: 'buy-fund',
    tradeDateTime: '2026-06-21',
    symbol: 'FUND:TOPIX',
    assetName: 'TOPIX Fund',
    assetType: 'FUND',
    side: 'BUY',
    quantity: 10000,
    settlementAmount: 100000
  }];

  var assetsBySymbol = {
    '7974.T': {
      symbol: '7974.T',
      assetType: 'STOCK',
      latestPrice: 11000,
      latestPriceDate: '2026-06-22'
    },
    'FUND:TOPIX': {
      symbol: 'FUND:TOPIX',
      assetType: 'FUND',
      latestPrice: 11,
      latestPriceDate: '2026-06-22'
    }
  };

  var snapshot = buildSnapshotFromData('2026-06-23', transactions, null, assetsBySymbol, [{
    symbol: '7974.T',
    priceDate: '2026-06-21',
    close: 10000,
    source: 'YAHOO_CHART'
  }, {
    symbol: 'FUND:TOPIX',
    assetType: 'FUND',
    priceDate: '2026-06-21',
    close: 100000,
    source: 'YAHOO_FUND_HISTORY',
    netAssetsBalance: 1000
  }], [{
    pair: '米ドル-円',
    realizedPl: 1200,
    realizedSwap: 50,
    totalPl: 1250
  }]);

  assert.strictEqual(snapshot.reportDate, '2026-06-23');
  assert.strictEqual(snapshot.activeHoldingCount, 2);
  assert.strictEqual(snapshot.topHoldings[0].symbol, '7974.T');
  assert.ok(snapshot.watchTopics.indexOf('USD JPY exchange rate') >= 0);
  assert.ok(snapshot.allocation.some(function (row) { return row.assetClass == '日本株'; }));
  assert.ok(snapshot.allocation.some(function (row) { return row.assetClass == '投資信託'; }));

  var prompt = buildChatGptReportPrompt(snapshot);
  assert.ok(prompt.indexOf('Portfolio snapshot JSON:') >= 0);
  assert.ok(prompt.indexOf('"7974.T"') >= 0);
  assert.ok(prompt.indexOf('Do not provide buy/sell instructions') >= 0);
  var promptCn = buildChineseChatGptReportPrompt(snapshot);
  assert.ok(promptCn.indexOf('投资组合快照 JSON') >= 0);
  assert.ok(promptCn.indexOf('JPY') >= 0);
  assert.ok(promptCn.indexOf('"7974.T"') >= 0);
  var promptJa = buildJapaneseChatGptReportPrompt(snapshot);
  assert.ok(promptJa.indexOf('ポートフォリオ・スナップショット JSON') >= 0);
  assert.ok(promptJa.indexOf('JPY') >= 0);
  assert.ok(promptJa.indexOf('"7974.T"') >= 0);

  var opened = await openDb();
  var reports = opened.db.collection('dailyReports');
  await updateOne(reports, { reportDate: '2026-06-22' }, { $set: {
    reportDate: '2026-06-22',
    createdAt: '2026-06-22T00:00:00.000Z',
    markdown: 'older'
  } }, { upsert: true });
  await updateOne(reports, { reportDate: '2026-06-23' }, { $set: {
    reportDate: '2026-06-23',
    createdAt: '2026-06-23T00:00:00.000Z',
    markdown: 'latest',
    snapshot: snapshot
  } }, { upsert: true });

  var latest = await toArray(reports.find().sort({ reportDate: -1 }).limit(1));
  assert.strictEqual(latest.length, 1);
  assert.strictEqual(latest[0].markdown, 'latest');
  var saved = await findOne(reports, { reportDate: '2026-06-23' });
  assert.strictEqual(saved.snapshot.activeHoldingCount, 2);

  opened.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('dailyReport tests passed');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
