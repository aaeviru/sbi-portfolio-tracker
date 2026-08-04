var REPORT_TIME_ZONE = 'Asia/Tokyo';
var US_MARKET_TIME_ZONE = 'America/New_York';

function isValidDate(value) {
  return value instanceof Date && !isNaN(value.getTime());
}

function toDate(value) {
  if (value === undefined || value === null) {
    return new Date();
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  return new Date(value);
}

function getDateTimeParts(value, timeZone) {
  var date = toDate(value);
  if (!isValidDate(date)) {
    return null;
  }

  var parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  var values = {};
  parts.forEach(function (part) {
    if (part.type != 'literal') {
      values[part.type] = part.value;
    }
  });
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function pad2(value) {
  return ('0' + value).slice(-2);
}

function formatDateInTimeZone(value, timeZone) {
  var parts = getDateTimeParts(value, timeZone);
  if (!parts) {
    return '';
  }
  return parts.year + '-' + pad2(parts.month) + '-' + pad2(parts.day);
}

function addDays(dateText, amount) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ''))) {
    return '';
  }
  var date = new Date(dateText + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function isWeekday(dateText) {
  var day = new Date(dateText + 'T00:00:00Z').getUTCDay();
  return day >= 1 && day <= 5;
}

function previousWeekday(dateText) {
  var date = addDays(dateText, -1);
  while (date && !isWeekday(date)) {
    date = addDays(date, -1);
  }
  return date;
}

function getReportDate(now) {
  return formatDateInTimeZone(now, REPORT_TIME_ZONE);
}

function isSupportedTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone }).format(new Date(0));
    return true;
  } catch (err) {
    return false;
  }
}

function getAssetTimeZone(asset, yahooMeta) {
  if (yahooMeta && yahooMeta.exchangeTimezoneName && isSupportedTimeZone(yahooMeta.exchangeTimezoneName)) {
    return yahooMeta.exchangeTimezoneName;
  }
  if (asset && asset.assetType == 'STOCK') {
    return REPORT_TIME_ZONE;
  }
  if (asset && (asset.assetType == 'US_STOCK' || asset.assetType == 'GOLD')) {
    return US_MARKET_TIME_ZONE;
  }
  return REPORT_TIME_ZONE;
}

function getProviderDate(timestampSeconds, timeZone) {
  var timestamp = Number(timestampSeconds);
  if (!isFinite(timestamp)) {
    return '';
  }
  return formatDateInTimeZone(new Date(timestamp * 1000), timeZone || 'UTC');
}

function getLatestCompletedMarketDate(asset, now, yahooMeta) {
  var date = toDate(now);
  if (!isValidDate(date)) {
    return '';
  }
  if (asset && asset.assetType == 'FUND' && /^\d{4}-\d{2}-\d{2}$/.test(String(asset.latestPriceDate || ''))) {
    return asset.latestPriceDate;
  }
  if (!asset || asset.assetType == 'FUND') {
    return getReportDate(date);
  }

  var timeZone = getAssetTimeZone(asset, yahooMeta);
  var local = getDateTimeParts(date, timeZone);
  var localDate = formatDateInTimeZone(date, timeZone);
  var regularEnd = yahooMeta && yahooMeta.currentTradingPeriod && yahooMeta.currentTradingPeriod.regular &&
    Number(yahooMeta.currentTradingPeriod.regular.end);

  if (isFinite(regularEnd)) {
    var sessionDate = getProviderDate(regularEnd, timeZone);
    return date.getTime() >= regularEnd * 1000 ? sessionDate : previousWeekday(sessionDate);
  }

  var closeMinute = asset.assetType == 'STOCK' ? 15 * 60 + 30 : 16 * 60;
  var localMinute = local.hour * 60 + local.minute;
  if (isWeekday(localDate) && localMinute >= closeMinute) {
    return localDate;
  }
  return previousWeekday(localDate);
}

function getPriceDateLabel(asset) {
  if (asset && asset.assetSubType == 'MMF') {
    return 'Imported MMF price date';
  }
  if (asset && asset.assetType == 'STOCK') {
    return 'Tokyo price date';
  }
  if (asset && asset.assetType == 'US_STOCK') {
    return 'New York price date';
  }
  if (asset && asset.assetType == 'FUND') {
    return 'Fund published date';
  }
  if (asset && asset.assetType == 'GOLD') {
    return 'Gold price date';
  }
  return 'Price date';
}

module.exports = {
  REPORT_TIME_ZONE: REPORT_TIME_ZONE,
  US_MARKET_TIME_ZONE: US_MARKET_TIME_ZONE,
  addDays: addDays,
  formatDateInTimeZone: formatDateInTimeZone,
  getAssetTimeZone: getAssetTimeZone,
  getLatestCompletedMarketDate: getLatestCompletedMarketDate,
  getPriceDateLabel: getPriceDateLabel,
  getProviderDate: getProviderDate,
  getReportDate: getReportDate,
  previousWeekday: previousWeekday
};
