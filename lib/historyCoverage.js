var marketCalendars = require('./marketCalendars');

var STATUS_PRIORITY = {
  FAILED: 1,
  NO_DATA: 2,
  COMPLETE: 3
};

function uniqueSorted(values) {
  var seen = {};
  return (values || []).filter(function (value) {
    if (!value || seen[value]) {
      return false;
    }
    seen[value] = true;
    return true;
  }).sort();
}

function isSnapshotRow(row) {
  return row && (row.sessionStatus == 'SNAPSHOT' || /_SNAPSHOT$/.test(String(row.source || '')));
}

function isCompletedPriceRow(row) {
  return !!(row && !isSnapshotRow(row) && row.sessionStatus != 'INCOMPLETE' &&
    typeof row.close == 'number' && isFinite(row.close));
}

function sourceMatches(source, rowSource) {
  if (source == 'YAHOO_CHART_ARCHIVE') {
    return rowSource == 'YAHOO_CHART';
  }
  return source == rowSource;
}

function makeCoverageKey(interval) {
  return [interval.symbol, interval.source, interval.status, interval.startDate, interval.endDate]
    .map(function (value) { return encodeURIComponent(String(value || '')); })
    .join('|');
}

function intervalDates(asset, interval) {
  return marketCalendars.getExpectedDates(asset, interval.source, interval.startDate, interval.endDate);
}

function intervalSignature(interval) {
  return [
    interval.status,
    interval.reason || '',
    interval.retryAfter || '',
    interval.error || '',
    Number(interval.attemptCount || 0)
  ].join('|');
}

function normalizeIntervals(asset, source, intervals) {
  var byDate = {};

  (intervals || []).filter(function (interval) {
    return interval && interval.source == source && STATUS_PRIORITY[interval.status];
  }).forEach(function (interval) {
    intervalDates(asset, interval).forEach(function (date) {
      var existing = byDate[date];
      var existingPriority = existing ? STATUS_PRIORITY[existing.status] : 0;
      var nextPriority = STATUS_PRIORITY[interval.status];
      if (!existing || nextPriority > existingPriority ||
        (nextPriority == existingPriority && String(interval.lastAttemptAt || '') >= String(existing.lastAttemptAt || ''))) {
        byDate[date] = interval;
      }
    });
  });

  var dates = Object.keys(byDate).sort();
  var normalized = [];
  var current = null;

  dates.forEach(function (date) {
    var sourceInterval = byDate[date];
    var adjacent = current && marketCalendars.nextExpectedDate(asset, source, current.endDate) == date;
    if (current && adjacent && intervalSignature(current) == intervalSignature(sourceInterval)) {
      current.endDate = date;
      current.expectedCount++;
      if (current.status == 'COMPLETE') {
        current.receivedCount++;
      }
      return;
    }

    current = Object.assign({}, sourceInterval, {
      source: source,
      startDate: date,
      endDate: date,
      expectedCount: 1,
      receivedCount: sourceInterval.status == 'COMPLETE' ? 1 : 0
    });
    normalized.push(current);
  });

  return normalized.map(function (interval) {
    interval.coverageKey = makeCoverageKey(interval);
    return interval;
  });
}

function makeIntervalsForDates(asset, source, symbol, dates, fields) {
  var intervals = [];
  var current = null;

  uniqueSorted(dates).forEach(function (date) {
    if (current && marketCalendars.nextExpectedDate(asset, source, current.endDate) == date) {
      current.endDate = date;
      current.expectedCount++;
      if (current.status == 'COMPLETE') {
        current.receivedCount++;
      }
      return;
    }
    current = Object.assign({
      symbol: symbol,
      source: source,
      startDate: date,
      endDate: date,
      status: 'COMPLETE',
      reason: 'PROVIDER_ROW',
      attemptCount: 0,
      lastAttemptAt: '',
      retryAfter: '',
      error: '',
      expectedCount: 1,
      receivedCount: 1,
      calendarId: marketCalendars.getCalendarId(asset, source)
    }, fields || {});
    intervals.push(current);
  });

  return intervals.map(function (interval) {
    interval.coverageKey = makeCoverageKey(interval);
    return interval;
  });
}

function buildCompleteIntervalsFromRows(asset, source, rows) {
  var dates = (rows || []).filter(function (row) {
    return isCompletedPriceRow(row) &&
      sourceMatches(source, row.source) && marketCalendars.isExpectedSession(asset, source, row.priceDate);
  }).map(function (row) {
    return row.priceDate;
  });
  return makeIntervalsForDates(asset, source, asset.symbol, dates, {
    status: 'COMPLETE',
    reason: 'SAVED_PRICE_ROW'
  });
}

function coveredDateMap(asset, source, rows, intervals) {
  var covered = {};
  (rows || []).filter(function (row) {
    return isCompletedPriceRow(row) && marketCalendars.isExpectedSession(asset, source, row.priceDate);
  }).forEach(function (row) {
    covered[row.priceDate] = true;
  });
  (intervals || []).filter(function (interval) {
    return interval.source == source && (interval.status == 'COMPLETE' || interval.status == 'NO_DATA');
  }).forEach(function (interval) {
    intervalDates(asset, interval).forEach(function (date) { covered[date] = true; });
  });
  return covered;
}

function deferredDateMap(asset, source, intervals, nowText) {
  var deferred = {};
  (intervals || []).filter(function (interval) {
    return interval.source == source && interval.status == 'FAILED' && interval.retryAfter && interval.retryAfter > nowText;
  }).forEach(function (interval) {
    intervalDates(asset, interval).forEach(function (date) { deferred[date] = true; });
  });
  return deferred;
}

function splitDateGroups(asset, source, dates, maxSessions) {
  var groups = [];
  var current = [];
  uniqueSorted(dates).forEach(function (date) {
    var adjacent = current.length && marketCalendars.nextExpectedDate(asset, source, current[current.length - 1]) == date;
    if (!current.length || (adjacent && current.length < maxSessions)) {
      current.push(date);
      return;
    }
    groups.push(current);
    current = [date];
  });
  if (current.length) {
    groups.push(current);
  }
  return groups;
}

function getWindowLimit(source) {
  if (source == 'JQUANTS') {
    return 500;
  }
  if (source == 'YAHOO_CHART_ARCHIVE') {
    return 250;
  }
  return 500;
}

function buildPendingWindows(options) {
  var asset = options.asset;
  var rows = options.rows || [];
  var intervals = options.intervals || [];
  var nowText = options.nowText || new Date().toISOString();
  var windows = [];
  var deferredCount = 0;

  (options.sourceRanges || []).forEach(function (range) {
    var expected = marketCalendars.getExpectedDates(asset, range.source, range.startDate, range.endDate);
    var covered = coveredDateMap(asset, range.source, rows, intervals);
    var deferred = deferredDateMap(asset, range.source, intervals, nowText);
    var pending = expected.filter(function (date) {
      if (covered[date]) {
        return false;
      }
      if (deferred[date]) {
        deferredCount++;
        return false;
      }
      return true;
    });

    splitDateGroups(asset, range.source, pending, getWindowLimit(range.source)).forEach(function (dates) {
      var first = dates[0];
      var last = dates[dates.length - 1];
      windows.push({
        source: range.source,
        startDate: first,
        endDate: last,
        expectedDates: dates,
        expectedCount: dates.length,
        reason: last == range.endDate ? 'FORWARD' : first == range.startDate ? 'BACKFILL' : 'GAP'
      });
    });
  });

  windows.sort(function (a, b) {
    return b.endDate.localeCompare(a.endDate) || b.startDate.localeCompare(a.startDate);
  });
  windows.deferredCount = deferredCount;
  return windows;
}

function maxOverlappingAttemptCount(asset, window, intervals) {
  var expected = {};
  window.expectedDates.forEach(function (date) { expected[date] = true; });
  var count = 0;
  (intervals || []).filter(function (interval) {
    return interval.source == window.source && interval.status == 'FAILED';
  }).forEach(function (interval) {
    if (intervalDates(asset, interval).some(function (date) { return expected[date]; })) {
      count = Math.max(count, Number(interval.attemptCount || 0));
    }
  });
  return count;
}

function getEarliestCompletedDate(rows) {
  return uniqueSorted((rows || []).filter(function (row) {
    return isCompletedPriceRow(row) && row.priceDate;
  }).map(function (row) { return row.priceDate; }))[0] || '';
}

function classifyAttempt(options) {
  var asset = options.asset;
  var window = options.window;
  var rows = options.rows || [];
  var intervals = options.intervals || [];
  var now = options.now || new Date();
  var nowText = now.toISOString();
  var expected = window.expectedDates || marketCalendars.getExpectedDates(asset, window.source, window.startDate, window.endDate);
  var returned = {};

  rows.forEach(function (row) {
    if (isCompletedPriceRow(row) && row.priceDate >= window.startDate && row.priceDate <= window.endDate) {
      returned[row.priceDate] = true;
    }
  });

  var completeDates = expected.filter(function (date) { return returned[date]; });
  var missingDates = expected.filter(function (date) { return !returned[date]; });
  var attemptCount = maxOverlappingAttemptCount(asset, window, intervals) + 1;
  var additions = makeIntervalsForDates(asset, window.source, asset.symbol, completeDates, {
    status: 'COMPLETE',
    reason: 'PROVIDER_ROW',
    attemptCount: attemptCount,
    lastAttemptAt: nowText,
    retryAfter: '',
    error: ''
  });

  if (missingDates.length) {
    var earliestCompletedDate = options.earliestCompletedDate || getEarliestCompletedDate(options.allRows || rows);
    var status = 'FAILED';
    var reason = options.error ? (options.rateLimited ? 'RATE_LIMITED' : 'FETCH_ERROR') : 'PARTIAL_RESPONSE';
    var retryDelayMs = options.rateLimited ? 15 * 60 * 1000 : Math.min(24, Math.pow(2, attemptCount - 1)) * 60 * 60 * 1000;
    var retryAfter = new Date(now.getTime() + retryDelayMs).toISOString();

    var terminalBeforeFirstPrice = completeDates.length === 0 && earliestCompletedDate && window.endDate < earliestCompletedDate &&
      (!options.error || options.error == 'HTTP 403' || options.error == 'HTTP 404');
    if (terminalBeforeFirstPrice) {
      status = 'NO_DATA';
      reason = 'BEFORE_FIRST_AVAILABLE_PRICE';
      retryAfter = '';
    } else if (!options.error && completeDates.length === 0) {
      reason = 'EMPTY_RESPONSE';
    }

    additions = additions.concat(makeIntervalsForDates(asset, window.source, asset.symbol, missingDates, {
      status: status,
      reason: reason,
      attemptCount: attemptCount,
      lastAttemptAt: nowText,
      retryAfter: retryAfter,
      error: options.error || '',
      receivedCount: 0
    }));
  }

  return normalizeIntervals(asset, window.source, intervals.concat(additions));
}

function summarizeCoverage(asset, sourceRanges, rows, intervals, nowText) {
  var windows = buildPendingWindows({
    asset: asset,
    sourceRanges: sourceRanges,
    rows: rows,
    intervals: intervals,
    nowText: nowText
  });
  var completedDates = [];
  var snapshotDates = [];

  (rows || []).forEach(function (row) {
    if (!row || !row.priceDate) {
      return;
    }
    if (isSnapshotRow(row)) {
      snapshotDates.push(row.priceDate);
    } else if (isCompletedPriceRow(row)) {
      completedDates.push(row.priceDate);
    }
  });
  completedDates = uniqueSorted(completedDates);
  snapshotDates = uniqueSorted(snapshotDates);

  var failed = (intervals || []).filter(function (interval) { return interval.status == 'FAILED'; });
  var noData = (intervals || []).filter(function (interval) { return interval.status == 'NO_DATA'; });
  return {
    firstCompletedDate: completedDates[0] || '',
    lastCompletedDate: completedDates[completedDates.length - 1] || '',
    latestSnapshotDate: snapshotDates[snapshotDates.length - 1] || '',
    pendingWindows: windows,
    pendingCount: windows.reduce(function (sum, window) { return sum + window.expectedCount; }, 0),
    deferredCount: windows.deferredCount || 0,
    failedIntervals: failed,
    noDataIntervals: noData,
    status: failed.length ? 'FAILED' : windows.length ? 'NEEDS_UPDATE' : 'UP_TO_DATE'
  };
}

module.exports = {
  buildCompleteIntervalsFromRows: buildCompleteIntervalsFromRows,
  buildPendingWindows: buildPendingWindows,
  classifyAttempt: classifyAttempt,
  makeCoverageKey: makeCoverageKey,
  makeIntervalsForDates: makeIntervalsForDates,
  normalizeIntervals: normalizeIntervals,
  sourceMatches: sourceMatches,
  summarizeCoverage: summarizeCoverage
};
