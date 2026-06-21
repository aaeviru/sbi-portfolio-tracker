var buildPortfolioSummaryReport = require('./portfolioSummary').buildPortfolioSummaryReport;

function isNumber(value) {
  return typeof value == 'number' && isFinite(value);
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function getDateText(row) {
  var value = row && (row.tradeDate || row.tradeDateTime || row.settlementDate || row.date);
  if (!value) {
    return '';
  }
  return String(value).slice(0, 10);
}

function isValidDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
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
  var portfolioReport = buildPortfolioSummaryReport(periodTransactions, assetsBySymbol, priceHistoryBySymbol);
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
  var today = isValidDateText(options.today) ? options.today : new Date().toISOString().slice(0, 10);
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
  buildFxSummary: buildFxSummary
};
