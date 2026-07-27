var assert = require('assert');
var ejs = require('ejs');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var tradeChart = require('../lib/tradeChart');
var buildTradeChartData = tradeChart.buildTradeChartData;
var attachPriceHistoryToTradeChartData = tradeChart.attachPriceHistoryToTradeChartData;
var sortTradeChartAssetsBySummaryRows = tradeChart.sortTradeChartAssetsBySummaryRows;

function findAsset(assets, symbol) {
  return assets.filter(function (asset) {
    return asset.symbol == symbol;
  })[0];
}

var assets = buildTradeChartData([
  {
    assetType: 'STOCK',
    side: 'SELL',
    symbol: '7974.T',
    code: '7974',
    assetName: 'Nintendo',
    tradeDateTime: '2026-06-11T15:00:00.000Z',
    quantity: 100,
    price: 12000,
    settlementAmount: 1200000,
    account: 'specific'
  },
  {
    assetType: 'STOCK',
    side: 'BUY',
    symbol: '7974.T',
    code: '7974',
    assetName: 'Nintendo',
    tradeDateTime: '2026-06-10T09:00:00.000Z',
    quantity: 100,
    price: 11000,
    settlementAmount: 1100000,
    account: 'specific'
  },
  {
    assetType: 'FUND',
    side: 'BUY',
    symbol: 'FUND:TOPIX',
    assetName: 'Topix Fund',
    tradeDate: '2026-06-09',
    quantity: 20000,
    unitPrice: 1.2345,
    settlementAmount: 24690,
    account: 'nisa'
  },
  {
    assetType: 'FX',
    side: 'BUY',
    symbol: 'USDJPY',
    tradeDate: '2026-06-08',
    quantity: 100,
    price: 160
  },
  {
    assetType: 'US_STOCK',
    side: 'BUY',
    symbol: 'MCD',
    assetName: 'McDonalds',
    tradeDate: '2026-06-07',
    quantity: 3,
    price: 287,
    settlementAmount: 854.34
  },
  {
    assetType: 'GOLD',
    side: 'BUY',
    symbol: 'GOLD_JPY',
    assetName: 'Gold',
    tradeDate: '2026-06-10',
    quantity: 2,
    price: 20000,
    settlementAmount: 40000
  }
]);

var stock = findAsset(assets, '7974.T');
assert(stock);
assert.strictEqual(stock.displaySymbol, 'TSE:7974');
assert.strictEqual(stock.priceUnit, 'JPY/share');
assert.strictEqual(stock.buyCount, 1);
assert.strictEqual(stock.sellCount, 1);
assert.strictEqual(stock.points[0].date, '2026-06-10');
assert.strictEqual(stock.points[0].side, 'BUY');
assert.strictEqual(stock.points[1].side, 'SELL');

var fund = findAsset(assets, 'FUND:TOPIX');
assert(fund);
assert.strictEqual(fund.priceUnit, 'JPY/10,000 units');
assert.strictEqual(fund.points[0].price, 12345);

var usStock = findAsset(assets, 'MCD');
assert(usStock);
assert.strictEqual(usStock.priceUnit, 'USD/share');
assert.strictEqual(usStock.points[0].date, '2026-06-07');
assert.strictEqual(usStock.points[0].marketDate, '2026-06-06');

var gold = findAsset(assets, 'GOLD_JPY');
assert(gold);
assert.strictEqual(gold.displaySymbol, 'GOLD_JPY');
assert.strictEqual(gold.priceUnit, 'JPY/gram');
assert.strictEqual(gold.points[0].price, 20000);

assert.strictEqual(findAsset(assets, 'USDJPY'), undefined);

sortTradeChartAssetsBySummaryRows(assets, [
  { symbol: 'MCD', marketValuePercent: 50 },
  { symbol: 'FUND:TOPIX', marketValuePercent: 30 },
  { symbol: '7974.T', marketValuePercent: 20 },
  { symbol: 'GOLD_JPY', marketValuePercent: 10 }
]);
assert.deepStrictEqual(assets.map(function (asset) { return asset.symbol; }), ['MCD', 'FUND:TOPIX', '7974.T', 'GOLD_JPY']);

attachPriceHistoryToTradeChartData(assets, [
  {
    symbol: '7974.T',
    priceDate: '2026-06-12',
    open: 12100,
    high: 12300,
    low: 12000,
    close: 12250,
    volume: 1000000,
    currency: 'JPY',
    source: 'YAHOO_CHART'
  },
  {
    symbol: '7974.T',
    priceDate: '2026-06-11',
    open: 11900,
    high: 12100,
    low: 0,
    close: 12050,
    volume: 900000,
    currency: 'JPY',
    source: 'YAHOO_CHART'
  },
  {
    symbol: '7974.T',
    priceDate: '2026-06-12',
    open: 12000,
    high: 12000,
    low: 12000,
    close: 12000,
    volume: null,
    currency: 'JPY',
    source: 'YAHOO_CHART_SNAPSHOT'
  },
  {
    symbol: 'FUND:TOPIX',
    assetType: 'FUND',
    priceDate: '2026-06-14',
    open: 91955,
    high: 91955,
    low: 91955,
    close: 91955,
    volume: null,
    currency: 'JPY',
    source: 'FUND_MAPPING'
  },
  {
    symbol: 'FUND:TOPIX',
    assetType: 'FUND',
    priceDate: '2026-06-14',
    open: 91955,
    high: 91955,
    low: 91955,
    close: 91955,
    volume: null,
    currency: 'JPY',
    source: 'YAHOO_FUND_HISTORY',
    netAssetsBalance: 236034,
    fetchedAt: '2026-06-14T09:00:00.000Z'
  },
  {
    symbol: 'FUND:TOPIX',
    assetType: 'FUND',
    priceDate: '2026-06-14',
    open: 92000,
    high: 92000,
    low: 92000,
    close: 92000,
    volume: null,
    currency: 'JPY',
    source: 'YAHOO_FUND_HISTORY',
    netAssetsBalance: 236500,
    fetchedAt: '2026-06-14T10:00:00.000Z'
  },
  {
    symbol: 'FUND:TOPIX',
    assetType: 'FUND',
    priceDate: '2026-06-17',
    open: 92000,
    high: 92000,
    low: 92000,
    close: 92000,
    volume: null,
    currency: 'JPY',
    source: 'YAHOO_FUND_HISTORY',
    fetchedAt: '2026-06-17T10:00:00.000Z'
  }
]);

stock = findAsset(assets, '7974.T');
assert.strictEqual(stock.historyCount, 2);
assert.strictEqual(stock.historyFirstDate, '2026-06-11');
assert.strictEqual(stock.historyLastDate, '2026-06-12');
assert.strictEqual(stock.priceHistory[0].close, 12050);
assert.strictEqual(stock.priceHistory[0].low, null);
assert.strictEqual(stock.priceHistory[1].high, 12300);
assert.strictEqual(stock.technicalIndicators.status, 'PARTIAL');
assert.strictEqual(stock.technicalIndicatorSeries.length, 2);
assert.strictEqual(stock.technicalIndicatorSeries[1].sma20, null);

fund = findAsset(assets, 'FUND:TOPIX');
assert.strictEqual(fund.historyCount, 1);
assert.strictEqual(fund.priceHistory[0].date, '2026-06-14');
assert.strictEqual(fund.priceHistory[0].source, 'YAHOO_FUND_HISTORY');
assert.strictEqual(fund.priceHistory[0].close, 92000);
assert.strictEqual(fund.technicalIndicators.status, 'PARTIAL');

var viewPath = path.join(__dirname, '..', 'views', 'trade-chart.ejs');
var html = ejs.render(fs.readFileSync(viewPath, 'utf8'), {
  assets: assets,
  chartDataJson: JSON.stringify(assets),
  appVersion: require('../package.json').version
}, { filename: viewPath });
assert.ok(html.indexOf('v' + require('../package.json').version) >= 0);
assert.ok(html.indexOf('Technical indicators') >= 0);
assert.ok(html.indexOf('showSma200') >= 0);
assert.ok(html.indexOf('id="rsiChart"') >= 0);
assert.ok(html.indexOf('id="macdChart"') >= 0);
assert.ok(html.indexOf("var rows = (asset.points || []).slice().reverse();") >= 0);
var scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || [];
scripts.forEach(function (script, index) {
  var source = script.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  new vm.Script(source, { filename: 'trade-chart-inline-' + index + '.js' });
});

console.log('tradeChart tests passed');
