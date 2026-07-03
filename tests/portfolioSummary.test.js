var assert = require('assert');
var buildPortfolioSummary = require('../lib/portfolioSummary').buildPortfolioSummary;
var buildPortfolioSummaryReport = require('../lib/portfolioSummary').buildPortfolioSummaryReport;

function find(rows, symbol) {
  return rows.filter(function (row) {
    return row.symbol == symbol;
  })[0];
}

var sameDayRows = buildPortfolioSummary([
  {
    tradeDateTime: '2025-09-30T15:00:00',
    assetType: 'STOCK',
    code: '7974',
    symbol: '7974.T',
    assetName: '任天堂',
    side: 'SELL',
    quantity: 100,
    unitPrice: 12760,
    settlementAmount: 1276000
  },
  {
    tradeDateTime: '2025-09-30T09:00:00',
    assetType: 'STOCK',
    code: '7974',
    symbol: '7974.T',
    assetName: '任天堂',
    side: 'BUY',
    quantity: 100,
    unitPrice: 12700,
    settlementAmount: 1270000
  }
]);

var nintendo = find(sameDayRows, '7974.T');
assert.strictEqual(nintendo.assetClass, '日本株');
assert.strictEqual(nintendo.displaySymbol, 'TSE:7974');
assert.strictEqual(nintendo.txCount, 2);
assert.strictEqual(nintendo.boughtQty, 100);
assert.strictEqual(nintendo.soldQty, 100);
assert.strictEqual(nintendo.netQty, 0);
assert.strictEqual(nintendo.netInvested, -6000);
assert.strictEqual(nintendo.fifoRealizedPl, 6000);
assert.strictEqual(nintendo.remainingCost, 0);
assert.strictEqual(nintendo.hasWarning, false);

var fundRows = buildPortfolioSummary([
  {
    tradeDateTime: '2024-05-27T09:00:00',
    assetType: 'FUND',
    symbol: 'FUND:ニッセイ日経２２５インデックスファンド',
    assetName: 'ニッセイ日経２２５インデックスファンド',
    side: 'BUY',
    quantity: 1044,
    unitPrice: 4.7903,
    settlementAmount: 5000
  },
  {
    tradeDateTime: '2024-06-03T09:00:00',
    assetType: 'FUND',
    symbol: 'FUND:ニッセイ日経２２５インデックスファンド',
    assetName: 'ニッセイ日経２２５インデックスファンド',
    side: 'BUY',
    quantity: 1044,
    unitPrice: 4.7928,
    settlementAmount: 5000
  }
]);

var fund = find(fundRows, 'FUND:ニッセイ日経２２５インデックスファンド');
assert.strictEqual(fund.assetClass, '投資信託');
assert.strictEqual(fund.code, '');
assert.strictEqual(fund.soldQty, 0);
assert.strictEqual(fund.sellAmount, 0);
assert.strictEqual(fund.netQty, 2088);
assert.strictEqual(fund.fifoRealizedPl, 0);
assert.strictEqual(fund.remainingCost, 10000);

var incomeReport = buildPortfolioSummaryReport([
  {
    tradeDate: '2026-06-01',
    tradeDateTime: '2026-06-01T09:00:00',
    assetType: 'STOCK',
    code: '7974',
    symbol: '7974.T',
    assetName: 'Nintendo',
    side: 'BUY',
    quantity: 100,
    settlementAmount: 100000
  },
  {
    tradeDate: '2026-06-29',
    tradeDateTime: '2026-06-29T12:00:00',
    assetType: 'STOCK',
    code: '7974',
    symbol: '7974.T',
    assetName: 'Nintendo',
    side: 'DIVIDEND',
    quantity: 100,
    distributionAmountJpy: 14105,
    settlementAmount: 14105,
    settlementCurrency: 'JPY'
  },
  {
    tradeDate: '2026-06-30',
    tradeDateTime: '2026-06-30T12:00:00',
    assetType: 'FUND',
    assetSubType: 'MMF',
    symbol: 'FUND:USDMMF',
    assetName: 'USD MMF',
    side: 'DISTRIBUTION',
    quantity: 61777,
    distributionAmountJpy: 38.58,
    settlementAmount: 38.58,
    settlementCurrency: 'JPY'
  }
], {
  '7974.T': { latestPrice: 1100, latestPriceDate: '2026-06-30' }
});

var incomeNintendo = find(incomeReport.rows, '7974.T');
var incomeMmf = find(incomeReport.rows, 'FUND:USDMMF');
assert.strictEqual(incomeNintendo.incomeAmount, 14105);
assert.strictEqual(incomeNintendo.dividendIncome, 14105);
assert.strictEqual(incomeNintendo.realizedPl, 14105);
assert.strictEqual(incomeNintendo.totalPl, 24105);
assert.strictEqual(incomeMmf.incomeAmount, 38.58);
assert.strictEqual(incomeMmf.distributionIncome, 38.58);
assert.strictEqual(incomeMmf.totalPl, 38.58);
assert.strictEqual(incomeReport.totals.realizedPl, 14143.58);
assert.strictEqual(incomeReport.totals.totalPl, 24143.58);

var mmfRows = buildPortfolioSummary([
  {
    tradeDate: '2026-06-24',
    tradeDateTime: '2026-06-24T09:00:00',
    assetType: 'FUND',
    productCategory: '外貨建ＭＭＦ',
    symbol: 'FUND:ＳＢＩ岡三・ＵＳドル・マネー・マーケット・ファンド（米ドル）',
    assetName: 'ＳＢＩ岡三・ＵＳドル・マネー・マーケット・ファンド（米ドル）',
    side: 'BUY',
    quantity: 61777,
    unitPrice: null,
    settlementAmount: 99998
  }
]);

var mmf = find(mmfRows, 'FUND:ＳＢＩ岡三・ＵＳドル・マネー・マーケット・ファンド（米ドル）');
assert.strictEqual(mmf.assetSubType, 'MMF');
assert.strictEqual(mmf.latestPrice, 1.61869304);
assert.strictEqual(mmf.latestPriceDate, '2026-06-24');
assert.strictEqual(mmf.priceFetchStatus, 'IMPORTED_MMF_PRICE');
assert.strictEqual(mmf.marketValue, 99998);
assert.strictEqual(mmf.unrealizedPl, 0);

var pricedRows = buildPortfolioSummary([
  {
    tradeDateTime: '2025-01-01T09:00:00',
    assetType: 'STOCK',
    code: '7936',
    symbol: '7936.T',
    assetName: 'アシックス',
    side: 'BUY',
    quantity: 100,
    unitPrice: 1000,
    settlementAmount: 100000
  },
  {
    tradeDateTime: '2025-01-02T09:00:00',
    assetType: 'STOCK',
    code: '7936',
    symbol: '7936.T',
    assetName: 'アシックス',
    side: 'BUY',
    quantity: 100,
    unitPrice: 1200,
    settlementAmount: 120000
  },
  {
    tradeDateTime: '2025-01-03T15:00:00',
    assetType: 'STOCK',
    code: '7936',
    symbol: '7936.T',
    assetName: 'アシックス',
    side: 'SELL',
    quantity: 50,
    unitPrice: 1300,
    settlementAmount: 65000
  }
], {
  '7936.T': {
    latestPrice: 1500,
    latestPriceDate: '2026-06-10',
    latestPriceFetchedAt: '2026-06-10T00:00:00.000Z',
    priceFetchStatus: 'OK',
    priceFetchError: ''
  }
});

var asics = find(pricedRows, '7936.T');
assert.strictEqual(asics.netQty, 150);
assert.strictEqual(asics.remainingCost, 170000);
assert.strictEqual(asics.fifoRealizedPl, 15000);
assert.strictEqual(asics.marketValue, 225000);
assert.strictEqual(asics.unrealizedPl, 55000);
assert.strictEqual(asics.unrealizedPlPercent, 32.35);
assert.strictEqual(asics.totalPl, 70000);
assert.strictEqual(asics.latestPrice, 1500);

var report = buildPortfolioSummaryReport([
  {
    tradeDateTime: '2025-01-01T09:00:00',
    assetType: 'STOCK',
    code: '7936',
    symbol: '7936.T',
    assetName: 'アシックス',
    side: 'BUY',
    quantity: 100,
    unitPrice: 1000,
    settlementAmount: 100000
  },
  {
    tradeDateTime: '2025-01-01T09:00:00',
    assetType: 'STOCK',
    code: '7974',
    symbol: '7974.T',
    assetName: '任天堂',
    side: 'BUY',
    quantity: 100,
    unitPrice: 2000,
    settlementAmount: 200000
  }
], {
  '7936.T': { latestPrice: 1500 },
  '7974.T': { latestPrice: 3000 }
});

var reportAsics = find(report.rows, '7936.T');
var reportNintendo = find(report.rows, '7974.T');
assert.strictEqual(report.totals.marketValue, 450000);
assert.strictEqual(report.totals.unrealizedPl, 150000);
assert.strictEqual(report.totals.realizedPl, 0);
assert.strictEqual(report.totals.totalPl, 150000);
assert.strictEqual(reportAsics.marketValuePercent, 33.33);
assert.strictEqual(reportAsics.unrealizedPlPercent, 50);
assert.strictEqual(reportAsics.totalPl, 50000);
assert.strictEqual(reportNintendo.marketValuePercent, 66.67);
assert.strictEqual(reportNintendo.unrealizedPlPercent, 50);
assert.strictEqual(reportNintendo.totalPl, 100000);
assert.strictEqual(report.rows[0].symbol, '7974.T');
assert.strictEqual(report.rows[1].symbol, '7936.T');

var dayChangeReport = buildPortfolioSummaryReport([
  {
    tradeDateTime: '2026-06-01T09:00:00',
    assetType: 'STOCK',
    code: '1111',
    symbol: '1111.T',
    assetName: 'Day Change Stock',
    side: 'BUY',
    quantity: 10,
    unitPrice: 90,
    settlementAmount: 900
  },
  {
    tradeDateTime: '2026-06-01T09:00:00',
    assetType: 'FUND',
    symbol: 'FUND:Day Change Fund',
    assetName: 'Day Change Fund',
    side: 'BUY',
    quantity: 10000,
    unitPrice: 1.4,
    settlementAmount: 14000
  },
  {
    tradeDateTime: '2026-06-01T09:00:00',
    assetType: 'US_STOCK',
    code: 'ABC',
    symbol: 'ABC',
    assetName: 'Day Change US',
    side: 'BUY',
    quantity: 2,
    unitPrice: 190,
    price: 190,
    settlementAmount: 58900
  }
], {
  '1111.T': { latestPrice: 110, latestPriceDate: '2026-06-12' },
  'FUND:Day Change Fund': { latestPrice: 1.6, latestPriceDate: '2026-06-12' },
  ABC: { latestPrice: 210, latestPriceDate: '2026-06-12', latestFxRate: 155 }
}, {
  '1111.T': [
    { symbol: '1111.T', priceDate: '2026-06-12', close: 110 },
    { symbol: '1111.T', priceDate: '2026-06-11', close: 100 }
  ],
  'FUND:Day Change Fund': [
    { symbol: 'FUND:Day Change Fund', priceDate: '2026-06-12', close: 16000 },
    { symbol: 'FUND:Day Change Fund', priceDate: '2026-06-11', close: 15000 }
  ],
  ABC: [
    { symbol: 'ABC', priceDate: '2026-06-12', close: 210 },
    { symbol: 'ABC', priceDate: '2026-06-11', close: 200 }
  ]
});

var dayChangeStock = find(dayChangeReport.rows, '1111.T');
var dayChangeFund = find(dayChangeReport.rows, 'FUND:Day Change Fund');
var dayChangeUs = find(dayChangeReport.rows, 'ABC');
assert.strictEqual(dayChangeStock.previousPriceDate, '2026-06-11');
assert.strictEqual(dayChangeStock.previousMarketValue, 1000);
assert.strictEqual(dayChangeStock.dayPl, 100);
assert.strictEqual(dayChangeStock.dayPlPercent, 10);
assert.strictEqual(dayChangeFund.previousPrice, 1.5);
assert.strictEqual(dayChangeFund.previousMarketValue, 15000);
assert.strictEqual(dayChangeFund.dayPl, 1000);
assert.strictEqual(dayChangeUs.previousEffectivePrice, 31000);
assert.strictEqual(dayChangeUs.previousMarketValue, 62000);
assert.strictEqual(dayChangeUs.dayPl, 3100);
assert.strictEqual(dayChangeReport.totals.dayPl, 4200);

var alphaCodeRows = buildPortfolioSummary([
  {
    tradeDateTime: '2026-06-10T09:00:00',
    assetType: 'STOCK',
    code: '520A1',
    symbol: '520A1.T',
    assetName: 'ジェイファーマ',
    side: 'BUY',
    quantity: 100,
    unitPrice: 392,
    settlementAmount: 39200
  }
]);

var jPharma = find(alphaCodeRows, '520A.T');
assert.strictEqual(jPharma.code, '520A');
assert.strictEqual(jPharma.symbol, '520A.T');
assert.strictEqual(jPharma.displaySymbol, 'TSE:520A');

var usRows = buildPortfolioSummary([
  {
    tradeDateTime: '2026-05-28T09:00:00',
    assetType: 'US_STOCK',
    code: 'NVDA',
    symbol: 'NVDA',
    assetName: 'エヌビディア',
    side: 'BUY',
    quantity: 1,
    unitPrice: 209.635,
    settlementAmount: 33517
  }
]);

var nvda = find(usRows, 'NVDA');
assert.strictEqual(nvda.assetClass, '米国株');
assert.strictEqual(nvda.code, 'NVDA');
assert.strictEqual(nvda.symbol, 'NVDA');
assert.strictEqual(nvda.displaySymbol, 'NVDA');
assert.strictEqual(nvda.remainingCost, 33517);

var pricedUsRows = buildPortfolioSummary([
  {
    tradeDateTime: '2026-05-28T09:00:00',
    assetType: 'US_STOCK',
    code: 'NVDA',
    symbol: 'NVDA',
    assetName: 'エヌビディア',
    side: 'BUY',
    quantity: 1,
    unitPrice: 209.635,
    price: 209.635,
    settlementAmount: 33517
  }
], {
  NVDA: { latestPrice: 210 }
});

var pricedNvda = find(pricedUsRows, 'NVDA');
assert.strictEqual(pricedNvda.latestPrice, 210);
assert.strictEqual(pricedNvda.latestPriceCurrency, 'USD');
assert.strictEqual(pricedNvda.estimatedFxRate, 159.88);
assert.strictEqual(pricedNvda.effectiveLatestPrice, 33574.8);
assert.strictEqual(pricedNvda.marketValue, 33574.8);
assert.strictEqual(pricedNvda.unrealizedPl, 57.8);

var liveFxUsRows = buildPortfolioSummary([
  {
    tradeDateTime: '2026-05-28T09:00:00',
    assetType: 'US_STOCK',
    code: 'NVDA',
    symbol: 'NVDA',
    assetName: 'エヌビディア',
    side: 'BUY',
    quantity: 1,
    unitPrice: 209.635,
    price: 209.635,
    settlementAmount: 33517
  }
], {
  NVDA: { latestPrice: 210, latestFxRate: 155, latestFxRatePair: 'USDJPY', latestFxRateDate: '2026-06-12' }
});

var liveFxNvda = find(liveFxUsRows, 'NVDA');
assert.strictEqual(liveFxNvda.estimatedFxRate, 159.88);
assert.strictEqual(liveFxNvda.latestFxRate, 155);
assert.strictEqual(liveFxNvda.latestFxRatePair, 'USDJPY');
assert.strictEqual(liveFxNvda.effectiveLatestPrice, 32550);
assert.strictEqual(liveFxNvda.marketValue, 32550);
assert.strictEqual(liveFxNvda.unrealizedPl, -967);

var usdSettlementRows = buildPortfolioSummary([
  {
    tradeDateTime: '2026-06-12T09:00:00',
    assetType: 'US_STOCK',
    code: 'MCD',
    symbol: 'MCD',
    assetName: 'マクドナルド',
    side: 'BUY',
    quantity: 3,
    unitPrice: 283.38,
    price: 283.38,
    settlementAmount: 854.34,
    settlementCurrency: 'USD'
  }
], {
  MCD: { latestPrice: 290, latestFxRate: 155, latestFxRatePair: 'USDJPY', latestFxRateDate: '2026-06-12' }
});

var mcd = find(usdSettlementRows, 'MCD');
assert.strictEqual(mcd.buyAmount, 132422.7);
assert.strictEqual(mcd.remainingCost, 132422.7);
assert.strictEqual(mcd.marketValue, 134850);
assert.strictEqual(mcd.unrealizedPl, 2427.3);

var legacyUsdSettlementRows = buildPortfolioSummary([
  {
    tradeDateTime: '2026-06-12T09:00:00',
    assetType: 'US_STOCK',
    code: 'MCD',
    symbol: 'MCD',
    assetName: 'マクドナルド',
    side: 'BUY',
    quantity: 3,
    unitPrice: 283.38,
    price: 283.38,
    settlementAmount: 854.34,
    settlementCurrency: 'JPY'
  }
], {
  MCD: { latestPrice: 290, latestFxRate: 155, latestFxRatePair: 'USDJPY', latestFxRateDate: '2026-06-12' }
});

var legacyMcd = find(legacyUsdSettlementRows, 'MCD');
assert.strictEqual(legacyMcd.buyAmount, 132422.7);
assert.strictEqual(legacyMcd.remainingCost, 132422.7);
assert.strictEqual(legacyMcd.unrealizedPl, 2427.3);

var usdSettlementMissingFxRows = buildPortfolioSummary([
  {
    tradeDateTime: '2026-06-12T09:00:00',
    assetType: 'US_STOCK',
    code: 'MCD',
    symbol: 'MCD',
    assetName: 'マクドナルド',
    side: 'BUY',
    quantity: 3,
    unitPrice: 283.38,
    price: 283.38,
    settlementAmount: 854.34,
    settlementCurrency: 'USD'
  }
]);

var missingFxMcd = find(usdSettlementMissingFxRows, 'MCD');
assert.strictEqual(missingFxMcd.buyAmount, 0);
assert.strictEqual(missingFxMcd.hasWarning, true);

var goldRows = buildPortfolioSummary([
  {
    tradeDateTime: '9999-12-31T09:00:00',
    assetType: 'GOLD',
    code: '',
    symbol: 'GOLD_JPY',
    assetName: 'Gold',
    side: 'BUY',
    quantity: 10,
    unitPrice: 12000,
    settlementAmount: 120000
  }
], {
  GOLD_JPY: { latestPrice: 13000, latestPriceDate: '2026-06-10' }
});

var gold = find(goldRows, 'GOLD_JPY');
assert.strictEqual(gold.assetClass, 'Gold');
assert.strictEqual(gold.displaySymbol, 'GOLD/JPY');
assert.strictEqual(gold.netQty, 10);
assert.strictEqual(gold.remainingCost, 120000);
assert.strictEqual(gold.latestPriceCurrency, 'JPY');
assert.strictEqual(gold.marketValue, 130000);
assert.strictEqual(gold.unrealizedPl, 10000);

var warningRows = buildPortfolioSummary([
  {
    tradeDateTime: '2025-01-01T15:00:00',
    assetType: 'STOCK',
    code: '8306',
    symbol: '8306.T',
    assetName: '三菱ＵＦＪフィナンシャル・グループ',
    side: 'SELL',
    quantity: 100,
    unitPrice: 1200,
    settlementAmount: 120000
  }
]);

var warning = find(warningRows, '8306.T');
assert.strictEqual(warning.hasWarning, true);

console.log('portfolioSummary tests passed');
