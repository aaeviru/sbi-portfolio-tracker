var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

var testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbi-stock-splits-'));
process.env.SBI_PORTFOLIO_DB_PATH = path.join(testDir, 'test.sqlite');
process.env.SBI_LOCAL_ONLY = 'true';
var withDb = require('../lib/db').withDb;
var splitMath = require('../lib/stockSplits');
var scanner = require('../lib/stockSplitScan');
var actions = require('../lib/stockSplitActions');
var store = require('../lib/stockSplitStore');
var summary = require('../lib/portfolioSummary');
var app = require('../app').app;
var html = fs.readFileSync(path.join(__dirname, 'fixtures', 'yahoo8316Split.html'), 'utf8');

function openDb() {
  return new Promise(function (resolve, reject) {
    withDb(function (err, db, close) { err ? reject(err) : resolve({ db: db, close: close }); });
  });
}
function upsert(collection, key, doc) {
  return new Promise(function (resolve, reject) {
    collection.updateOne(key, { $set: doc }, { upsert: true }, function (err) { err ? reject(err) : resolve(); });
  });
}
function findOne(collection, filter) {
  return new Promise(function (resolve, reject) {
    collection.findOne(filter, function (err, row) { err ? reject(err) : resolve(row); });
  });
}
function findAll(collection, filter) {
  return new Promise(function (resolve, reject) {
    collection.find(filter).toArray(function (err, rows) { err ? reject(err) : resolve(rows); });
  });
}
function attach(db, asset) {
  return new Promise(function (resolve, reject) {
    store.attachConfirmedStockSplits(db, { '8316.T': asset }, function (err, assets) {
      err ? reject(err) : resolve(assets);
    });
  });
}

async function main() {
  var parsed = splitMath.parseYahooHistoryPage(html, '8316.T');
  assert.deepStrictEqual(parsed.events.map(function (event) { return [event.exDate, event.ratio]; }), [['2026-09-29', 2]]);
  assert.throws(function () { splitMath.parseYahooHistoryPage(html, '7203.T'); }, /table was not found/);
  assert.strictEqual(splitMath.scanStart('2025-12-18', { lastCheckedThrough: '2026-09-20', lastFullScanDate: '2026-08-01' }, '2026-09-29'), '2025-12-18');
  assert.strictEqual(splitMath.scanStart('2025-01-01', { firstTradeDate: '2025-01-01', lastCheckedThrough: '2026-09-20', lastFullScanDate: '2026-09-15' }, '2026-09-29'), '2026-08-21');
  assert.strictEqual(splitMath.scanStart('2024-12-01', { firstTradeDate: '2025-01-01', lastCheckedThrough: '2026-09-20', lastFullScanDate: '2026-09-15' }, '2026-09-29'), '2024-12-01');

  var opened = await openDb();
  var db = opened.db;
  try {
    var tradeSpecs = [
      ['2025-12-18', 'BUY', 100, 492850],
      ['2025-12-22', 'BUY', 100, 504600],
      ['2026-02-06', 'SELL', 100, 582300],
      ['2026-02-06', 'SELL', 100, 580940],
      ['2026-08-03', 'BUY', 100, 660000]
    ];
    var trades = tradeSpecs.map(function (spec, index) {
      return { source: 'SBI', sourceHash: '8316-' + index, symbol: '8316.T', code: '8316',
        assetType: 'STOCK', assetName: '三井住友フィナンシャルグループ', tradeDate: spec[0],
        tradeDateTime: spec[0] + (spec[1] == 'BUY' ? 'T09:00:00' : 'T15:00:00'),
        side: spec[1], quantity: spec[2], settlementAmount: spec[3] };
    });
    for (var tx of trades) await upsert(db.collection('transactions'), { source: tx.source, sourceHash: tx.sourceHash }, tx);
    var asset = { symbol: '8316.T', assetType: 'STOCK', latestPrice: 3357, latestPriceDate: '2026-09-29' };
    await upsert(db.collection('assets'), { symbol: asset.symbol }, asset);
    await upsert(db.collection('priceHistory'), { symbol: '8316.T', priceDate: '2026-09-28', source: 'YAHOO_CHART' },
      { symbol: '8316.T', priceDate: '2026-09-28', source: 'YAHOO_CHART', close: 6988 });
    await upsert(db.collection('priceHistory'), { symbol: '8316.T', priceDate: '2026-09-29', source: 'YAHOO_CHART' },
      { symbol: '8316.T', priceDate: '2026-09-29', source: 'YAHOO_CHART', close: 3357 });

    var urls = [];
    function yahooFetch(url, callback) { urls.push(url); callback(null, html); }
    var scan = await scanner.scanSymbolAsync(db, '8316.T', '2025-12-18', '2026-09-29', yahooFetch);
    assert.strictEqual(scan.ok, true);
    assert.strictEqual(scan.found, 1);
    assert.strictEqual(scan.warning, '');
    var priceRows = await findAll(db.collection('priceHistory'), { symbol: '8316.T' });
    assert.match(scanner.latestPriceWarning(priceRows, []), /Yahoo split history supplied no matching event/);
    assert.strictEqual(scanner.latestPriceWarning(priceRows, [{ exDate: '2026-09-29', status: 'PENDING' }]), '');
    assert.match(scanner.latestPriceWarning(priceRows, [{ exDate: '2026-09-29', status: 'DISMISSED' }]), /no matching event/);
    assert.ok(urls[0].includes('from=20251218&to=20260929'));
    var pending = (await findAll(db.collection('stockSplits'), { symbol: '8316.T' }))[0];
    assert.strictEqual(pending.status, 'PENDING');
    assert.strictEqual(pending.source, 'YAHOO_JAPAN_HISTORY');
    assert.ok(pending.sourceUrl.includes('finance.yahoo.co.jp/quote/8316.T/history'));
    var beforeAssets = await attach(db, asset);
    var before = summary.buildPortfolioSummaryReport(trades, beforeAssets, {
      '8316.T': await findAll(db.collection('priceHistory'), { symbol: '8316.T' })
    }, '2026-09-29').rows[0];
    assert.strictEqual(before.netQty, 100);
    assert.strictEqual(before.marketValue, 335700);
    assert.strictEqual(before.unrealizedPl, -324300);
    var preview = actions.previewCandidate(trades, beforeAssets['8316.T'], pending, '2026-09-29');
    assert.strictEqual(preview.after.netQty, 200);
    assert.strictEqual(preview.after.marketValue, 671400);
    assert.strictEqual(preview.after.unrealizedPl, 11400);
    assert.strictEqual(preview.after.remainingCost, 660000);
    assert.strictEqual(preview.after.fifoRealizedPl, 165790);

    var server = await new Promise(function (resolve) {
      var listening = app.listen(0, '127.0.0.1', function () { resolve(listening); });
    });
    try {
      var baseUrl = 'http://127.0.0.1:' + server.address().port;
      var login = await fetch(baseUrl + '/login', { method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=admin' });
      assert.strictEqual(login.status, 302);
      var cookie = login.headers.get('set-cookie').split(';')[0];
      var pricesPage = await fetch(baseUrl + '/prices', { headers: { Cookie: cookie } });
      assert.strictEqual(pricesPage.status, 200);
      var pricesHtml = await pricesPage.text();
      assert.ok(pricesHtml.includes('Confirm and apply'));
      assert.ok(pricesHtml.includes('Yahoo Japan history'));
      assert.ok(pricesHtml.includes('data-number="200"'));
      var confirm = await fetch(baseUrl + '/prices/splits/' + encodeURIComponent(pending.id) + '/confirm',
        { method: 'POST', redirect: 'manual', headers: { Cookie: cookie } });
      assert.strictEqual(confirm.status, 302);
      var summaryPage = await fetch(baseUrl + '/summary', { headers: { Cookie: cookie } });
      assert.strictEqual(summaryPage.status, 200);
      assert.ok((await summaryPage.text()).includes('data-number="671400"'));
    } finally {
      await new Promise(function (resolve) { server.close(resolve); });
    }
    var afterAssets = await attach(db, asset);
    var after = summary.buildPortfolioSummaryReport(trades, afterAssets, {
      '8316.T': await findAll(db.collection('priceHistory'), { symbol: '8316.T' })
    }, '2026-09-29').rows[0];
    assert.strictEqual(after.netQty, 200);
    assert.strictEqual(after.marketValue, 671400);
    assert.strictEqual(after.unrealizedPl, 11400);
    assert.strictEqual(after.fifoRealizedPl, 165790);
    assert.strictEqual(after.previousPrice, 3494);
    assert.strictEqual(after.dayPl, -27400);
    assert.strictEqual(summary.buildPortfolioSummary(trades, afterAssets, '2026-09-28')[0].netQty, 100);
    assert.strictEqual((await findAll(db.collection('transactions'), { symbol: '8316.T' })).length, 5);

    var repeat = await scanner.scanSymbolAsync(db, '8316.T', '2025-12-18', '2026-09-29', yahooFetch);
    assert.strictEqual(repeat.found, 0);
    assert.strictEqual((await findAll(db.collection('stockSplits'), { symbol: '8316.T' })).length, 1);
    var replace = await actions.addManualCandidate(db, { symbol: '8316.T', exDate: '2026-09-29',
      operation: 'REPLACE', replacesId: pending.id, beforeShares: 1, afterShares: 3 });
    assert.strictEqual(replace.status, 'PENDING');
    await actions.changeStatus(db, replace.id, 'CONFIRMED');
    assert.strictEqual((await findOne(db.collection('stockSplits'), { id: pending.id })).status, 'DISMISSED');
    var replacedAssets = await attach(db, asset);
    assert.strictEqual(summary.buildPortfolioSummary(trades, replacedAssets, '2026-09-29')[0].netQty, 300);
    var remove = await actions.addManualCandidate(db, { symbol: '8316.T',
      operation: 'REMOVE', replacesId: replace.id });
    await actions.changeStatus(db, remove.id, 'CONFIRMED');
    var removedAssets = await attach(db, asset);
    assert.strictEqual(summary.buildPortfolioSummary(trades, removedAssets, '2026-09-29')[0].netQty, 100);

    assert.throws(function () { actions.validateManual({ symbol: '8316.T', exDate: '2026-02-30', beforeShares: 1, afterShares: 2 }); }, /valid ex-rights/);
    var failure = await scanner.scanSymbolAsync(db, '7203.T', '2026-01-01', '2026-09-29', function (url, callback) { callback(new Error('HTTP 503')); });
    assert.strictEqual(failure.ok, false);
    assert.strictEqual((await findOne(db.collection('stockSplitScans'), { symbol: '7203.T' })).status, 'FAILED');
    assert.strictEqual((await findOne(db.collection('stockSplitScans'), { symbol: '7203.T' })).lastCheckedThrough, undefined);
    var manual = await actions.addManualCandidate(db, { symbol: '7203.T', exDate: '2026-09-29',
      beforeShares: 1, afterShares: 3 });
    var otherHtml = html.replace('【8316】', '【7203】');
    var recovered = await scanner.scanSymbolAsync(db, '7203.T', '2026-01-01', '2026-09-29', function (url, callback) {
      callback(null, otherHtml);
    });
    assert.strictEqual(recovered.ok, true);
    assert.strictEqual(recovered.found, 0);
    assert.strictEqual((await findOne(db.collection('stockSplits'), { id: manual.id })).ratio, 3);
    assert.strictEqual((await findOne(db.collection('stockSplitScans'), { symbol: '7203.T' })).status, 'OK');
    await actions.changeStatus(db, manual.id, 'DISMISSED');
    assert.strictEqual((await scanner.scanSymbolAsync(db, '7203.T', '2026-01-01', '2026-09-29', function (url, callback) {
      callback(null, otherHtml);
    })).found, 1);
    var yahooCandidate = await findOne(db.collection('stockSplits'), { id: 'YAHOO:7203.T:2026-09-29' });
    await actions.changeStatus(db, yahooCandidate.id, 'DISMISSED');
    assert.strictEqual((await scanner.scanSymbolAsync(db, '7203.T', '2026-01-01', '2026-09-29', function (url, callback) {
      callback(null, otherHtml);
    })).found, 0);
  } finally {
    opened.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  console.log('stockSplits tests passed');
}
main().catch(function (err) { console.error(err); process.exitCode = 1; });
