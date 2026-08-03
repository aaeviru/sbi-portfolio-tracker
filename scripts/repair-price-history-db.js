var fs = require('fs');
var path = require('path');
var sqlite3 = require('sqlite3').verbose();
var priceHistory = require('../app');

var dbPath = process.env.SBI_PORTFOLIO_DB_PATH || path.join(__dirname, '..', 'data', 'sbi-portfolio-tracker.sqlite');

function timestamp() {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

function all(db, sql, params) {
  return new Promise(function (resolve, reject) {
    db.all(sql, params || [], function (err, rows) {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

function run(db, sql, params) {
  return new Promise(function (resolve, reject) {
    db.run(sql, params || [], function (err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function fetchRows(fetcher, asset, startDate, endDate) {
  return new Promise(function (resolve, reject) {
    fetcher(asset, startDate, endDate, function (err, rows) {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });
}

function previousWeekday(dateText) {
  var date = new Date(dateText + 'T00:00:00Z');
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10);
}

function makeAssetPlans(assets, transactions, today) {
  var active = priceHistory.findActiveQuantitySymbols(transactions);
  var firstBuys = priceHistory.findOldestBuyDatesBySymbol(transactions);
  var plans = [];

  assets.forEach(function (asset) {
    if (!active[asset.symbol] || asset.assetSubType == 'MMF') {
      return;
    }
    var targetStartDate = priceHistory.getPriceHistoryTargetStartDate(firstBuys[asset.symbol], today);
    var ranges = priceHistory.getPriceHistorySourceRanges(asset, today, targetStartDate);
    var yahooRanges = ranges.filter(function (range) {
      return range.source == 'YAHOO_CHART' || range.source == 'YAHOO_FUND_HISTORY' || range.source == 'YAHOO_GOLD_HISTORY';
    });
    if (yahooRanges.length === 0) {
      return;
    }

    var fetcher = asset.assetType == 'FUND'
      ? priceHistory.fetchYahooFundPriceHistory
      : asset.assetType == 'GOLD'
        ? priceHistory.fetchGoldDailyPriceHistory
        : priceHistory.fetchYahooChartDailyPriceHistory;
    if (asset.assetType == 'FUND' && !asset.priceSourceUrl) {
      return;
    }
    plans.push({ asset: asset, range: yahooRanges[0], fetcher: fetcher });
  });

  return plans;
}

function parseRows(rows) {
  return rows.map(function (row) { return JSON.parse(row.doc_json); });
}

async function fetchAllPlans(plans) {
  var results = [];
  for (var i = 0; i < plans.length; i++) {
    var plan = plans[i];
    var rows = await fetchRows(plan.fetcher, plan.asset, plan.range.startDate, plan.range.endDate);
    results.push({ plan: plan, rows: rows });
    console.log(JSON.stringify({
      phase: 'fetch',
      symbol: plan.asset.symbol,
      source: plan.range.source,
      startDate: plan.range.startDate,
      endDate: plan.range.endDate,
      rows: rows.length
    }));
  }
  return results;
}

async function updateJQuantsCoverage(db, assetRows) {
  for (var i = 0; i < assetRows.length; i++) {
    var asset = JSON.parse(assetRows[i].doc_json);
    if (asset.assetType != 'STOCK') {
      continue;
    }
    var bounds = await all(db,
      "SELECT MIN(price_date) AS first_date, MAX(price_date) AS last_date FROM price_history WHERE symbol = ? AND source = 'JQUANTS'",
      [asset.symbol]
    );
    if (!bounds[0] || !bounds[0].first_date || !bounds[0].last_date) {
      continue;
    }
    asset.priceHistoryJQuantsStartDate = asset.priceHistoryJQuantsStartDate
      ? [asset.priceHistoryJQuantsStartDate, bounds[0].first_date].sort()[0]
      : bounds[0].first_date;
    asset.priceHistoryJQuantsEndDate = asset.priceHistoryJQuantsEndDate
      ? [asset.priceHistoryJQuantsEndDate, bounds[0].last_date].sort().reverse()[0]
      : bounds[0].last_date;
    await run(db, 'UPDATE assets SET doc_json = ? WHERE symbol = ?', [JSON.stringify(asset), asset.symbol]);
  }
}

async function saveResults(db, results, assetRows) {
  var insertedOrUpdated = 0;
  var fxInsertedOrUpdated = 0;
  await run(db, 'BEGIN IMMEDIATE TRANSACTION');
  try {
    for (var i = 0; i < results.length; i++) {
      var result = results[i];
      for (var j = 0; j < result.rows.length; j++) {
        var row = result.rows[j];
        await run(db,
          'INSERT INTO price_history (symbol, price_date, source, doc_json) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(symbol, price_date, source) DO UPDATE SET doc_json = excluded.doc_json',
          [row.symbol, row.priceDate, row.source, JSON.stringify(row)]
        );
        var snapshotSource = row.source == 'YAHOO_CHART'
          ? 'YAHOO_CHART_SNAPSHOT'
          : row.source == 'YAHOO_FUND_HISTORY'
            ? 'YAHOO_FUND_SNAPSHOT'
            : row.source == 'YAHOO_GOLD_HISTORY'
              ? 'YAHOO_GOLD_SNAPSHOT'
              : '';
        if (snapshotSource) {
          await run(db, 'DELETE FROM price_history WHERE symbol = ? AND price_date = ? AND source = ?', [row.symbol, row.priceDate, snapshotSource]);
        }
        insertedOrUpdated++;
      }

      var fxRows = result.rows.fxRows || [];
      for (var k = 0; k < fxRows.length; k++) {
        var fx = fxRows[k];
        var fxDoc = Object.assign({}, fx, {
          pair: 'USDJPY',
          rateDate: fx.priceDate,
          rateType: 'DAILY_CLOSE',
          rate: fx.close
        });
        await run(db,
          'INSERT INTO fx_rates (pair, rate_date, doc_json) VALUES (?, ?, ?) ' +
          'ON CONFLICT(pair, rate_date) DO UPDATE SET doc_json = excluded.doc_json',
          ['USDJPY', fx.priceDate, JSON.stringify(fxDoc)]
        );
        fxInsertedOrUpdated++;
      }
    }
    await updateJQuantsCoverage(db, assetRows);
    await run(db, 'COMMIT');
  } catch (err) {
    await run(db, 'ROLLBACK').catch(function () {});
    throw err;
  }
  return { priceRows: insertedOrUpdated, fxRows: fxInsertedOrUpdated };
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    throw new Error('SQLite DB not found: ' + dbPath);
  }
  var db = new sqlite3.Database(dbPath);
  try {
    var assetRows = await all(db, 'SELECT symbol, doc_json FROM assets ORDER BY symbol');
    var transactionRows = await all(db, 'SELECT doc_json FROM transactions ORDER BY trade_date_time');
    var assets = parseRows(assetRows);
    var transactions = parseRows(transactionRows);
    var today = new Date().toISOString().slice(0, 10);
    var plans = makeAssetPlans(assets, transactions, today);
    var results = await fetchAllPlans(plans);
    var backupPath = dbPath + '.backup-before-price-history-repair-' + timestamp();
    fs.copyFileSync(dbPath, backupPath);
    var saved = await saveResults(db, results, assetRows);
    console.log(JSON.stringify({
      phase: 'complete',
      backupPath: backupPath,
      assets: results.length,
      priceRows: saved.priceRows,
      fxRows: saved.fxRows,
      throughDate: previousWeekday(today)
    }, null, 2));
  } finally {
    db.close();
  }
}

main().catch(function (err) {
  console.error(err.stack || err.message);
  process.exit(1);
});
