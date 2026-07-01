var assert = require('assert');
var fs = require('fs');
var priceParsers = require('../app');
var parseSbiCsv = priceParsers.parseSbiCsv;
var parseFxCsv = priceParsers.parseFxCsv;
var parseGoldCsv = priceParsers.parseGoldCsv;
var buildCombinedSummaryTotals = priceParsers.buildCombinedSummaryTotals;
var normalizeAssetType = priceParsers.normalizeAssetType;
var makeSymbol = priceParsers.makeSymbol;
var parseSbiMmfPrice = priceParsers.parseSbiMmfPrice;
var calculateGoldPricePerGramJpy = priceParsers.calculateGoldPricePerGramJpy;
var buildGoldPriceHistoryRows = priceParsers.buildGoldPriceHistoryRows;
var getGoldHoldingStartDate = priceParsers.getGoldHoldingStartDate;
var findLatestBuyDatesBySymbol = priceParsers.findLatestBuyDatesBySymbol;
var findOldestBuyDatesBySymbol = priceParsers.findOldestBuyDatesBySymbol;
var findActiveQuantitySymbols = priceParsers.findActiveQuantitySymbols;
var findRemainingLotStartDatesBySymbol = priceParsers.findRemainingLotStartDatesBySymbol;
var isPriceHistoryBoundsRow = priceParsers.isPriceHistoryBoundsRow;
var getHistoryEndLimitDate = priceParsers.getHistoryEndLimitDate;
var getNextPriceHistoryWindow = priceParsers.getNextPriceHistoryWindow;
var makeLatestPriceHistoryRow = priceParsers.makeLatestPriceHistoryRow;
var makeFundPriceHistoryRow = priceParsers.makeFundPriceHistoryRow;
var parseYahooFundPriceHistory = priceParsers.parseYahooFundPriceHistory;
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

var fundHistoryRow = makeFundPriceHistoryRow(
  { symbol: 'FUND:semi', assetType: 'FUND' },
  { price: 35.8534, priceDate: '2026-06-15' }
);
assert.strictEqual(fundHistoryRow.symbol, 'FUND:semi');
assert.strictEqual(fundHistoryRow.close, 358534);
assert.strictEqual(fundHistoryRow.open, 358534);
assert.strictEqual(fundHistoryRow.source, 'YAHOO_FUND_SNAPSHOT');

var usStockHistoryRow = makeLatestPriceHistoryRow(
  { symbol: 'MCD', assetType: 'US_STOCK' },
  { price: 287, priceDate: '2026-06-12' }
);
assert.strictEqual(usStockHistoryRow.symbol, 'MCD');
assert.strictEqual(usStockHistoryRow.currency, 'USD');
assert.strictEqual(usStockHistoryRow.close, 287);
assert.strictEqual(usStockHistoryRow.source, 'YAHOO_CHART_SNAPSHOT');

var goldSnapshotRow = makeLatestPriceHistoryRow(
  { symbol: 'GOLD_JPY', assetType: 'GOLD' },
  { price: 21393.3, priceDate: '2026-06-12' }
);
assert.strictEqual(goldSnapshotRow.symbol, 'GOLD_JPY');
assert.strictEqual(goldSnapshotRow.currency, 'JPY');
assert.strictEqual(goldSnapshotRow.close, 21393.3);
assert.strictEqual(goldSnapshotRow.source, 'YAHOO_GOLD_SNAPSHOT');

var usdMoneyMarketFundRow = {
  assetName: 'ＳＢＩ岡三・ＵＳドル・マネー・マーケット・ファンド',
  code: 'X6587000',
  action: '買付',
  productCategory: ''
};
usdMoneyMarketFundRow.assetType = normalizeAssetType(usdMoneyMarketFundRow);
assert.strictEqual(usdMoneyMarketFundRow.assetType, 'FUND');
assert.strictEqual(makeSymbol(usdMoneyMarketFundRow), 'FUND:ＳＢＩ岡三・ＵＳドル・マネー・マーケット・ファンド');
assert.deepStrictEqual(parseSbiMmfPrice('0.0100USD(161.87円)'), {
  usdUnitPrice: 0.01,
  fxRate: 161.87,
  jpyUnitPrice: 1.6187
});

assert.strictEqual(isPriceHistoryBoundsRow({ source: 'YAHOO_CHART_SNAPSHOT' }, { assetType: 'STOCK' }), false);
assert.strictEqual(isPriceHistoryBoundsRow({ source: 'YAHOO_CHART' }, { assetType: 'STOCK' }), true);
assert.strictEqual(isPriceHistoryBoundsRow({ assetType: 'FUND', source: 'YAHOO_FUND_HISTORY' }, { assetType: 'FUND' }), false);
assert.strictEqual(isPriceHistoryBoundsRow({ assetType: 'FUND', source: 'YAHOO_FUND_HISTORY', netAssetsBalance: 100 }, { assetType: 'FUND' }), true);
assert.strictEqual(getHistoryEndLimitDate({ assetType: 'GOLD' }, '2026-06-18'), '2026-06-17');
assert.strictEqual(getHistoryEndLimitDate({ assetType: 'STOCK' }, '2026-06-18'), '2026-06-18');
assert.deepStrictEqual(
  getNextPriceHistoryWindow({ dates: ['2026-06-10', '2026-06-11'] }, '2026-06-01', '2026-06-18'),
  { startDate: '2026-06-12', endDate: '2026-06-18', reason: 'FORWARD' }
);
assert.deepStrictEqual(
  getNextPriceHistoryWindow({ dates: ['2026-06-10', '2026-06-11', '2026-06-12', '2026-06-16', '2026-06-18'] }, '2026-06-01', '2026-06-18'),
  { startDate: '2026-06-01', endDate: '2026-06-18', reason: 'GAP' }
);
assert.deepStrictEqual(
  getNextPriceHistoryWindow({ dates: ['2026-06-10', '2026-06-11', '2026-06-12'] }, '2026-06-01', '2026-06-12'),
  { startDate: '2026-06-01', endDate: '2026-06-09', reason: 'BACKFILL' }
);
assert.deepStrictEqual(
  getNextPriceHistoryWindow({ dates: ['2026-06-01', '2026-06-02', '2026-06-03'] }, '2026-06-01', '2026-06-03'),
  { startDate: '', endDate: '', reason: 'UP_TO_DATE' }
);

var yahooFundHistoryRows = parseYahooFundPriceHistory({
  histories: [
    { date: '2026年6月12日', price: '15,638', priceChange: '30', netAssetsBalance: '236,034' },
    { date: '2026年6月11日', price: '15,608', priceChange: '1', netAssetsBalance: '235,456' }
  ]
}, { symbol: 'FUND:bond', assetType: 'FUND' });
assert.strictEqual(yahooFundHistoryRows.length, 2);
assert.strictEqual(yahooFundHistoryRows[0].priceDate, '2026-06-12');
assert.strictEqual(yahooFundHistoryRows[0].close, 15638);
assert.strictEqual(yahooFundHistoryRows[0].netAssetsBalance, 236034);
assert.strictEqual(yahooFundHistoryRows[1].low, 15608);

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
assert.strictEqual(goldHolding.transactions.length, 13);
assert.strictEqual(goldHolding.transactions[0].assetType, 'GOLD');
assert.strictEqual(goldHolding.transactions[0].symbol, 'GOLD_JPY');
assert.strictEqual(goldHolding.transactions[0].tradeDate, '2026-01-30');
assert.strictEqual(goldHolding.transactions[0].quantity, 2.8016);
assert.strictEqual(goldHolding.transactions[0].price, 26057);
assert.strictEqual(goldHolding.transactions[0].fee, 1204);
assert.strictEqual(goldHolding.transactions[0].settlementAmount, 74204);
assert.strictEqual(getGoldHoldingStartDate(goldHolding), '2025-04-14');
assert.strictEqual(calculateGoldPricePerGramJpy(4224.8, 157.5), 21393.3);
assert.strictEqual(calculateGoldPricePerGramJpy(4224.8, null), null);

var goldHistoryRows = buildGoldPriceHistoryRows([
  {
    symbol: 'GC=F',
    priceDate: '2026-06-12',
    open: 4200,
    high: 4225,
    low: 4180,
    close: 4224.8,
    volume: 1200
  },
  {
    symbol: 'GC=F',
    priceDate: '2026-06-13',
    open: 4210,
    high: 4230,
    low: 4200,
    close: 4220,
    volume: 900
  }
], [
  { symbol: 'JPY=X', priceDate: '2026-06-12', close: 157.5 }
], { symbol: 'GOLD_JPY', assetType: 'GOLD' });
assert.strictEqual(goldHistoryRows.length, 2);
assert.strictEqual(goldHistoryRows[0].symbol, 'GOLD_JPY');
assert.strictEqual(goldHistoryRows[0].currency, 'JPY');
assert.strictEqual(goldHistoryRows[0].close, 21393.3);
assert.strictEqual(goldHistoryRows[0].source, 'YAHOO_GOLD_HISTORY');
assert.strictEqual(goldHistoryRows[0].volume, 1200);
assert.strictEqual(goldHistoryRows[1].priceDate, '2026-06-13');
assert.strictEqual(goldHistoryRows[1].close, calculateGoldPricePerGramJpy(4220, 157.5));
assert.strictEqual(goldHistoryRows[1].status, 'FX_FALLBACK');
assert.strictEqual(goldHistoryRows[1].fxRateDate, '2026-06-12');

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

var dailyPricesWithNull = parseYahooChartDailyPriceHistory({
  chart: {
    result: [{
      timestamp: [1781107200, 1781193600],
      indicators: {
        quote: [{
          open: [280.1, 281.4],
          high: [286.2, 287.5],
          low: [279.8, 280.2],
          close: [null, 286.1],
          volume: [1000000, 1200000]
        }]
      }
    }]
  }
}, { symbol: 'MCD', assetType: 'US_STOCK' });
assert.strictEqual(dailyPricesWithNull.length, 1);
assert.strictEqual(dailyPricesWithNull[0].priceDate, '2026-06-11');

var latestBuyDates = findLatestBuyDatesBySymbol([
  { assetType: 'STOCK', side: 'BUY', symbol: '7974.T', tradeDate: '2026-06-01' },
  { assetType: 'STOCK', side: 'SELL', symbol: '7974.T', tradeDate: '2026-06-05' },
  { assetType: 'STOCK', side: 'BUY', symbol: '7974.T', tradeDate: '2026-06-10' },
  { assetType: 'STOCK', side: 'BUY', symbol: 'ISO.T', tradeDateTime: '2026-04-15T09:00:00' },
  { assetType: 'US_STOCK', side: 'BUY', symbol: 'MCD', tradeDate: '2026-06-07' },
  { assetType: 'US_STOCK', side: 'BUY', symbol: 'BAD', tradeDate: '' },
  { assetType: 'FUND', side: 'BUY', symbol: 'FUND:TOPIX', tradeDate: '2026-06-08' }
]);
assert.strictEqual(latestBuyDates['7974.T'], '2026-06-10');
assert.strictEqual(latestBuyDates['ISO.T'], '2026-04-15');
assert.strictEqual(latestBuyDates.MCD, '2026-06-06');
assert.strictEqual(latestBuyDates.BAD, undefined);
assert.strictEqual(latestBuyDates['FUND:TOPIX'], undefined);

var oldestBuyDates = findOldestBuyDatesBySymbol([
  { assetType: 'STOCK', side: 'BUY', symbol: '7936.T', tradeDate: '2025-08-26', tradeDateTime: '2025-08-26T09:00:00', quantity: 100 },
  { assetType: 'STOCK', side: 'SELL', symbol: '7936.T', tradeDate: '2025-11-13', tradeDateTime: '2025-11-13T15:00:00', quantity: 100 },
  { assetType: 'STOCK', side: 'BUY', symbol: '7936.T', tradeDate: '2026-06-04', tradeDateTime: '2026-06-04T09:00:00', quantity: 100 },
  { assetType: 'US_STOCK', side: 'BUY', symbol: 'MCD', tradeDate: '2026-06-07', quantity: 3 }
]);
assert.strictEqual(oldestBuyDates['7936.T'], '2025-08-26');
assert.strictEqual(oldestBuyDates.MCD, '2026-06-06');

var activeQuantitySymbols = findActiveQuantitySymbols([
  { assetType: 'US_STOCK', side: 'BUY', symbol: 'MCD', tradeDate: '2026-06-07', quantity: 3, settlementCurrency: 'USD' },
  { assetType: 'US_STOCK', side: 'SELL', symbol: 'ZERO', tradeDate: '2026-06-07', quantity: 2 },
  { assetType: 'US_STOCK', side: 'BUY', symbol: 'ZERO', tradeDate: '2026-06-07', quantity: 2 },
  { assetType: 'GOLD', side: 'BUY', symbol: 'GOLD_JPY', tradeDate: '2025-04-14', quantity: 30.8104 }
]);
assert.strictEqual(activeQuantitySymbols.MCD, true);
assert.strictEqual(activeQuantitySymbols.ZERO, undefined);
assert.strictEqual(activeQuantitySymbols.GOLD_JPY, true);

var remainingLotDates = findRemainingLotStartDatesBySymbol([
  { assetType: 'STOCK', side: 'BUY', symbol: '7936.T', tradeDate: '2025-08-26', tradeDateTime: '2025-08-26T09:00:00', quantity: 100 },
  { assetType: 'STOCK', side: 'BUY', symbol: '7936.T', tradeDate: '2025-11-07', tradeDateTime: '2025-11-07T09:00:00', quantity: 100 },
  { assetType: 'STOCK', side: 'SELL', symbol: '7936.T', tradeDate: '2025-11-13', tradeDateTime: '2025-11-13T15:00:00', quantity: 100 },
  { assetType: 'STOCK', side: 'BUY', symbol: '7936.T', tradeDate: '2026-06-04', tradeDateTime: '2026-06-04T09:00:00', quantity: 100 }
]);
assert.strictEqual(remainingLotDates['7936.T'], '2025-11-07');

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
