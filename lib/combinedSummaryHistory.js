var buildPortfolioSummaryReport = require('./portfolioSummary').buildPortfolioSummaryReport;

function isNumber(value) {
  return typeof value == 'number' && isFinite(value);
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function normalizeDateText(value) {
  value = String(value || '').trim();
  var match = value.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (!match) {
    return '';
  }
  return match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0');
}

function getDateText(row) {
  var value = row && (row.tradeDate || row.tradeDateTime || row.settlementDate || row.date);
  if (!value) {
    return '';
  }
  return normalizeDateText(value);
}

function isValidDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizeDateText(value));
}

function addMonths(monthKey, amount) {
  var parts = monthKey.split('-');
  var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1 + amount, 1));
  return date.toISOString().slice(0, 7);
}

function monthEndDate(monthKey) {
  var parts = monthKey.split('-');
  var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]), 0));
  return date.toISOString().slice(0, 10);
}

function yearEndDate(yearKey) {
  return yearKey + '-12-31';
}

function findDateBounds(transactions, fxTrades, today) {
  var minDate = today;
  var maxDate = today;

  transactions.concat(fxTrades || []).forEach(function (row) {
    var date = getDateText(row);
    if (!isValidDateText(date)) {
      return;
    }
    if (!minDate || date < minDate) {
      minDate = date;
    }
    if (!maxDate || date > maxDate) {
      maxDate = date;
    }
  });

  if (today > maxDate) {
    maxDate = today;
  }

  return { minDate: minDate, maxDate: maxDate };
}

function buildMonthlyPeriods(transactions, fxTrades, today) {
  var bounds = findDateBounds(transactions, fxTrades, today);
  var start = bounds.minDate.slice(0, 7);
  var end = bounds.maxDate.slice(0, 7);
  var periods = [];
  var current = start;

  while (current <= end) {
    periods.push({
      type: 'month',
      key: current,
      label: current,
      endDate: current == today.slice(0, 7) ? today : monthEndDate(current),
      isCurrent: current == today.slice(0, 7)
    });
    current = addMonths(current, 1);
  }

  return periods;
}

function buildYearlyPeriods(transactions, fxTrades, today) {
  var bounds = findDateBounds(transactions, fxTrades, today);
  var startYear = Number(bounds.minDate.slice(0, 4));
  var endYear = Number(bounds.maxDate.slice(0, 4));
  var currentYear = today.slice(0, 4);
  var periods = [];

  for (var year = startYear; year <= endYear; year++) {
    var key = String(year);
    periods.push({
      type: 'year',
      key: key,
      label: key,
      endDate: key == currentYear ? today : yearEndDate(key),
      isCurrent: key == currentYear
    });
  }

  return periods;
}

function filterRowsThrough(rows, endDate) {
  return (rows || []).filter(function (row) {
    var date = getDateText(row);
    return isValidDateText(date) && date <= endDate;
  });
}

function getPriceHistoryDate(row) {
  return normalizeDateText(row && (row.priceDate || row.price_date || row.date));
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

function getPeriodUnitPrice(asset, row) {
  var close = getPriceHistoryClose(row);
  if (!isNumber(close) || close <= 0) {
    return null;
  }
  return asset && asset.assetType == 'FUND' ? close / 10000 : close;
}

function findLatestPriceHistoryRowThrough(rows, endDate) {
  return (rows || []).filter(function (row) {
    var date = getPriceHistoryDate(row);
    return isValidDateText(date) && date <= endDate && isNumber(getPriceHistoryClose(row));
  }).sort(function (a, b) {
    return getPriceHistoryDate(a) < getPriceHistoryDate(b) ? 1 : -1;
  })[0] || null;
}

function buildPeriodAssetsBySymbol(assetsBySymbol, priceHistoryBySymbol, endDate, useLivePrices) {
  if (useLivePrices) {
    return assetsBySymbol;
  }

  var periodAssets = {};
  Object.keys(assetsBySymbol || {}).forEach(function (symbol) {
    var asset = Object.assign({}, assetsBySymbol[symbol]);
    var historyRow = findLatestPriceHistoryRowThrough((priceHistoryBySymbol || {})[symbol], endDate);
    var unitPrice = getPeriodUnitPrice(asset, historyRow);
    if (isNumber(unitPrice)) {
      asset.latestPrice = unitPrice;
      asset.latestPriceDate = getPriceHistoryDate(historyRow);
      asset.latestPriceFetchedAt = historyRow.fetchedAt || asset.latestPriceFetchedAt || '';
      asset.priceFetchStatus = 'HISTORICAL_PRICE';
      asset.priceFetchError = '';
    }
    periodAssets[symbol] = asset;
  });
  return periodAssets;
}

function buildFxSummary(trades) {
  var totals = { realizedSwap: 0, realizedPl: 0, totalPl: 0 };

  (trades || []).forEach(function (trade) {
    totals.realizedSwap += isNumber(trade.realizedSwap) ? trade.realizedSwap : 0;
    totals.realizedPl += isNumber(trade.realizedPl) ? trade.realizedPl : 0;
    totals.totalPl += isNumber(trade.totalPl) ? trade.totalPl : 0;
  });

  totals.realizedSwap = Math.round(totals.realizedSwap);
  totals.realizedPl = Math.round(totals.realizedPl);
  totals.totalPl = Math.round(totals.totalPl);
  return { totals: totals };
}

function buildCombinedSummaryTotals(portfolioTotals, fxTotals) {
  portfolioTotals = portfolioTotals || {};
  fxTotals = fxTotals || {};

  var portfolioMarketValue = portfolioTotals.marketValue || 0;
  var portfolioUnrealizedPl = portfolioTotals.unrealizedPl || 0;
  var portfolioRealizedPl = portfolioTotals.realizedPl || 0;
  var portfolioTotalPl = portfolioTotals.totalPl || 0;
  var portfolioDayPl = portfolioTotals.dayPl || 0;
  var fxTotalPl = fxTotals.totalPl || 0;

  return {
    portfolioMarketValue: roundMoney(portfolioMarketValue),
    portfolioUnrealizedPl: roundMoney(portfolioUnrealizedPl),
    portfolioRealizedPl: roundMoney(portfolioRealizedPl),
    portfolioTotalPl: roundMoney(portfolioTotalPl),
    portfolioDayPl: roundMoney(portfolioDayPl),
    fxTotalPl: roundMoney(fxTotalPl),
    combinedRealizedPl: roundMoney(portfolioRealizedPl + fxTotalPl),
    combinedTotalPl: roundMoney(portfolioTotalPl + fxTotalPl)
  };
}

function buildPeriodRow(period, transactions, fxTrades, assetsBySymbol, priceHistoryBySymbol) {
  var periodTransactions = filterRowsThrough(transactions, period.endDate);
  var periodFxTrades = filterRowsThrough(fxTrades, period.endDate);
  var periodAssetsBySymbol = buildPeriodAssetsBySymbol(assetsBySymbol, priceHistoryBySymbol, period.endDate, period.isCurrent);
  var portfolioReport = buildPortfolioSummaryReport(periodTransactions, periodAssetsBySymbol, priceHistoryBySymbol);
  var fxSummary = buildFxSummary(periodFxTrades);
  var totals = buildCombinedSummaryTotals(portfolioReport.totals, fxSummary.totals);

  return {
    type: period.type,
    key: period.key,
    label: period.label,
    endDate: period.endDate,
    isCurrent: period.isCurrent,
    txCount: periodTransactions.length,
    fxTxCount: periodFxTrades.length,
    totals: totals
  };
}

function attachCombinedTotalPlDiff(rows) {
  rows.forEach(function (row, index) {
    var previousRow = rows[index + 1];
    row.combinedTotalPlDiff = previousRow
      ? roundMoney(row.totals.combinedTotalPl - previousRow.totals.combinedTotalPl)
      : null;
  });
  return rows;
}

function buildCombinedSummaryHistory(options) {
  options = options || {};
  var transactions = options.transactions || [];
  var fxTrades = options.fxTrades || [];
  var today = isValidDateText(options.today) ? normalizeDateText(options.today) : new Date().toISOString().slice(0, 10);
  var assetsBySymbol = options.assetsBySymbol || {};
  var priceHistoryBySymbol = options.priceHistoryBySymbol || {};

  var monthly = buildMonthlyPeriods(transactions, fxTrades, today).map(function (period) {
    return buildPeriodRow(period, transactions, fxTrades, assetsBySymbol, priceHistoryBySymbol);
  }).sort(function (a, b) {
    return a.key < b.key ? 1 : -1;
  });

  var yearly = buildYearlyPeriods(transactions, fxTrades, today).map(function (period) {
    return buildPeriodRow(period, transactions, fxTrades, assetsBySymbol, priceHistoryBySymbol);
  }).sort(function (a, b) {
    return a.key < b.key ? 1 : -1;
  });

  return {
    monthly: attachCombinedTotalPlDiff(monthly),
    yearly: attachCombinedTotalPlDiff(yearly)
  };
}

module.exports = {
  buildCombinedSummaryHistory: buildCombinedSummaryHistory,
  buildCombinedSummaryTotals: buildCombinedSummaryTotals,
  buildFxSummary: buildFxSummary,
  normalizeDateText: normalizeDateText
};
