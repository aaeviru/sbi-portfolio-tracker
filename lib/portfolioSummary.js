var dateDomains = require('./dateDomains');

function isNumber(value) {
  return typeof value == 'number' && !isNaN(value);
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function isLikelyUsdSettlement(tx) {
  if (tx.assetType != 'US_STOCK') {
    return false;
  }
  if (tx.settlementCurrency == 'USD') {
    return true;
  }
  if (!isNumber(tx.settlementAmount) || !isNumber(tx.quantity) || !isNumber(tx.price)) {
    return false;
  }
  var grossUsd = tx.quantity * tx.price;
  if (grossUsd <= 0) {
    return false;
  }

  var settlementToTradeRatio = Math.abs(tx.settlementAmount) / grossUsd;
  return settlementToTradeRatio > 0.5 && settlementToTradeRatio < 2;
}

function isUsdSettlement(tx) {
  return tx && tx.settlementCurrency == 'USD' && (tx.assetType == 'US_STOCK' || isMmfTransaction(tx));
}

function getAmount(tx, fxRate) {
  if (isNumber(tx.settlementAmount)) {
    if (isLikelyUsdSettlement(tx) || isUsdSettlement(tx)) {
      return isNumber(fxRate) ? Math.abs(tx.settlementAmount * fxRate) : null;
    }
    return Math.abs(tx.settlementAmount);
  }

  if (isNumber(tx.quantity) && isNumber(tx.unitPrice)) {
    if (isLikelyUsdSettlement(tx)) {
      return isNumber(fxRate) ? Math.abs(tx.quantity * tx.unitPrice * fxRate) : null;
    }
    return Math.abs(tx.quantity * tx.unitPrice);
  }

  return null;
}

function getAssetClass(assetType) {
  if (assetType == 'GOLD') {
    return 'Gold';
  }
  if (assetType == 'US_STOCK') {
    return '米国株';
  }
  if (assetType == 'STOCK') {
    return '日本株';
  }
  if (assetType == 'FUND') {
    return '投資信託';
  }
  return assetType || 'UNKNOWN';
}

function normalizeStockCode(code) {
  code = String(code || '').trim().toUpperCase();
  var alphaCode = code.match(/^([0-9]{3}[A-Z])/);
  if (alphaCode) {
    return alphaCode[1];
  }
  return code;
}

function isMmfTransaction(tx) {
  return tx && (tx.assetSubType == 'MMF' || /外貨建ＭＭＦ|外貨建MMF|ＭＭＦ|MMF|マネー・マーケット/.test(String(tx.productCategory || '') + ' ' + String(tx.assetName || '')));
}

function getDisplaySymbol(tx) {
  if (tx.assetType == 'GOLD') {
    return 'GOLD/JPY';
  }
  if (tx.assetType == 'US_STOCK' && tx.code) {
    return tx.code;
  }
  if (tx.assetType == 'STOCK' && tx.code) {
    return 'TSE:' + normalizeStockCode(tx.code);
  }
  return tx.symbol || '';
}

function getSummarySymbol(tx) {
  if (tx.assetType == 'GOLD') {
    return 'GOLD_JPY';
  }
  if (tx.assetType == 'US_STOCK' && tx.code) {
    return String(tx.code || '').trim().toUpperCase();
  }
  if (tx.assetType == 'STOCK' && tx.code) {
    return normalizeStockCode(tx.code) + '.T';
  }
  return tx.symbol || '';
}

function makeEmptySummary(tx) {
  var symbol = getSummarySymbol(tx);
  return {
    assetClass: getAssetClass(tx.assetType),
    assetType: tx.assetType || 'UNKNOWN',
    assetSubType: isMmfTransaction(tx) ? 'MMF' : tx.assetSubType || '',
    code: tx.assetType == 'STOCK' ? normalizeStockCode(tx.code) : tx.assetType == 'US_STOCK' ? String(tx.code || '').trim().toUpperCase() : '',
    symbol: symbol,
    displaySymbol: getDisplaySymbol(tx),
    name: tx.assetName || '',
    txCount: 0,
    boughtQty: 0,
    buyAmount: 0,
    soldQty: 0,
    sellAmount: 0,
    netQty: 0,
    netInvested: 0,
    remainingCost: 0,
    fifoRealizedPl: 0,
    incomeAmount: 0,
    dividendIncome: 0,
    distributionIncome: 0,
    realizedPl: 0,
    latestPrice: null,
    latestPriceCurrency: '',
    effectiveLatestPrice: null,
    effectiveLatestPriceCurrency: 'JPY',
    estimatedFxRate: null,
    latestFxRate: null,
    latestFxRatePair: '',
    latestFxRateDate: '',
    latestFxRateDateBasis: '',
    latestFxRateSourceTimezone: '',
    latestPriceDate: '',
    latestPriceDateBasis: '',
    latestPriceSourceTimezone: '',
    priceDateLabel: dateDomains.getPriceDateLabel(tx),
    latestPriceFetchedAt: '',
    priceFetchStatus: '',
    priceFetchError: '',
    priceSourceUrl: '',
    importedLatestPrice: null,
    importedLatestPriceDate: '',
    marketValue: null,
    unrealizedPl: null,
    unrealizedPlPercent: null,
    totalPl: null,
    previousPrice: null,
    previousEffectivePrice: null,
    previousPriceDate: '',
    previousMarketValue: null,
    dayPl: null,
    dayPlPercent: null,
    hasWarning: false,
    warning: '',
    lots: []
  };
}

function addWarning(summary, message) {
  summary.hasWarning = true;
  if (summary.warning) {
    summary.warning += ' ';
  }
  summary.warning += message;
}

function applyBuy(summary, tx, amount, fxRate) {
  summary.boughtQty += tx.quantity;
  summary.buyAmount += amount;
  if (summary.assetType == 'US_STOCK' && !isLikelyUsdSettlement(tx) && isNumber(tx.price) && tx.price > 0 && isNumber(tx.quantity) && tx.quantity > 0 && amount > 0) {
    summary.estimatedFxRate = roundMoney(amount / (tx.quantity * tx.price));
  }
  summary.lots.push({
    remainingQty: tx.quantity,
    costPerUnit: amount / tx.quantity
  });

  if (summary.assetSubType == 'MMF') {
    if (isNumber(tx.mmfFxRate) && tx.mmfFxRate > 0) {
      summary.estimatedFxRate = tx.mmfFxRate;
    } else if (isUsdSettlement(tx) && isNumber(fxRate) && fxRate > 0) {
      summary.estimatedFxRate = fxRate;
    }

    var importedUnitPrice = null;
    if (isUsdSettlement(tx)) {
      var usdUnitPrice = isNumber(tx.mmfUsdUnitPrice) && tx.mmfUsdUnitPrice > 0
        ? tx.mmfUsdUnitPrice
        : isNumber(tx.unitPrice) && tx.unitPrice > 0
          ? tx.unitPrice
          : isNumber(tx.settlementAmount) && isNumber(tx.quantity) && tx.quantity > 0
            ? Math.abs(tx.settlementAmount) / tx.quantity
            : null;
      var mmfFxRate = isNumber(fxRate) ? fxRate : summary.estimatedFxRate;
      if (isNumber(usdUnitPrice) && isNumber(mmfFxRate)) {
        importedUnitPrice = Math.round(usdUnitPrice * mmfFxRate * 100000000) / 100000000;
      }
    } else {
      importedUnitPrice = isNumber(tx.unitPrice) && tx.unitPrice > 0
        ? tx.unitPrice
        : isNumber(tx.settlementAmount) && isNumber(tx.quantity) && tx.quantity > 0
          ? Math.round(Math.abs(tx.settlementAmount) / tx.quantity * 100000000) / 100000000
          : null;
    }
    var tradeDate = tx.tradeDate || String(tx.tradeDateTime || '').slice(0, 10);
    if (isNumber(importedUnitPrice) && (!summary.importedLatestPriceDate || tradeDate >= summary.importedLatestPriceDate)) {
      summary.importedLatestPrice = importedUnitPrice;
      summary.importedLatestPriceDate = tradeDate;
    }
  }
}

function applySell(summary, tx, amount) {
  var remainingSellQty = tx.quantity;
  var proceedsPerUnit = amount / tx.quantity;

  summary.soldQty += tx.quantity;
  summary.sellAmount += amount;

  while (remainingSellQty > 0 && summary.lots.length > 0) {
    var lot = summary.lots[0];
    var consumedQty = Math.min(remainingSellQty, lot.remainingQty);

    summary.fifoRealizedPl += consumedQty * (proceedsPerUnit - lot.costPerUnit);
    lot.remainingQty -= consumedQty;
    remainingSellQty -= consumedQty;

    if (lot.remainingQty <= 0.0000001) {
      summary.lots.shift();
    }
  }

  if (remainingSellQty > 0.0000001) {
    addWarning(summary, 'SELL quantity exceeded available FIFO lots.');
  }
}

function getIncomeAmount(tx, fxRate) {
  if (isNumber(tx.distributionAmountJpy)) {
    return Math.abs(tx.distributionAmountJpy);
  }
  if (tx.settlementCurrency == 'JPY' && isNumber(tx.settlementAmount)) {
    return Math.abs(tx.settlementAmount);
  }
  if (isNumber(tx.settlementAmount) && isNumber(fxRate)) {
    return Math.abs(tx.settlementAmount * fxRate);
  }
  if (isNumber(tx.settlementAmount)) {
    return Math.abs(tx.settlementAmount);
  }
  return null;
}

function applyIncome(summary, tx, amount) {
  summary.incomeAmount += amount;
  if (tx.side == 'DIVIDEND') {
    summary.dividendIncome += amount;
  } else {
    summary.distributionIncome += amount;
  }
}

function compareTransactions(a, b) {
  var aDateTime = a.tradeDateTime || '';
  var bDateTime = b.tradeDateTime || '';
  if (aDateTime < bDateTime) {
    return -1;
  }
  if (aDateTime > bDateTime) {
    return 1;
  }

  var aSymbol = a.symbol || '';
  var bSymbol = b.symbol || '';
  if (aSymbol < bSymbol) {
    return -1;
  }
  if (aSymbol > bSymbol) {
    return 1;
  }

  return 0;
}

function applyAssetPrice(summary, asset) {
  if (!asset) {
    return;
  }

  summary.latestPrice = isNumber(asset.latestPrice) ? asset.latestPrice : null;
  summary.latestPriceCurrency = summary.assetType == 'US_STOCK' ? 'USD' : 'JPY';
  summary.latestPriceDate = asset.latestPriceDate || '';
  summary.latestPriceDateBasis = asset.latestPriceDateBasis || '';
  summary.latestPriceSourceTimezone = asset.latestPriceSourceTimezone || '';
  summary.latestPriceFetchedAt = asset.latestPriceFetchedAt || '';
  summary.priceFetchStatus = asset.priceFetchStatus || '';
  summary.priceFetchError = asset.priceFetchError || '';
  summary.priceSourceUrl = asset.priceSourceUrl || '';
  summary.latestFxRate = isNumber(asset.latestFxRate) ? asset.latestFxRate : null;
  summary.latestFxRatePair = asset.latestFxRatePair || '';
  summary.latestFxRateDate = asset.latestFxRateDate || '';
  summary.latestFxRateDateBasis = asset.latestFxRateDateBasis || '';
  summary.latestFxRateSourceTimezone = asset.latestFxRateSourceTimezone || '';

  if (summary.latestPrice != null) {
    var fxRate = isNumber(summary.latestFxRate) ? summary.latestFxRate : summary.estimatedFxRate;
    summary.effectiveLatestPrice = summary.assetType == 'US_STOCK' && isNumber(fxRate)
      ? roundMoney(summary.latestPrice * fxRate)
      : summary.latestPrice;
    summary.marketValue = roundMoney(summary.netQty * summary.effectiveLatestPrice);
    summary.unrealizedPl = roundMoney(summary.marketValue - summary.remainingCost);
    summary.unrealizedPlPercent = summary.remainingCost > 0
      ? roundMoney(summary.unrealizedPl / summary.remainingCost * 100)
      : null;
    summary.totalPl = roundMoney(summary.unrealizedPl + summary.realizedPl);
  }
}

function applyImportedMmfPrice(summary) {
  if (summary.assetSubType != 'MMF' || summary.latestPrice != null || !isNumber(summary.importedLatestPrice) || Math.abs(summary.netQty) <= 0.0000001) {
    return;
  }

  summary.latestPrice = summary.importedLatestPrice;
  summary.latestPriceCurrency = 'JPY';
  summary.effectiveLatestPrice = summary.importedLatestPrice;
  summary.latestPriceDate = summary.importedLatestPriceDate;
  summary.latestPriceDateBasis = 'SBI_TRANSACTION_DATE';
  summary.priceFetchStatus = 'IMPORTED_MMF_PRICE';
  summary.priceFetchError = '';
  summary.marketValue = roundMoney(summary.netQty * summary.effectiveLatestPrice);
  summary.unrealizedPl = roundMoney(summary.marketValue - summary.remainingCost);
  summary.unrealizedPlPercent = summary.remainingCost > 0
    ? roundMoney(summary.unrealizedPl / summary.remainingCost * 100)
    : null;
  summary.totalPl = roundMoney(summary.unrealizedPl + summary.realizedPl);
}

function getPriceHistoryDate(row) {
  return row ? row.priceDate || row.price_date || row.date || '' : '';
}

function getPriceHistoryClose(row) {
  if (!row) {
    return null;
  }

  if (isNumber(row.close)) {
    return row.close;
  }
  if (isNumber(row.latestPrice)) {
    return row.latestPrice;
  }
  if (isNumber(row.price)) {
    return row.price;
  }

  return null;
}

function getSummaryUnitPrice(summary, rawPrice) {
  if (!isNumber(rawPrice) || rawPrice <= 0) {
    return null;
  }

  if (summary.assetType == 'FUND') {
    return rawPrice / 10000;
  }

  return rawPrice;
}

function getEffectivePrice(summary, unitPrice) {
  if (!isNumber(unitPrice)) {
    return null;
  }

  if (summary.assetType == 'US_STOCK') {
    var fxRate = isNumber(summary.latestFxRate) ? summary.latestFxRate : summary.estimatedFxRate;
    return isNumber(fxRate) ? roundMoney(unitPrice * fxRate) : null;
  }

  return unitPrice;
}

function findPreviousPriceHistoryRow(summary, rows) {
  var sorted = (rows || []).filter(function (row) {
    return getPriceHistoryDate(row) && isNumber(getPriceHistoryClose(row)) && getPriceHistoryClose(row) > 0;
  }).sort(function (a, b) {
    return getPriceHistoryDate(a) < getPriceHistoryDate(b) ? 1 : -1;
  });

  if (summary.latestPriceDate) {
    for (var i = 0; i < sorted.length; i++) {
      if (getPriceHistoryDate(sorted[i]) < summary.latestPriceDate) {
        return sorted[i];
      }
    }
    return null;
  }

  var latestDate = '';
  for (var j = 0; j < sorted.length; j++) {
    var date = getPriceHistoryDate(sorted[j]);
    if (!latestDate) {
      latestDate = date;
    } else if (date != latestDate) {
      return sorted[j];
    }
  }

  return null;
}

function applyDayChange(summary, priceHistoryRows) {
  if (!isNumber(summary.marketValue) || !isNumber(summary.netQty) || Math.abs(summary.netQty) <= 0.0000001) {
    return;
  }

  var previousRow = findPreviousPriceHistoryRow(summary, priceHistoryRows);
  var previousUnitPrice = getSummaryUnitPrice(summary, getPriceHistoryClose(previousRow));
  var previousEffectivePrice = getEffectivePrice(summary, previousUnitPrice);
  if (!isNumber(previousEffectivePrice)) {
    return;
  }

  summary.previousPrice = previousUnitPrice;
  summary.previousEffectivePrice = previousEffectivePrice;
  summary.previousPriceDate = getPriceHistoryDate(previousRow);
  summary.previousMarketValue = roundMoney(summary.netQty * previousEffectivePrice);
  summary.dayPl = roundMoney(summary.marketValue - summary.previousMarketValue);
  summary.dayPlPercent = summary.previousMarketValue > 0
    ? roundMoney(summary.dayPl / summary.previousMarketValue * 100)
    : null;
}

function buildPortfolioSummary(transactions, assetsBySymbol) {
  var summaries = {};
  var sorted = transactions.slice().sort(compareTransactions);
  assetsBySymbol = assetsBySymbol || {};

  sorted.forEach(function (tx) {
    var key = getSummarySymbol(tx) || tx.assetName || 'UNKNOWN';
    if (!summaries[key]) {
      summaries[key] = makeEmptySummary(tx);
    }

    var summary = summaries[key];
    var asset = assetsBySymbol[summary.symbol] || {};
    var fxRate = isNumber(asset.latestFxRate)
      ? asset.latestFxRate
      : isNumber(summary.estimatedFxRate)
        ? summary.estimatedFxRate
        : isNumber(tx.mmfFxRate)
          ? tx.mmfFxRate
          : null;
    var amount = getAmount(tx, fxRate);

    summary.txCount++;

    if (tx.side == 'DIVIDEND' || tx.side == 'DISTRIBUTION') {
      var incomeAmount = getIncomeAmount(tx, fxRate);
      if (isNumber(incomeAmount)) {
        applyIncome(summary, tx, incomeAmount);
      } else {
        addWarning(summary, 'Income transaction missing JPY amount.');
      }
      return;
    }

    if (tx.side != 'BUY' && tx.side != 'SELL') {
      return;
    }

    if (!isNumber(tx.quantity) || tx.quantity <= 0 || !isNumber(amount)) {
      addWarning(summary, isLikelyUsdSettlement(tx)
        ? 'USD settlement transaction needs latest USD/JPY rate for JPY FIFO.'
        : 'Incomplete transaction excluded from FIFO.');
      return;
    }

    if (tx.side == 'BUY') {
      applyBuy(summary, tx, amount, fxRate);
    } else if (tx.side == 'SELL') {
      applySell(summary, tx, amount);
    }
  });

  return Object.keys(summaries).map(function (key) {
    var summary = summaries[key];
    summary.netQty = summary.boughtQty - summary.soldQty;
    summary.netInvested = roundMoney(summary.buyAmount - summary.sellAmount);
    summary.remainingCost = roundMoney(summary.lots.reduce(function (total, lot) {
      return total + (lot.remainingQty * lot.costPerUnit);
    }, 0));
    summary.fifoRealizedPl = roundMoney(summary.fifoRealizedPl);
    summary.incomeAmount = roundMoney(summary.incomeAmount);
    summary.dividendIncome = roundMoney(summary.dividendIncome);
    summary.distributionIncome = roundMoney(summary.distributionIncome);
    summary.realizedPl = roundMoney(summary.fifoRealizedPl + summary.incomeAmount);
    delete summary.lots;
    applyAssetPrice(summary, assetsBySymbol[summary.symbol]);
    applyImportedMmfPrice(summary);
    if (summary.totalPl == null && summary.realizedPl !== 0) {
      summary.totalPl = summary.realizedPl;
    }
    return summary;
  }).sort(function (a, b) {
    if (a.assetClass < b.assetClass) {
      return -1;
    }
    if (a.assetClass > b.assetClass) {
      return 1;
    }
    if (a.displaySymbol < b.displaySymbol) {
      return -1;
    }
    if (a.displaySymbol > b.displaySymbol) {
      return 1;
    }
    return 0;
  });
}

function buildPortfolioSummaryReport(transactions, assetsBySymbol, priceHistoryBySymbol) {
  var rows = buildPortfolioSummary(transactions, assetsBySymbol);
  priceHistoryBySymbol = priceHistoryBySymbol || {};

  rows.forEach(function (row) {
    applyDayChange(row, priceHistoryBySymbol[row.symbol]);
  });

  var totals = rows.reduce(function (total, row) {
    total.marketValue += isNumber(row.marketValue) ? row.marketValue : 0;
    total.unrealizedPl += isNumber(row.unrealizedPl) ? row.unrealizedPl : 0;
    total.realizedPl += isNumber(row.realizedPl) ? row.realizedPl : isNumber(row.fifoRealizedPl) ? row.fifoRealizedPl : 0;
    total.dayPl += isNumber(row.dayPl) ? row.dayPl : 0;
    return total;
  }, {
    marketValue: 0,
    unrealizedPl: 0,
    realizedPl: 0,
    dayPl: 0
  });

  totals.marketValue = roundMoney(totals.marketValue);
  totals.unrealizedPl = roundMoney(totals.unrealizedPl);
  totals.realizedPl = roundMoney(totals.realizedPl);
  totals.dayPl = roundMoney(totals.dayPl);
  totals.totalPl = roundMoney(totals.unrealizedPl + totals.realizedPl);

  rows.forEach(function (row) {
    row.marketValuePercent = totals.marketValue > 0 && isNumber(row.marketValue)
      ? roundMoney(row.marketValue / totals.marketValue * 100)
      : null;
  });

  rows.sort(function (a, b) {
    var aHasPercent = isNumber(a.marketValuePercent);
    var bHasPercent = isNumber(b.marketValuePercent);

    if (aHasPercent && bHasPercent) {
      if (a.marketValuePercent != b.marketValuePercent) {
        return b.marketValuePercent - a.marketValuePercent;
      }
      return (a.displaySymbol || '').localeCompare(b.displaySymbol || '');
    }

    if (aHasPercent) {
      return -1;
    }
    if (bHasPercent) {
      return 1;
    }

    return (a.displaySymbol || '').localeCompare(b.displaySymbol || '');
  });

  return {
    rows: rows,
    totals: totals
  };
}

module.exports = {
  buildPortfolioSummary: buildPortfolioSummary,
  buildPortfolioSummaryReport: buildPortfolioSummaryReport
};
