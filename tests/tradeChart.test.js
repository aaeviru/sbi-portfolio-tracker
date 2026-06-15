var assert = require('assert');
var tradeChart = require('../lib/tradeChart');
var buildTradeChartData = tradeChart.buildTradeChartData;
var attachPriceHistoryToTradeChartData = tradeChart.attachPriceHistoryToTradeChartData;

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
  }
]);

stock = findAsset(assets, '7974.T');
assert.strictEqual(stock.historyCount, 2);
assert.strictEqual(stock.historyFirstDate, '2026-06-11');
assert.strictEqual(stock.historyLastDate, '2026-06-12');
assert.strictEqual(stock.priceHistory[0].close, 12050);
assert.strictEqual(stock.priceHistory[0].low, null);
assert.strictEqual(stock.priceHistory[1].high, 12300);

console.log('tradeChart tests passed');
