var assert = require('assert');
var buildPortfolioSummaryReport = require('../lib/portfolioSummary').buildPortfolioSummaryReport;
var historyLib = require('../lib/combinedSummaryHistory');
var buildCombinedSummaryHistory = historyLib.buildCombinedSummaryHistory;
var buildCombinedSummaryTotals = historyLib.buildCombinedSummaryTotals;
var buildFxSummary = historyLib.buildFxSummary;

var transactions = [
  {
    tradeDate: '2026-05-20',
    tradeDateTime: '2026-05-20T09:00:00',
    assetType: 'STOCK',
    code: '7974',
    symbol: '7974.T',
    assetName: 'Nintendo',
    side: 'BUY',
    quantity: 100,
    unitPrice: 1000,
    settlementAmount: 100000
  },
  {
    tradeDate: '2026-06-10',
    tradeDateTime: '2026-06-10T09:00:00',
    assetType: 'STOCK',
    code: '7936',
    symbol: '7936.T',
    assetName: 'Asics',
    side: 'BUY',
    quantity: 100,
    unitPrice: 2000,
    settlementAmount: 200000
  },
  {
    tradeDate: '2026-06-12',
    tradeDateTime: '2026-06-12T15:00:00',
    assetType: 'STOCK',
    code: '7974',
    symbol: '7974.T',
    assetName: 'Nintendo',
    side: 'SELL',
    quantity: 50,
    unitPrice: 1200,
    settlementAmount: 60000
  }
];

var fxTrades = [
  {
    tradeDate: '2026-06-15',
    tradeDateTime: '2026-06-15T15:00:00',
    pair: 'USD/JPY',
    action: '決済売',
    quantity: 1000,
    realizedSwap: 100,
    realizedPl: 900,
    totalPl: 1000
  }
];

var assetsBySymbol = {
  '7974.T': { latestPrice: 1300, latestPriceDate: '2026-06-18' },
  '7936.T': { latestPrice: 2500, latestPriceDate: '2026-06-18' }
};

var priceHistoryBySymbol = {
  '7974.T': [
    { symbol: '7974.T', priceDate: '2026-06-18', close: 1300 },
    { symbol: '7974.T', priceDate: '2026-06-17', close: 1250 }
  ],
  '7936.T': [
    { symbol: '7936.T', priceDate: '2026-06-18', close: 2500 },
    { symbol: '7936.T', priceDate: '2026-06-17', close: 2400 }
  ]
};

var history = buildCombinedSummaryHistory({
  transactions: transactions,
  fxTrades: fxTrades,
  assetsBySymbol: assetsBySymbol,
  priceHistoryBySymbol: priceHistoryBySymbol,
  today: '2026-06-19'
});

var currentReport = buildPortfolioSummaryReport(transactions, assetsBySymbol, priceHistoryBySymbol);
var currentFxSummary = buildFxSummary(fxTrades);
var currentCombinedTotals = buildCombinedSummaryTotals(currentReport.totals, currentFxSummary.totals);

var currentMonth = history.monthly.filter(function (row) {
  return row.key == '2026-06';
})[0];
var currentYear = history.yearly.filter(function (row) {
  return row.key == '2026';
})[0];
var may = history.monthly.filter(function (row) {
  return row.key == '2026-05';
})[0];

assert.deepStrictEqual(currentMonth.totals, currentCombinedTotals);
assert.deepStrictEqual(currentYear.totals, currentCombinedTotals);
assert.strictEqual(currentMonth.txCount, 3);
assert.strictEqual(currentMonth.fxTxCount, 1);
assert.strictEqual(may.txCount, 1);
assert.strictEqual(may.fxTxCount, 0);
assert.strictEqual(may.totals.fxTotalPl, 0);
assert.strictEqual(currentMonth.combinedTotalPlDiff, currentMonth.totals.combinedTotalPl - may.totals.combinedTotalPl);
assert.strictEqual(may.combinedTotalPlDiff, null);
assert.strictEqual(currentYear.combinedTotalPlDiff, null);

console.log('combinedSummaryHistory tests passed');
