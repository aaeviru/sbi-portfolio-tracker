var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbi-portfolio-sqlite-'));
process.env.SBI_LOCAL_ONLY = 'true';
process.env.SBI_PORTFOLIO_DB_PATH = path.join(tmpDir, 'test.sqlite');

var withDb = require('../lib/db').withDb;
var upsertPriceHistoryRows = require('../app').upsertPriceHistoryRows;

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

function bulkWrite(collection, updates) {
  return new Promise(function (resolve, reject) {
    collection.bulkWrite(updates, { ordered: false }, function (err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

function countDocuments(collection) {
  return new Promise(function (resolve, reject) {
    collection.countDocuments(function (err, total) {
      if (err) {
        reject(err);
      } else {
        resolve(total);
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

function deleteMany(collection, filter) {
  return new Promise(function (resolve, reject) {
    collection.deleteMany(filter, function (err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

function upsertHistoryRows(db, rows) {
  return new Promise(function (resolve, reject) {
    upsertPriceHistoryRows(db, rows, function (err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

async function main() {
  var opened = await openDb();
  var db = opened.db;

  var tx = {
    source: 'SBI',
    sourceHash: 'same-row',
    tradeDateTime: '2026-01-02T09:00:00',
    symbol: '7974.T',
    assetName: '任天堂',
    assetType: 'STOCK',
    side: 'BUY',
    quantity: 100,
    settlementAmount: 100000
  };

  var txs = db.collection('transactions');
  var firstTx = await updateOne(txs, { source: tx.source, sourceHash: tx.sourceHash }, { $set: tx }, { upsert: true });
  var secondTx = await updateOne(txs, { source: tx.source, sourceHash: tx.sourceHash }, { $set: Object.assign({}, tx, { settlementAmount: 120000 }) }, { upsert: true });
  assert.strictEqual(firstTx.upsertedCount, 1);
  assert.strictEqual(secondTx.modifiedCount, 1);
  assert.strictEqual(await countDocuments(txs), 1);

  await updateOne(txs, { source: 'SBI', sourceHash: 'older-row' }, { $set: Object.assign({}, tx, {
    sourceHash: 'older-row',
    tradeDateTime: '2026-01-01T09:00:00',
    symbol: '7936.T'
  }) }, { upsert: true });

  var page = await toArray(txs.find().sort({ tradeDateTime: -1, symbol: 1 }).skip(0).limit(1));
  assert.strictEqual(page.length, 1);
  assert.strictEqual(page[0].sourceHash, 'same-row');
  assert.strictEqual(page[0].settlementAmount, 120000);

  var fx = {
    source: 'SBI_FX',
    sourceHash: 'fx-row',
    tradeDateTime: '2026-06-10 10:00:00',
    pair: '米ドル-円',
    action: '決済売',
    totalPl: 1500
  };
  await updateOne(db.collection('fxTrades'), { source: fx.source, sourceHash: fx.sourceHash }, { $set: fx }, { upsert: true });
  var fxRows = await toArray(db.collection('fxTrades').find().sort({ tradeDateTime: 1 }));
  assert.strictEqual(fxRows.length, 1);
  assert.strictEqual(fxRows[0].totalPl, 1500);

  await updateOne(db.collection('goldHoldings'), { _id: 'gold' }, { $set: { _id: 'gold', grams: 1, buyAmount: 10000 } }, { upsert: true });
  await updateOne(db.collection('goldHoldings'), { _id: 'gold' }, { $set: { grams: 2, buyAmount: 20000 } }, { upsert: true });
  var gold = await findOne(db.collection('goldHoldings'), { _id: 'gold' });
  assert.strictEqual(gold.grams, 2);
  assert.strictEqual(gold.buyAmount, 20000);

  await bulkWrite(db.collection('assets'), [{
    updateOne: {
      filter: { symbol: '7974.T' },
      update: {
        $set: { symbol: '7974.T', assetType: 'STOCK', code: '7974', name: '任天堂' },
        $setOnInsert: { priceSourceUrl: '', latestPrice: null }
      },
      upsert: true
    }
  }]);
  await updateOne(db.collection('assets'), { symbol: '7974.T' }, { $set: { priceSourceUrl: 'https://example.test' } }, { upsert: true });
  var assets = await toArray(db.collection('assets').find({ symbol: { $in: ['7974.T'] } }));
  assert.strictEqual(assets.length, 1);
  assert.strictEqual(assets[0].priceSourceUrl, 'https://example.test');

  var fxRates = db.collection('fxRates');
  var firstRate = await updateOne(fxRates, { pair: 'USDJPY', rateDate: '2026-06-12' }, { $set: {
    pair: 'USDJPY',
    rateDate: '2026-06-12',
    rate: 155.25,
    status: 'OK'
  } }, { upsert: true });
  var secondRate = await updateOne(fxRates, { pair: 'USDJPY', rateDate: '2026-06-12' }, { $set: {
    rate: 155.5,
    status: 'OK'
  } }, { upsert: true });
  assert.strictEqual(firstRate.upsertedCount, 1);
  assert.strictEqual(secondRate.modifiedCount, 1);
  var latestRates = await toArray(fxRates.find({ pair: 'USDJPY' }).sort({ rateDate: -1 }).limit(1));
  assert.strictEqual(latestRates.length, 1);
  assert.strictEqual(latestRates[0].rate, 155.5);

  var priceHistory = db.collection('priceHistory');
  var firstHistory = await updateOne(priceHistory, { symbol: '7974.T', priceDate: '2026-06-12', source: 'YAHOO_CHART' }, { $set: {
    symbol: '7974.T',
    assetType: 'STOCK',
    priceDate: '2026-06-12',
    currency: 'JPY',
    open: 12000,
    high: 12300,
    low: 11900,
    close: 12200,
    volume: 1000000,
    source: 'YAHOO_CHART',
    status: 'OK'
  } }, { upsert: true });
  var secondHistory = await updateOne(priceHistory, { symbol: '7974.T', priceDate: '2026-06-12', source: 'YAHOO_CHART' }, { $set: {
    close: 12250,
    status: 'OK'
  } }, { upsert: true });
  assert.strictEqual(firstHistory.upsertedCount, 1);
  assert.strictEqual(secondHistory.modifiedCount, 1);
  var historyRows = await toArray(priceHistory.find({ symbol: '7974.T' }).limit(1));
  assert.strictEqual(historyRows.length, 1);
  assert.strictEqual(historyRows[0].close, 12250);

  await updateOne(priceHistory, { symbol: '7936.T', priceDate: '2026-06-18', source: 'YAHOO_CHART_SNAPSHOT' }, { $set: {
    symbol: '7936.T',
    assetType: 'STOCK',
    priceDate: '2026-06-18',
    close: 7166,
    source: 'YAHOO_CHART_SNAPSHOT'
  } }, { upsert: true });
  await upsertHistoryRows(db, [{
    symbol: '7936.T',
    assetType: 'STOCK',
    priceDate: '2026-06-18',
    currency: 'JPY',
    open: 7100,
    high: 7200,
    low: 7000,
    close: 7150,
    volume: 1000,
    source: 'YAHOO_CHART',
    status: 'OK'
  }]);
  var replacedHistoryRows = await toArray(priceHistory.find({ symbol: '7936.T' }));
  assert.strictEqual(replacedHistoryRows.length, 1);
  assert.strictEqual(replacedHistoryRows[0].source, 'YAHOO_CHART');
  assert.strictEqual(replacedHistoryRows[0].close, 7150);

  var coverageRows = db.collection('priceHistoryCoverage');
  var coverageDoc = {
    coverageKey: '7974.T|JQUANTS|COMPLETE|2026-06-01|2026-06-12',
    symbol: '7974.T',
    source: 'JQUANTS',
    startDate: '2026-06-01',
    endDate: '2026-06-12',
    status: 'COMPLETE',
    reason: 'SAVED_PRICE_ROW',
    expectedCount: 10,
    receivedCount: 10
  };
  await updateOne(coverageRows, { coverageKey: coverageDoc.coverageKey }, { $set: coverageDoc }, { upsert: true });
  var storedCoverage = await toArray(coverageRows.find({ symbol: '7974.T', source: 'JQUANTS' }));
  assert.strictEqual(storedCoverage.length, 1);
  assert.strictEqual(storedCoverage[0].status, 'COMPLETE');
  assert.strictEqual(storedCoverage[0].receivedCount, 10);
  var deletedCoverage = await deleteMany(coverageRows, { symbol: '7974.T', source: 'JQUANTS' });
  assert.strictEqual(deletedCoverage.deletedCount, 1);

  var deletedRates = await deleteMany(fxRates, { pair: 'USDJPY', rateDate: '2026-06-12' });
  assert.strictEqual(deletedRates.deletedCount, 1);
  assert.strictEqual((await toArray(fxRates.find({ pair: 'USDJPY' }))).length, 0);

  opened.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('sqliteStorage tests passed');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
