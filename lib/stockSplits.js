function isNumber(value) {
  return typeof value == 'number' && isFinite(value);
}

function splitFactor(events, fromDate, throughDate) {
  if (!fromDate || !throughDate || fromDate >= throughDate) {
    return 1;
  }
  return (events || []).reduce(function (factor, event) {
    return event.status == 'CONFIRMED' && event.operation != 'REMOVE' &&
      event.exDate > fromDate && event.exDate <= throughDate && isNumber(event.ratio) && event.ratio > 0
      ? factor * event.ratio : factor;
  }, 1);
}

function adjustPrice(events, price, priceDate, throughDate) {
  return price / splitFactor(events, priceDate, throughDate);
}

function normalizeDate(value) {
  var match = String(value || '').match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  return match ? match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0') : '';
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/<!--.*?-->/g, '')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').trim();
}

function parseYahooHistoryPage(html, symbol) {
  html = String(html || '');
  var title = html.match(/<title[^>]*>([^<]*)<\/title>/);
  var code = String(symbol || '').replace(/\.T$/, '');
  if (!title || title[1].indexOf('株価時系列') < 0 || title[1].indexOf('【' + code + '】') < 0 || !/HistoryContainer__table/.test(html)) {
    throw new Error('Yahoo stock history table was not found');
  }
  var table = html.match(/<table\b[^>]*HistoryContainer__table[^>]*>([\s\S]*?)<\/table>/);
  if (!table) throw new Error('Yahoo stock history table was not found');
  var summary = html.match(/<p[^>]*class="[^"]*_Pager__summary[^"]*"[^>]*>([\s\S]*?)<\/p>/);
  var pageMatch = summary && stripTags(summary[1]).match(/([\d,]+)\s*[〜～~\-]\s*([\d,]+)\s*\/\s*([\d,]+)件/);
  if (!pageMatch) throw new Error('Yahoo stock history page count was not found');
  var pageStart = Number(pageMatch[1].replace(/,/g, ''));
  var pageEnd = Number(pageMatch[2].replace(/,/g, ''));
  var totalRows = Number(pageMatch[3].replace(/,/g, ''));
  if (!(pageStart > 0 && pageEnd >= pageStart && totalRows >= pageEnd && pageEnd - pageStart < 20)) {
    throw new Error('Yahoo stock history page range is invalid');
  }
  var events = [];
  var dates = [];
  var rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
  var row;
  while ((row = rowPattern.exec(table[1]))) {
    var dateMatch = row[1].match(/<th\b[^>]*>([\s\S]*?)<\/th>/);
    var date = normalizeDate(stripTags(dateMatch && dateMatch[1]));
    if (date) dates.push(date);
    if (row[1].indexOf('分割') < 0) continue;
    var splitMatch = stripTags(row[1]).match(/分割\s*[：:]\s*([\d.]+)株\s*→\s*([\d.]+)株/);
    if (!date || !splitMatch) throw new Error('Yahoo split row format changed');
    var beforeShares = Number(splitMatch[1]);
    var afterShares = Number(splitMatch[2]);
    if (!(beforeShares > 0 && afterShares > 0)) throw new Error('Yahoo split ratio is invalid');
    events.push({ symbol: symbol, exDate: date, beforeShares: beforeShares,
      afterShares: afterShares, ratio: afterShares / beforeShares });
  }
  if (dates.length != pageEnd - pageStart + 1 + events.length) throw new Error('Yahoo stock history row count changed');
  return { events: events, dates: dates, pageStart: pageStart, pageEnd: pageEnd,
    totalPages: Math.ceil(totalRows / 20), totalRows: totalRows };
}

function yahooHistoryUrl(symbol, fromDate, toDate, page) {
  return 'https://finance.yahoo.co.jp/quote/' + encodeURIComponent(symbol) + '/history?from=' +
    fromDate.replace(/-/g, '') + '&to=' + toDate.replace(/-/g, '') + '&timeFrame=d&page=' + page;
}

function addDays(date, days) {
  var value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function scanStart(firstRelevantDate, state, today) {
  if (!state || !state.lastFullScanDate || !state.firstRelevantDate || firstRelevantDate < state.firstRelevantDate ||
    addDays(state.lastFullScanDate, 30) <= today || !state.lastCheckedThrough) {
    return firstRelevantDate;
  }
  var overlap = addDays(state.lastCheckedThrough, -30);
  return overlap < firstRelevantDate ? firstRelevantDate : overlap;
}

function scanWindows(fromDate, throughDate) {
  var ranges = [];
  var start = fromDate;
  while (start <= throughDate) {
    var end = addDays(start, 364);
    if (end > throughDate) end = throughDate;
    ranges.push({ startDate: start, endDate: end });
    start = addDays(end, 1);
  }
  return ranges;
}

module.exports = {
  splitFactor: splitFactor,
  adjustPrice: adjustPrice,
  normalizeDate: normalizeDate,
  parseYahooHistoryPage: parseYahooHistoryPage,
  yahooHistoryUrl: yahooHistoryUrl,
  scanStart: scanStart,
  scanWindows: scanWindows,
  addDays: addDays
};
