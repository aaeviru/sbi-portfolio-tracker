var assert = require('assert');
var fs = require('fs');
var priceParsers = require('../app');
var parseSbiCsv = priceParsers.parseSbiCsv;
var parseFxCsv = priceParsers.parseFxCsv;
var parseGoldCsv = priceParsers.parseGoldCsv;
var buildCombinedSummaryTotals = priceParsers.buildCombinedSummaryTotals;
var parseFundPriceFromHtml = priceParsers.parseFundPriceFromHtml;
var parseStockPriceFromHtml = priceParsers.parseStockPriceFromHtml;

var html = [
  '<html><body>',
  '<div>投資信託</div>',
  '<h1>野村 世界業種別投資シリーズ(半導体)</h1>',
  '<div>01313098</div>',
  '<span>NISA成長投資枠</span>',
  '<div>358,534</div>',
  '<div>前日比 +7,197(+2.05%)</div>',
  '<h2>基準価額・投資信託情報</h2>',
  '<div>トータルリターン（年率） 0%0%0%</div>',
  '</body></html>'
].join('');

assert.strictEqual(
  parseFundPriceFromHtml(html, 'https://finance.yahoo.co.jp/quote/01313098'),
  35.8534
);

var stockHtml = [
  '<html><body>',
  '<div>日本株</div>',
  '<h1>ジェイファーマ(株)</h1>',
  '<div>520A</div>',
  '<div>392</div>',
  '<div>前日比 -27(-6.44%)</div>',
  '</body></html>'
].join('');

assert.strictEqual(parseStockPriceFromHtml(stockHtml, '520A.T'), 392);

var foreignRows = parseSbiCsv(fs.readFileSync('samples/PaymentRecords.csv'), 'PaymentRecords.csv');
assert.strictEqual(foreignRows.length, 1);
assert.strictEqual(foreignRows[0].assetType, 'US_STOCK');
assert.strictEqual(foreignRows[0].code, 'NVDA');
assert.strictEqual(foreignRows[0].symbol, 'NVDA');
assert.strictEqual(foreignRows[0].side, 'BUY');
assert.strictEqual(foreignRows[0].quantity, 1);
assert.strictEqual(foreignRows[0].price, 209.635);
assert.strictEqual(foreignRows[0].settlementAmount, 33517);
assert.strictEqual(foreignRows[0].currency, 'USD');
assert.strictEqual(foreignRows[0].settlementCurrency, 'JPY');

var fxRows = parseFxCsv(fs.readFileSync('samples/kessai20260610.csv'), 'kessai20260610.csv');
assert.ok(fxRows.length > 0);
var usdFxRow = fxRows.filter(function (row) {
  return row.pair == '米ドル-円' && row.action == '新規買' && row.quantity == 1000 && row.rate == 156.861;
})[0];
assert.ok(usdFxRow);

var goldHolding = parseGoldCsv(fs.readFileSync('samples/OrderRefer20260610231019.csv'), 'OrderRefer20260610231019.csv');
assert.strictEqual(goldHolding.source, 'SBI_GOLD');
assert.strictEqual(goldHolding.rowCount, 13);
assert.strictEqual(goldHolding.grams, 30.8104);
assert.strictEqual(goldHolding.buyAmount, 599949);

var combinedTotals = buildCombinedSummaryTotals(
  { marketValue: 1000000, unrealizedPl: 50000, realizedPl: 10000, totalPl: 60000 },
  { totalPl: -1500 }
);
assert.strictEqual(combinedTotals.portfolioMarketValue, 1000000);
assert.strictEqual(combinedTotals.portfolioTotalPl, 60000);
assert.strictEqual(combinedTotals.fxTotalPl, -1500);
assert.strictEqual(combinedTotals.combinedRealizedPl, 8500);
assert.strictEqual(combinedTotals.combinedTotalPl, 58500);

console.log('priceParser tests passed');
