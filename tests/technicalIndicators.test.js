var assert = require('assert');
var indicators = require('../lib/technicalIndicators');

function makeHistory(symbol, count, closeForIndex) {
  var start = new Date('2025-01-01T00:00:00Z');
  var rows = [];
  for (var i = 0; i < count; i++) {
    var date = new Date(start.getTime());
    date.setUTCDate(date.getUTCDate() + i);
    rows.push({
      symbol: symbol,
      priceDate: date.toISOString().slice(0, 10),
      close: closeForIndex(i),
      currency: 'JPY',
      source: 'YAHOO_CHART',
      fetchedAt: '2026-01-01T00:00:00.000Z'
    });
  }
  return rows;
}

var rising = makeHistory('7974.T', 400, function (index) {
  return 100 + index;
});
var result = indicators.buildTechnicalIndicators({
  symbol: '7974.T',
  name: 'Nintendo',
  assetType: 'STOCK'
}, rising);

assert.strictEqual(result.status, 'OK');
assert.strictEqual(result.observations, 400);
assert.strictEqual(result.latestClose, 499);
assert.strictEqual(result.sma20, 489.5);
assert.strictEqual(result.sma50, 474.5);
assert.strictEqual(result.sma200, 399.5);
assert.strictEqual(result.rsi14, 100);
assert.ok(result.macd12_26_9);
assert.ok(result.macd12_26_9.line > 0);
assert.ok(result.bollinger20_2.upper > result.bollinger20_2.middle);
assert.ok(result.bollinger20_2.middle > result.bollinger20_2.lower);
assert.strictEqual(result.range52Week.high, 499);
assert.ok(result.range52Week.low < result.range52Week.high);
assert.strictEqual(result.range52Week.distanceFromHighPercent, 0);
assert.strictEqual(result.range52Week.drawdownPercent, 0);
assert.strictEqual(result.realizedVolatility20DayAnnualizedPercent, 0.04);

var series = indicators.buildTechnicalIndicatorSeries({
  symbol: '7974.T',
  name: 'Nintendo',
  assetType: 'STOCK'
}, rising);
assert.strictEqual(series.length, 400);
assert.strictEqual(series[18].sma20, null);
assert.strictEqual(series[19].sma20, 109.5);
assert.strictEqual(series[19].realizedVolatility20DayAnnualizedPercent, null);
assert.ok(series[20].realizedVolatility20DayAnnualizedPercent > 0);
assert.strictEqual(series[399].sma200, result.sma200);
assert.strictEqual(series[399].rsi14, result.rsi14);
assert.deepStrictEqual(series[399].macd12_26_9, result.macd12_26_9);

var partial = indicators.buildTechnicalIndicators({
  symbol: 'AAPL',
  name: 'Apple',
  assetType: 'US_STOCK'
}, makeHistory('AAPL', 20, function (index) {
  return 200 + index;
}));
assert.strictEqual(partial.status, 'PARTIAL');
assert.strictEqual(partial.priceUnit, 'USD/share');
assert.strictEqual(partial.sma20, 209.5);
assert.strictEqual(partial.sma50, null);
assert.strictEqual(partial.rsi14, 100);
assert.strictEqual(partial.macd12_26_9, null);
assert.strictEqual(partial.realizedVolatility20DayAnnualizedPercent, null);

var duplicateDates = indicators.normalizePriceHistory([{
  priceDate: '2026-06-01',
  close: 100,
  source: 'YAHOO_CHART_SNAPSHOT'
}, {
  priceDate: '2026-06-01',
  close: 101,
  source: 'YAHOO_CHART'
}]);
assert.strictEqual(duplicateDates.length, 1);
assert.strictEqual(duplicateDates[0].close, 101);

var mmf = indicators.buildTechnicalIndicators({
  symbol: 'FUND:ＳＢＩ岡三・ＵＳドル・マネー・マーケット・ファンド',
  name: 'ＳＢＩ岡三・ＵＳドル・マネー・マーケット・ファンド',
  assetType: 'FUND',
  assetSubType: 'MMF'
}, rising);
assert.strictEqual(mmf.status, 'NOT_APPLICABLE');
assert.strictEqual(mmf.observations, 0);
assert.strictEqual(mmf.sma20, null);
assert.deepStrictEqual(indicators.buildTechnicalIndicatorSeries({
  symbol: mmf.symbol,
  name: mmf.name,
  assetType: 'FUND',
  assetSubType: 'MMF'
}, rising), []);

console.log('technicalIndicators tests passed');
