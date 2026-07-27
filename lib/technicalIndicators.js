function isNumber(value) {
  return typeof value == 'number' && isFinite(value);
}

function round(value, decimals) {
  if (!isNumber(value)) {
    return null;
  }
  var factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function normalizeDate(value) {
  return String(value || '').slice(0, 10);
}

function normalizeDateTime(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value || '');
}

function sourcePriority(source) {
  if (source == 'YAHOO_CHART' || source == 'YAHOO_FUND_HISTORY' || source == 'YAHOO_GOLD_HISTORY') {
    return 3;
  }
  if (source == 'YAHOO_CHART_SNAPSHOT' || source == 'YAHOO_FUND_SNAPSHOT' ||
    source == 'YAHOO_GOLD_SNAPSHOT' || source == 'FUND_MAPPING') {
    return 1;
  }
  return 0;
}

function shouldReplace(existing, candidate) {
  if (!existing || candidate.priority > existing.priority) {
    return true;
  }
  if (candidate.priority < existing.priority) {
    return false;
  }
  return candidate.fetchedAt > existing.fetchedAt;
}

function normalizePriceHistory(rows) {
  var byDate = {};

  (rows || []).forEach(function (row) {
    if (!row || (row.assetType == 'FUND' && row.source == 'YAHOO_FUND_HISTORY' &&
      !Object.prototype.hasOwnProperty.call(row, 'netAssetsBalance'))) {
      return;
    }

    var date = normalizeDate(row.priceDate || row.price_date || row.date);
    var close = Number(row.close);
    if (!date || !isFinite(close) || close <= 0) {
      return;
    }

    var candidate = {
      date: date,
      high: isNumber(Number(row.high)) && Number(row.high) > 0 ? Number(row.high) : close,
      low: isNumber(Number(row.low)) && Number(row.low) > 0 ? Number(row.low) : close,
      close: close,
      currency: row.currency || '',
      source: row.source || '',
      priority: sourcePriority(row.source || ''),
      fetchedAt: normalizeDateTime(row.fetchedAt)
    };
    if (shouldReplace(byDate[date], candidate)) {
      byDate[date] = candidate;
    }
  });

  return Object.keys(byDate).map(function (date) {
    return byDate[date];
  }).sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
}

function average(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce(function (total, value) {
    return total + value;
  }, 0) / values.length;
}

function simpleMovingAverage(values, period) {
  if (values.length < period) {
    return null;
  }
  return average(values.slice(values.length - period));
}

function simpleMovingAverageSeries(values, period) {
  var result = values.map(function () { return null; });
  if (values.length < period) {
    return result;
  }

  var rollingTotal = 0;
  for (var i = 0; i < values.length; i++) {
    rollingTotal += values[i];
    if (i >= period) {
      rollingTotal -= values[i - period];
    }
    if (i >= period - 1) {
      result[i] = rollingTotal / period;
    }
  }
  return result;
}

function calculateRsi(values, period) {
  if (values.length <= period) {
    return null;
  }

  var gainTotal = 0;
  var lossTotal = 0;
  for (var i = 1; i <= period; i++) {
    var change = values[i] - values[i - 1];
    gainTotal += Math.max(change, 0);
    lossTotal += Math.max(-change, 0);
  }

  var averageGain = gainTotal / period;
  var averageLoss = lossTotal / period;
  for (var j = period + 1; j < values.length; j++) {
    var nextChange = values[j] - values[j - 1];
    averageGain = ((averageGain * (period - 1)) + Math.max(nextChange, 0)) / period;
    averageLoss = ((averageLoss * (period - 1)) + Math.max(-nextChange, 0)) / period;
  }

  if (averageLoss === 0) {
    return averageGain === 0 ? 50 : 100;
  }
  return 100 - (100 / (1 + (averageGain / averageLoss)));
}

function calculateRsiSeries(values, period) {
  var result = values.map(function () { return null; });
  if (values.length <= period) {
    return result;
  }

  var gainTotal = 0;
  var lossTotal = 0;
  for (var i = 1; i <= period; i++) {
    var initialChange = values[i] - values[i - 1];
    gainTotal += Math.max(initialChange, 0);
    lossTotal += Math.max(-initialChange, 0);
  }

  var averageGain = gainTotal / period;
  var averageLoss = lossTotal / period;
  result[period] = averageLoss === 0 ? (averageGain === 0 ? 50 : 100) :
    100 - (100 / (1 + (averageGain / averageLoss)));

  for (var j = period + 1; j < values.length; j++) {
    var change = values[j] - values[j - 1];
    averageGain = ((averageGain * (period - 1)) + Math.max(change, 0)) / period;
    averageLoss = ((averageLoss * (period - 1)) + Math.max(-change, 0)) / period;
    result[j] = averageLoss === 0 ? (averageGain === 0 ? 50 : 100) :
      100 - (100 / (1 + (averageGain / averageLoss)));
  }
  return result;
}

function exponentialMovingAverageSeries(values, period) {
  var result = values.map(function () { return null; });
  if (values.length < period) {
    return result;
  }

  var multiplier = 2 / (period + 1);
  result[period - 1] = average(values.slice(0, period));
  for (var i = period; i < values.length; i++) {
    result[i] = ((values[i] - result[i - 1]) * multiplier) + result[i - 1];
  }
  return result;
}

function calculateMacd(values, fastPeriod, slowPeriod, signalPeriod) {
  if (values.length < slowPeriod + signalPeriod - 1) {
    return null;
  }

  var fast = exponentialMovingAverageSeries(values, fastPeriod);
  var slow = exponentialMovingAverageSeries(values, slowPeriod);
  var macdValues = [];
  for (var i = slowPeriod - 1; i < values.length; i++) {
    macdValues.push(fast[i] - slow[i]);
  }

  var signalValues = exponentialMovingAverageSeries(macdValues, signalPeriod);
  var line = macdValues[macdValues.length - 1];
  var signal = signalValues[signalValues.length - 1];
  return {
    line: round(line, 4),
    signal: round(signal, 4),
    histogram: round(line - signal, 4)
  };
}

function calculateMacdSeries(values, fastPeriod, slowPeriod, signalPeriod) {
  var result = values.map(function () { return null; });
  var fast = exponentialMovingAverageSeries(values, fastPeriod);
  var slow = exponentialMovingAverageSeries(values, slowPeriod);
  var macdValues = [];
  var macdIndexes = [];

  for (var i = slowPeriod - 1; i < values.length; i++) {
    macdValues.push(fast[i] - slow[i]);
    macdIndexes.push(i);
  }

  var signalValues = exponentialMovingAverageSeries(macdValues, signalPeriod);
  for (var j = 0; j < macdValues.length; j++) {
    if (signalValues[j] == null) {
      continue;
    }
    result[macdIndexes[j]] = {
      line: macdValues[j],
      signal: signalValues[j],
      histogram: macdValues[j] - signalValues[j]
    };
  }
  return result;
}

function calculateBollinger(values, period, standardDeviations) {
  if (values.length < period) {
    return null;
  }

  var window = values.slice(values.length - period);
  var middle = average(window);
  var variance = window.reduce(function (total, value) {
    return total + Math.pow(value - middle, 2);
  }, 0) / period;
  var deviation = Math.sqrt(variance);

  return {
    lower: round(middle - (standardDeviations * deviation), 4),
    middle: round(middle, 4),
    upper: round(middle + (standardDeviations * deviation), 4)
  };
}

function calculateBollingerSeries(values, period, standardDeviations) {
  return values.map(function (value, index) {
    if (index < period - 1) {
      return null;
    }
    return calculateBollinger(values.slice(index - period + 1, index + 1), period, standardDeviations);
  });
}

function calculateRealizedVolatility(values, returnPeriod) {
  if (values.length <= returnPeriod) {
    return null;
  }

  var window = values.slice(values.length - returnPeriod - 1);
  var returns = [];
  for (var i = 1; i < window.length; i++) {
    returns.push(Math.log(window[i] / window[i - 1]));
  }

  var mean = average(returns);
  var variance = returns.reduce(function (total, value) {
    return total + Math.pow(value - mean, 2);
  }, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function calculateRealizedVolatilitySeries(values, returnPeriod) {
  return values.map(function (value, index) {
    if (index < returnPeriod) {
      return null;
    }
    return calculateRealizedVolatility(values.slice(index - returnPeriod, index + 1), returnPeriod);
  });
}

function subtractDays(dateText, days) {
  var date = new Date(dateText + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function calculate52WeekRange(history) {
  if (!history.length) {
    return null;
  }

  var latest = history[history.length - 1];
  var cutoff = subtractDays(latest.date, 365);
  var rows = history.filter(function (row) {
    return row.date >= cutoff;
  });
  if (!rows.length || rows[0].date > subtractDays(latest.date, 330)) {
    return null;
  }

  var high = Math.max.apply(Math, rows.map(function (row) { return row.high; }));
  var low = Math.min.apply(Math, rows.map(function (row) { return row.low; }));
  return {
    high: round(high, 4),
    low: round(low, 4),
    distanceFromHighPercent: round(((latest.close / high) - 1) * 100, 2),
    distanceFromLowPercent: round(((latest.close / low) - 1) * 100, 2),
    drawdownPercent: round(((latest.close / high) - 1) * 100, 2)
  };
}

function isMoneyMarketFund(holding) {
  return holding && (holding.assetSubType == 'MMF' ||
    /マネー[・･]?マーケット[・･]?ファンド|money market fund/i.test(holding.name || holding.assetName || holding.symbol || ''));
}

function getPriceUnit(holding) {
  if (holding.assetType == 'US_STOCK') {
    return 'USD/share';
  }
  if (holding.assetType == 'FUND') {
    return 'JPY/10,000 units';
  }
  if (holding.assetType == 'GOLD') {
    return 'JPY/gram';
  }
  return 'JPY/share';
}

function buildTechnicalIndicatorSeries(holding, priceHistoryRows) {
  if (isMoneyMarketFund(holding)) {
    return [];
  }

  var history = normalizePriceHistory(priceHistoryRows);
  var closes = history.map(function (row) { return row.close; });
  var sma20 = simpleMovingAverageSeries(closes, 20);
  var sma50 = simpleMovingAverageSeries(closes, 50);
  var sma200 = simpleMovingAverageSeries(closes, 200);
  var rsi14 = calculateRsiSeries(closes, 14);
  var macd = calculateMacdSeries(closes, 12, 26, 9);
  var bollinger = calculateBollingerSeries(closes, 20, 2);
  var volatility = calculateRealizedVolatilitySeries(closes, 20);

  return history.map(function (row, index) {
    return {
      date: row.date,
      close: round(row.close, 4),
      sma20: round(sma20[index], 4),
      sma50: round(sma50[index], 4),
      sma200: round(sma200[index], 4),
      rsi14: round(rsi14[index], 2),
      macd12_26_9: macd[index] ? {
        line: round(macd[index].line, 4),
        signal: round(macd[index].signal, 4),
        histogram: round(macd[index].histogram, 4)
      } : null,
      bollinger20_2: bollinger[index],
      realizedVolatility20DayAnnualizedPercent: round(volatility[index], 2)
    };
  });
}

function buildTechnicalIndicators(holding, priceHistoryRows) {
  var base = {
    symbol: holding.symbol,
    name: holding.name || holding.assetName || holding.symbol,
    assetType: holding.assetType,
    status: 'NO_HISTORY',
    reason: '',
    asOfDate: '',
    priceUnit: getPriceUnit(holding),
    observations: 0,
    latestClose: null,
    sma20: null,
    sma50: null,
    sma200: null,
    rsi14: null,
    macd12_26_9: null,
    bollinger20_2: null,
    range52Week: null,
    realizedVolatility20DayAnnualizedPercent: null
  };

  if (isMoneyMarketFund(holding)) {
    base.status = 'NOT_APPLICABLE';
    base.reason = 'Money-market funds are excluded because their stable NAV does not provide useful technical signals.';
    return base;
  }

  var history = normalizePriceHistory(priceHistoryRows);
  if (!history.length) {
    base.reason = 'No valid daily closing-price history is stored.';
    return base;
  }

  var latest = history[history.length - 1];
  var series = buildTechnicalIndicatorSeries(holding, history);
  var latestSeries = series[series.length - 1];
  base.asOfDate = latest.date;
  base.observations = history.length;
  base.latestClose = round(latest.close, 4);
  base.sma20 = latestSeries.sma20;
  base.sma50 = latestSeries.sma50;
  base.sma200 = latestSeries.sma200;
  base.rsi14 = latestSeries.rsi14;
  base.macd12_26_9 = latestSeries.macd12_26_9;
  base.bollinger20_2 = latestSeries.bollinger20_2;
  base.range52Week = calculate52WeekRange(history);
  base.realizedVolatility20DayAnnualizedPercent = latestSeries.realizedVolatility20DayAnnualizedPercent;

  base.status = base.sma200 != null && base.range52Week ? 'OK' : 'PARTIAL';
  if (base.status == 'PARTIAL') {
    base.reason = 'Some indicators are unavailable because the stored history does not cover enough daily closes.';
  }
  return base;
}

module.exports = {
  buildTechnicalIndicators: buildTechnicalIndicators,
  buildTechnicalIndicatorSeries: buildTechnicalIndicatorSeries,
  normalizePriceHistory: normalizePriceHistory,
  simpleMovingAverage: simpleMovingAverage,
  simpleMovingAverageSeries: simpleMovingAverageSeries,
  calculateRsi: calculateRsi,
  calculateRsiSeries: calculateRsiSeries,
  calculateMacd: calculateMacd,
  calculateMacdSeries: calculateMacdSeries,
  calculateBollinger: calculateBollinger,
  calculateRealizedVolatility: calculateRealizedVolatility,
  calculate52WeekRange: calculate52WeekRange
};
