var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbi-portfolio-sqlite-'));
process.env.SBI_PORTFOLIO_DB_PATH = path.join(tmpDir, 'test.sqlite');

var withDb = require('../lib/db').withDb;

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

  opened.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('sqliteStorage tests passed');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
