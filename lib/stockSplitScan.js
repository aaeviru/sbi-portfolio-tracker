var splitMath = require('./stockSplits');

function findOne(collection, filter) {
  return new Promise(function (resolve, reject) {
    collection.findOne(filter, function (err, row) { err ? reject(err) : resolve(row); });
  });
}

function findAll(collection, filter) {
  return new Promise(function (resolve, reject) {
    collection.find(filter).toArray(function (err, rows) { err ? reject(err) : resolve(rows); });
  });
}

function upsert(collection, key, doc) {
  return new Promise(function (resolve, reject) {
    collection.updateOne(key, { $set: doc }, { upsert: true }, function (err, result) {
      err ? reject(err) : resolve(result);
    });
  });
}

function fetch(fetchText, url) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      reject(new Error('Yahoo split history request timed out'));
    }, 20000);
    fetchText(url, function (err, html) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      err ? reject(err) : resolve(html);
    });
  });
}

function latestPriceWarning(historyRows, events) {
  var rows = (historyRows || []).filter(function (row) {
    return row.source == 'YAHOO_CHART' && typeof row.close == 'number' && row.close > 0 && row.priceDate;
  }).sort(function (a, b) { return a.priceDate < b.priceDate ? 1 : a.priceDate > b.priceDate ? -1 : 0; });
  if (rows.length < 2 || rows[0].priceDate == rows[1].priceDate) return '';
  if ((events || []).some(function (event) {
    return event.exDate > rows[1].priceDate && event.exDate <= rows[0].priceDate && event.status != 'DISMISSED';
  })) return '';
  var move = rows[1].close / rows[0].close;
  for (var ratio = 2; ratio <= 20; ratio++) {
    if (Math.abs(move / ratio - 1) <= 0.1 || Math.abs(move * ratio - 1) <= 0.1) {
      return 'Price changed by about a ' + (move > 1 ? '1:' + ratio : ratio + ':1') +
        ' share ratio between ' + rows[1].priceDate + ' and ' + rows[0].priceDate +
        ', but Yahoo split history supplied no matching event.';
    }
  }
  return '';
}

async function scanSymbolAsync(db, symbol, firstTradeDate, today, fetchText) {
  if (!/^[0-9]{4}\.T$|^[0-9]{3}[A-Z]\.T$/.test(symbol) || !firstTradeDate || firstTradeDate > today) {
    return { ok: true, skipped: true, symbol: symbol };
  }
  var scans = db.collection('stockSplitScans');
  var splits = db.collection('stockSplits');
  var previous = await findOne(scans, { symbol: symbol }) || { symbol: symbol };
  var start = splitMath.scanStart(firstTradeDate, previous, today);
  var fullScan = start == firstTradeDate;
  var existing = await findAll(splits, { symbol: symbol });
  var found = 0;
  var pageCount = 0;
  var now = new Date().toISOString();

  try {
    for (var range of splitMath.scanWindows(start, today)) {
      var firstUrl = splitMath.yahooHistoryUrl(symbol, range.startDate, range.endDate, 1);
      var firstPage = splitMath.parseYahooHistoryPage(await fetch(fetchText, firstUrl), symbol);
      if (firstPage.totalPages > 30) throw new Error('Yahoo history returned too many pages for one scan window');
      for (var page = 1; page <= firstPage.totalPages; page++) {
        if (++pageCount > 200) throw new Error('Yahoo split scan exceeded 200 pages; coverage is incomplete');
        var url = splitMath.yahooHistoryUrl(symbol, range.startDate, range.endDate, page);
        var parsed = page == 1 ? firstPage : splitMath.parseYahooHistoryPage(await fetch(fetchText, url), symbol);
        if (parsed.totalRows != firstPage.totalRows || parsed.pageStart != (page - 1) * 20 + 1 ||
          parsed.dates.some(function (date) { return date < range.startDate || date > range.endDate; })) {
          throw new Error('Yahoo split history did not match the requested page or date range');
        }
        for (var event of parsed.events) {
          if (event.exDate < firstTradeDate || event.exDate > today) continue;
          var id = 'YAHOO:' + symbol + ':' + event.exDate;
          var sameDate = existing.filter(function (row) { return row.exDate == event.exDate; });
          if (sameDate.some(function (row) {
            return row.status == 'CONFIRMED' || (row.id == id && row.status == 'DISMISSED') ||
              (row.source == 'MANUAL' && row.status == 'PENDING');
          })) continue;
          var old = sameDate.find(function (row) { return row.id == id; });
          var doc = Object.assign({}, old || {}, event, {
            id: id,
            source: 'YAHOO_JAPAN_HISTORY',
            sourceUrl: url,
            status: 'PENDING',
            operation: 'ADD',
            observedAt: now
          });
          await upsert(splits, { id: doc.id }, doc);
          if (!old) existing.push(doc);
          found++;
        }
      }
    }
    var history = await findAll(db.collection('priceHistory'), { symbol: symbol });
    var warning = latestPriceWarning(history, existing);
    var state = Object.assign({}, previous, {
      symbol: symbol,
      firstTradeDate: firstTradeDate,
      status: 'OK',
      lastAttemptAt: now,
      lastCheckedThrough: today,
      lastFullScanDate: fullScan ? today : previous.lastFullScanDate,
      lastError: '',
      warning: warning,
      lastPages: pageCount
    });
    await upsert(scans, { symbol: symbol }, state);
    return { ok: true, symbol: symbol, found: found, pages: pageCount, warning: warning };
  } catch (err) {
    await upsert(scans, { symbol: symbol }, Object.assign({}, previous, {
      symbol: symbol,
      firstTradeDate: firstTradeDate,
      status: 'FAILED',
      lastAttemptAt: now,
      lastError: err.message,
      lastPages: pageCount
    }));
    return { ok: false, symbol: symbol, error: err.message, pages: pageCount };
  }
}

function scanSymbol(db, symbol, firstTradeDate, today, fetchText, callback) {
  scanSymbolAsync(db, symbol, firstTradeDate, today, fetchText)
    .then(function (result) { callback(null, result); }, callback);
}

module.exports = {
  scanSymbol: scanSymbol,
  scanSymbolAsync: scanSymbolAsync,
  latestPriceWarning: latestPriceWarning
};
