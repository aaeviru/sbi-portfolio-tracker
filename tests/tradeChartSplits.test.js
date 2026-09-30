var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

var testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbi-chart-split-'));
process.env.SBI_PORTFOLIO_DB_PATH = path.join(testDir, 'test.sqlite');
process.env.SBI_LOCAL_ONLY = 'true';
var withDb = require('../lib/db').withDb;
var app = require('../app').app;

function openDb() {
  return new Promise(function (resolve, reject) {
    withDb(function (err, db, close) { err ? reject(err) : resolve({ db: db, close: close }); });
  });
}
function save(collection, key, doc) {
  return new Promise(function (resolve, reject) {
    collection.updateOne(key, { $set: doc }, { upsert: true }, function (err) { err ? reject(err) : resolve(); });
  });
}
async function main() {
  var opened = await openDb();
  var server;
  try {
    await save(opened.db.collection('transactions'), { source: 'SBI', sourceHash: '8316-buy' }, {
      source: 'SBI', sourceHash: '8316-buy', symbol: '8316.T', code: '8316',
      assetType: 'STOCK', assetName: '8316', tradeDate: '2026-08-03', tradeDateTime: '2026-08-03T09:00:00',
      side: 'BUY', quantity: 100, price: 6600, unitPrice: 6600, settlementAmount: 660000
    });
    await save(opened.db.collection('stockSplits'), { id: 'YAHOO:8316.T:2026-09-29' }, {
      id: 'YAHOO:8316.T:2026-09-29', symbol: '8316.T', exDate: '2026-09-29',
      beforeShares: 1, afterShares: 2, ratio: 2, status: 'CONFIRMED', operation: 'ADD', source: 'YAHOO_JAPAN_HISTORY'
    });
    await save(opened.db.collection('stockSplits'), { id: 'YAHOO:8316.T:2024-09-27' }, {
      id: 'YAHOO:8316.T:2024-09-27', symbol: '8316.T', exDate: '2024-09-27',
      beforeShares: 1, afterShares: 3, ratio: 3, status: 'PENDING', operation: 'ADD', source: 'YAHOO_JAPAN_HISTORY'
    });
    for (var row of [
      { priceDate: '2024-09-26', open: 9180, high: 9200, low: 9100, close: 9174, volume: 1000 },
      { priceDate: '2024-09-27', open: 2980, high: 3000, low: 2900, close: 2954.5, volume: 2000 },
      { priceDate: '2026-09-28', open: 7000, high: 7100, low: 6900, close: 6988, volume: 1000 },
      { priceDate: '2026-09-29', open: 3400, high: 3450, low: 3300, close: 3357, volume: 2000 }
    ]) {
      var doc = Object.assign({ symbol: '8316.T', source: 'YAHOO_CHART' }, row);
      await save(opened.db.collection('priceHistory'), { symbol: doc.symbol, priceDate: doc.priceDate, source: doc.source }, doc);
    }
    server = await new Promise(function (resolve) {
      var listening = app.listen(0, '127.0.0.1', function () { resolve(listening); });
    });
    var base = 'http://127.0.0.1:' + server.address().port;
    var login = await fetch(base + '/login', { method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=admin' });
    var cookie = login.headers.get('set-cookie').split(';')[0];
    var page = await fetch(base + '/trade-chart', { headers: { Cookie: cookie } });
    assert.strictEqual(page.status, 200);
    var html = await page.text();
    var match = html.match(/var chartAssets = (\[[^\n]*\]);/);
    assert.ok(match, 'trade chart must include chart data');
    var stock = JSON.parse(match[1]).find(function (asset) { return asset.symbol == '8316.T'; });
    var prior = stock.priceHistory.find(function (row) { return row.date == '2026-09-28'; });
    var after = stock.priceHistory.find(function (row) { return row.date == '2026-09-29'; });
    assert.strictEqual(prior.close, 3494, 'pre-split chart close should use current-share units');
    assert.strictEqual(prior.open, 3500);
    assert.strictEqual(prior.high, 3550);
    assert.strictEqual(prior.low, 3450);
    assert.strictEqual(after.close, 3357, 'post-split chart close should remain unchanged');
    assert.strictEqual(stock.points[0].price, 3300, 'pre-split trade marker should align with adjusted chart');
    assert.strictEqual(stock.points[0].quantity, 200, 'pre-split trade marker quantity should use current-share units');
    assert.strictEqual(stock.points[0].rawPrice, 6600, 'SBI trade price stays available for the table');
    assert.strictEqual(stock.points[0].rawQuantity, 100, 'SBI trade quantity stays available for the table');
    assert.strictEqual(stock.splitAdjusted, true);
    assert.strictEqual(stock.priceHistory.find(function (row) { return row.date == '2024-09-26'; }).close, 4587,
      'pending 2024 event must not change the chart');
    var confirmOlder = await fetch(base + '/prices/splits/YAHOO%3A8316.T%3A2024-09-27/confirm',
      { method: 'POST', redirect: 'manual', headers: { Cookie: cookie } });
    assert.strictEqual(confirmOlder.status, 302);
    var updatedPage = await fetch(base + '/trade-chart', { headers: { Cookie: cookie } });
    assert.strictEqual(updatedPage.status, 200);
    var updatedMatch = (await updatedPage.text()).match(/var chartAssets = (\[[^\n]*\]);/);
    var updatedStock = JSON.parse(updatedMatch[1]).find(function (asset) { return asset.symbol == '8316.T'; });
    assert.strictEqual(updatedStock.priceHistory.find(function (row) { return row.date == '2024-09-26'; }).close, 1529);
    assert.strictEqual(updatedStock.priceHistory.find(function (row) { return row.date == '2024-09-27'; }).close, 1477.25);
    assert.strictEqual(updatedStock.points[0].price, 3300, '2026 marker remains on the current share basis');
  } finally {
    if (server) await new Promise(function (resolve) { server.close(resolve); });
    opened.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  console.log('tradeChartSplits tests passed');
}
main().catch(function (err) { console.error(err); process.exitCode = 1; });
