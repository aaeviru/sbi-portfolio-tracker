var Holidays = require('date-holidays');

var japanHolidays = new Holidays('JP');
var japanHolidayCache = {};
var usEquityHolidayCache = {};
var US_EQUITY_EXCEPTIONAL_CLOSURES = {
  '2001-09-11': true,
  '2001-09-12': true,
  '2001-09-13': true,
  '2001-09-14': true,
  '2004-06-11': true,
  '2007-01-02': true,
  '2012-10-29': true,
  '2012-10-30': true,
  '2018-12-05': true,
  '2025-01-09': true
};

function isDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function addDays(dateText, days) {
  var date = new Date(dateText + 'T00:00:00Z');
  if (isNaN(date.getTime())) {
    return '';
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function makeDateText(year, month, day) {
  return String(year) + '-' + ('0' + month).slice(-2) + '-' + ('0' + day).slice(-2);
}

function getWeekday(dateText) {
  return new Date(dateText + 'T00:00:00Z').getUTCDay();
}

function isWeekday(dateText) {
  var day = getWeekday(dateText);
  return day >= 1 && day <= 5;
}

function nthWeekdayOfMonth(year, month, weekday, nth) {
  var first = new Date(Date.UTC(year, month - 1, 1));
  var day = 1 + ((7 + weekday - first.getUTCDay()) % 7) + ((nth - 1) * 7);
  return makeDateText(year, month, day);
}

function lastWeekdayOfMonth(year, month, weekday) {
  var last = new Date(Date.UTC(year, month, 0));
  var day = last.getUTCDate() - ((7 + last.getUTCDay() - weekday) % 7);
  return makeDateText(year, month, day);
}

function observedDate(year, month, day) {
  var dateText = makeDateText(year, month, day);
  var weekday = getWeekday(dateText);
  if (weekday === 6) {
    return addDays(dateText, -1);
  }
  if (weekday === 0) {
    return addDays(dateText, 1);
  }
  return dateText;
}

function getEasterSunday(year) {
  var a = year % 19;
  var b = Math.floor(year / 100);
  var c = year % 100;
  var d = Math.floor(b / 4);
  var e = b % 4;
  var f = Math.floor((b + 8) / 25);
  var g = Math.floor((b - f + 1) / 3);
  var h = (19 * a + b - d - g + 15) % 30;
  var i = Math.floor(c / 4);
  var k = c % 4;
  var l = (32 + 2 * e + 2 * i - h - k) % 7;
  var m = Math.floor((a + 11 * h + 22 * l) / 451);
  var month = Math.floor((h + l - 7 * m + 114) / 31);
  var day = ((h + l - 7 * m + 114) % 31) + 1;
  return makeDateText(year, month, day);
}

function getUsEquityHolidays(year) {
  if (usEquityHolidayCache[year]) {
    return usEquityHolidayCache[year];
  }
  var holidays = {};

  function add(dateText) {
    holidays[dateText] = true;
  }

  add(observedDate(year, 1, 1));
  add(nthWeekdayOfMonth(year, 1, 1, 3));
  add(nthWeekdayOfMonth(year, 2, 1, 3));
  add(addDays(getEasterSunday(year), -2));
  add(lastWeekdayOfMonth(year, 5, 1));
  if (year >= 2022) {
    add(observedDate(year, 6, 19));
  }
  add(observedDate(year, 7, 4));
  add(nthWeekdayOfMonth(year, 9, 1, 1));
  add(nthWeekdayOfMonth(year, 11, 4, 4));
  add(observedDate(year, 12, 25));

  // New Year's Day can be observed in the preceding calendar year.
  if (observedDate(year + 1, 1, 1).slice(0, 4) == String(year)) {
    add(observedDate(year + 1, 1, 1));
  }
  usEquityHolidayCache[year] = holidays;
  return holidays;
}

function isJapanPublicHoliday(dateText) {
  if (!isDateText(dateText)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(japanHolidayCache, dateText)) {
    return japanHolidayCache[dateText];
  }
  var holiday = japanHolidays.isHoliday(new Date(dateText + 'T12:00:00+09:00'));
  var result = Array.isArray(holiday)
    ? holiday.some(function (item) { return item.type == 'public'; })
    : !!holiday;
  japanHolidayCache[dateText] = result;
  return result;
}

function isJpxSession(dateText) {
  if (!isDateText(dateText) || !isWeekday(dateText)) {
    return false;
  }
  var monthDay = dateText.slice(5);
  if (monthDay == '01-02' || monthDay == '01-03' || monthDay == '12-31') {
    return false;
  }
  return !isJapanPublicHoliday(dateText);
}

function isUsEquitySession(dateText) {
  if (!isDateText(dateText) || !isWeekday(dateText) || US_EQUITY_EXCEPTIONAL_CLOSURES[dateText]) {
    return false;
  }
  var year = Number(dateText.slice(0, 4));
  return !getUsEquityHolidays(year)[dateText];
}

function getCalendarId(asset, source) {
  if (asset && asset.assetType == 'STOCK') {
    return 'JPX';
  }
  if (asset && asset.assetType == 'US_STOCK') {
    return 'US_EQUITY';
  }
  if (asset && asset.assetType == 'FUND') {
    return 'JP_FUND_PUBLICATION';
  }
  if (asset && asset.assetType == 'GOLD') {
    return 'US_DAILY_MARKET';
  }
  if (String(source || '').indexOf('FX') >= 0) {
    return 'US_DAILY_MARKET';
  }
  return 'WEEKDAY';
}

function isExpectedSession(asset, source, dateText) {
  var calendarId = getCalendarId(asset, source);
  if (calendarId == 'JPX' || calendarId == 'JP_FUND_PUBLICATION') {
    return isJpxSession(dateText);
  }
  if (calendarId == 'US_EQUITY' || calendarId == 'US_DAILY_MARKET') {
    return isUsEquitySession(dateText);
  }
  return isDateText(dateText) && isWeekday(dateText);
}

function getExpectedDates(asset, source, startDate, endDate) {
  var dates = [];
  if (!isDateText(startDate) || !isDateText(endDate) || startDate > endDate) {
    return dates;
  }

  var date = startDate;
  while (date <= endDate) {
    if (isExpectedSession(asset, source, date)) {
      dates.push(date);
    }
    date = addDays(date, 1);
  }
  return dates;
}

function nextExpectedDate(asset, source, dateText) {
  var date = addDays(dateText, 1);
  while (date && !isExpectedSession(asset, source, date)) {
    date = addDays(date, 1);
  }
  return date;
}

module.exports = {
  addDays: addDays,
  getCalendarId: getCalendarId,
  getExpectedDates: getExpectedDates,
  getUsEquityHolidays: getUsEquityHolidays,
  isExpectedSession: isExpectedSession,
  isJpxSession: isJpxSession,
  isJapanPublicHoliday: isJapanPublicHoliday,
  isUsEquitySession: isUsEquitySession,
  nextExpectedDate: nextExpectedDate
};
