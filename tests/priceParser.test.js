var assert = require('assert');
var fs = require('fs');
var priceParsers = require('../app');
var parseSbiCsv = priceParsers.parseSbiCsv;
var parseFxCsv = priceParsers.parseFxCsv;
var parseGoldCsv = priceParsers.parseGoldCsv;
var buildCombinedSummaryTotals = priceParsers.buildCombinedSummaryTotals;
var calculateGoldPricePerGramJpy = priceParsers.calculateGoldPricePerGramJpy;
var findLatestBuyDatesBySymbol = priceParsers.findLatestBuyDatesBySymbol;
var parseYahooChartDailyRates = priceParsers.parseYahooChartDailyRates;
var parseYahooChartDailyPriceHistory = priceParsers.parseYahooChartDailyPriceHistory;
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
assert.strictEqual(foreignRows.length, 4);
var sampleNvdaRow = foreignRows.filter(function (row) {
  return row.code == 'NVDA' && row.quantity == 1 && row.price == 209.635;
})[0];
var usdSettlementRow = foreignRows.filter(function (row) {
  return row.code == 'MCD' && row.quantity == 3;
})[0];
assert.ok(sampleNvdaRow);
assert.ok(usdSettlementRow);
assert.strictEqual(sampleNvdaRow.assetType, 'US_STOCK');
assert.strictEqual(sampleNvdaRow.symbol, 'NVDA');
assert.strictEqual(sampleNvdaRow.side, 'BUY');
assert.strictEqual(sampleNvdaRow.settlementAmount, 33517);
assert.strictEqual(sampleNvdaRow.currency, 'USD');
assert.strictEqual(sampleNvdaRow.settlementCurrency, 'JPY');
assert.strictEqual(usdSettlementRow.settlementAmount, 854.34);
assert.strictEqual(usdSettlementRow.currency, 'USD');
assert.strictEqual(usdSettlementRow.settlementCurrency, 'USD');

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
assert.strictEqual(calculateGoldPricePerGramJpy(4224.8, 157.5), 21393.3);
assert.strictEqual(calculateGoldPricePerGramJpy(4224.8, null), null);

var dailyRates = parseYahooChartDailyRates({
  chart: {
    result: [{
      timestamp: [1781107200, 1781193600],
      indicators: {
        quote: [{
          open: [155.1, 155.4],
          high: [156.2, 156.5],
          low: [154.8, 155.2],
          close: [155.9, 156.1]
        }]
      }
    }]
  }
}, 'USDJPY');
assert.strictEqual(dailyRates.length, 2);
assert.strictEqual(dailyRates[0].pair, 'USDJPY');
assert.strictEqual(dailyRates[0].rateType, 'DAILY_CLOSE');
assert.strictEqual(dailyRates[0].rate, 155.9);
assert.strictEqual(dailyRates[1].close, 156.1);

var dailyPrices = parseYahooChartDailyPriceHistory({
  chart: {
    result: [{
      timestamp: [1781107200, 1781193600],
      indicators: {
        quote: [{
          open: [280.1, 281.4],
          high: [286.2, 287.5],
          low: [279.8, 280.2],
          close: [285.9, 286.1],
          volume: [1000000, 1200000]
        }]
      }
    }]
  }
}, { symbol: 'MCD', assetType: 'US_STOCK' });
assert.strictEqual(dailyPrices.length, 2);
assert.strictEqual(dailyPrices[0].symbol, 'MCD');
assert.strictEqual(dailyPrices[0].currency, 'USD');
assert.strictEqual(dailyPrices[0].open, 280.1);
assert.strictEqual(dailyPrices[1].close, 286.1);
assert.strictEqual(dailyPrices[1].volume, 1200000);

var latestBuyDates = findLatestBuyDatesBySymbol([
  { assetType: 'STOCK', side: 'BUY', symbol: '7974.T', tradeDate: '2026-06-01' },
  { assetType: 'STOCK', side: 'SELL', symbol: '7974.T', tradeDate: '2026-06-05' },
  { assetType: 'STOCK', side: 'BUY', symbol: '7974.T', tradeDate: '2026-06-10' },
  { assetType: 'US_STOCK', side: 'BUY', symbol: 'MCD', tradeDate: '2026-06-07' },
  { assetType: 'FUND', side: 'BUY', symbol: 'FUND:TOPIX', tradeDate: '2026-06-08' }
]);
assert.strictEqual(latestBuyDates['7974.T'], '2026-06-10');
assert.strictEqual(latestBuyDates.MCD, '2026-06-06');
assert.strictEqual(latestBuyDates['FUND:TOPIX'], undefined);

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
