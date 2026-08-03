var path = require('path');
var sqlite3 = require('sqlite3').verbose();

var dbPath = process.env.SBI_PORTFOLIO_DB_PATH || path.join(__dirname, '..', 'data', 'sbi-portfolio-tracker.sqlite');
var db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

function all(sql) {
  return new Promise(function (resolve, reject) {
    db.all(sql, function (err, rows) {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

function parse(row) {
  return JSON.parse(row.doc_json);
}

function dayDifference(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

async function main() {
  var assetRows = await all('SELECT symbol, doc_json FROM assets ORDER BY symbol');
  var transactionRows = await all("SELECT symbol, doc_json FROM transactions WHERE symbol <> '' ORDER BY trade_date_time");
  var historyRows = await all('SELECT symbol, price_date, source, doc_json FROM price_history ORDER BY symbol, price_date, source');
  var firstBuyBySymbol = {};
  var quantityBySymbol = {};
  var historyBySymbol = {};

  transactionRows.map(parse).forEach(function (tx) {
    if (!tx.symbol || (tx.side != 'BUY' && tx.side != 'SELL')) {
      return;
    }
    if (tx.side == 'BUY' && tx.tradeDate && (!firstBuyBySymbol[tx.symbol] || tx.tradeDate < firstBuyBySymbol[tx.symbol])) {
      firstBuyBySymbol[tx.symbol] = tx.tradeDate;
    }
    var quantity = Number(tx.quantity) || 0;
    quantityBySymbol[tx.symbol] = (quantityBySymbol[tx.symbol] || 0) + (tx.side == 'BUY' ? quantity : -quantity);
  });

  historyRows.forEach(function (row) {
    if (!historyBySymbol[row.symbol]) {
      historyBySymbol[row.symbol] = [];
    }
    historyBySymbol[row.symbol].push({
      date: row.price_date,
      source: row.source
    });
  });

  assetRows.forEach(function (row) {
    var asset = parse(row);
    var history = historyBySymbol[row.symbol] || [];
    var dates = Array.from(new Set(history.map(function (item) { return item.date; }))).sort();
    var gaps = [];
    for (var i = 1; i < dates.length; i++) {
      var days = dayDifference(dates[i - 1], dates[i]);
      if (days > 7) {
        gaps.push({ after: dates[i - 1], before: dates[i], days: days });
      }
    }
    var sourceCounts = {};
    history.forEach(function (item) {
      sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
    });

    console.log(JSON.stringify({
      symbol: row.symbol,
      name: asset.name,
      assetType: asset.assetType,
      priceSourceUrl: asset.priceSourceUrl || '',
      priceHistoryFetchStatus: asset.priceHistoryFetchStatus || '',
      priceHistoryFetchError: asset.priceHistoryFetchError || '',
      activeQuantity: quantityBySymbol[row.symbol] || 0,
      firstBuyDate: firstBuyBySymbol[row.symbol] || '',
      historyFirstDate: dates[0] || '',
      historyLastDate: dates[dates.length - 1] || '',
      historyDateCount: dates.length,
      sourceCounts: sourceCounts,
      completedJQuantsStartDate: asset.priceHistoryJQuantsStartDate || '',
      completedJQuantsEndDate: asset.priceHistoryJQuantsEndDate || '',
      gaps: gaps
    }));
  });
}

main().then(function () {
  db.close();
}).catch(function (err) {
  console.error(err.stack || err.message);
  db.close();
  process.exit(1);
});
