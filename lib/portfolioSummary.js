function isNumber(value) {
  return typeof value == 'number' && !isNaN(value);
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function getAmount(tx) {
  if (isNumber(tx.settlementAmount)) {
    return Math.abs(tx.settlementAmount);
  }

  if (isNumber(tx.quantity) && isNumber(tx.unitPrice)) {
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
    latestPrice: null,
    latestPriceCurrency: '',
    effectiveLatestPrice: null,
    effectiveLatestPriceCurrency: 'JPY',
    estimatedFxRate: null,
    latestPriceDate: '',
    latestPriceFetchedAt: '',
    priceFetchStatus: '',
    priceFetchError: '',
    priceSourceUrl: '',
    marketValue: null,
    unrealizedPl: null,
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

function applyBuy(summary, tx, amount) {
  summary.boughtQty += tx.quantity;
  summary.buyAmount += amount;
  if (summary.assetType == 'US_STOCK' && isNumber(tx.price) && tx.price > 0 && isNumber(tx.quantity) && tx.quantity > 0 && amount > 0) {
    summary.estimatedFxRate = roundMoney(amount / (tx.quantity * tx.price));
  }
  summary.lots.push({
    remainingQty: tx.quantity,
    costPerUnit: amount / tx.quantity
  });
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
  summary.latestPriceFetchedAt = asset.latestPriceFetchedAt || '';
  summary.priceFetchStatus = asset.priceFetchStatus || '';
  summary.priceFetchError = asset.priceFetchError || '';
  summary.priceSourceUrl = asset.priceSourceUrl || '';

  if (summary.latestPrice != null) {
    summary.effectiveLatestPrice = summary.assetType == 'US_STOCK' && isNumber(summary.estimatedFxRate)
      ? roundMoney(summary.latestPrice * summary.estimatedFxRate)
      : summary.latestPrice;
    summary.marketValue = roundMoney(summary.netQty * summary.effectiveLatestPrice);
    summary.unrealizedPl = roundMoney(summary.marketValue - summary.remainingCost);
  }
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
    var amount = getAmount(tx);

    summary.txCount++;

    if (tx.side != 'BUY' && tx.side != 'SELL') {
      return;
    }

    if (!isNumber(tx.quantity) || tx.quantity <= 0 || !isNumber(amount)) {
      addWarning(summary, 'Incomplete transaction excluded from FIFO.');
      return;
    }

    if (tx.side == 'BUY') {
      applyBuy(summary, tx, amount);
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
    delete summary.lots;
    applyAssetPrice(summary, assetsBySymbol[summary.symbol]);
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

function buildPortfolioSummaryReport(transactions, assetsBySymbol) {
  var rows = buildPortfolioSummary(transactions, assetsBySymbol);
  var totals = rows.reduce(function (total, row) {
    total.marketValue += isNumber(row.marketValue) ? row.marketValue : 0;
    total.unrealizedPl += isNumber(row.unrealizedPl) ? row.unrealizedPl : 0;
    total.realizedPl += isNumber(row.fifoRealizedPl) ? row.fifoRealizedPl : 0;
    return total;
  }, {
    marketValue: 0,
    unrealizedPl: 0,
    realizedPl: 0
  });

  totals.marketValue = roundMoney(totals.marketValue);
  totals.unrealizedPl = roundMoney(totals.unrealizedPl);
  totals.realizedPl = roundMoney(totals.realizedPl);
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
