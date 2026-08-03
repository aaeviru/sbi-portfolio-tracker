var fs = require('fs');
var path = require('path');
var sqlite3 = require('sqlite3').verbose();

var dbPath = process.env.SBI_PORTFOLIO_DB_PATH || path.join(__dirname, '..', 'data', 'sbi-portfolio-tracker.sqlite');

function timestamp() {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
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

function get(db, sql, params) {
  return new Promise(function (resolve, reject) {
    db.get(sql, params || [], function (err, row) {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    throw new Error('SQLite DB not found: ' + dbPath);
  }

  var backupPath = dbPath + '.backup-before-mmf-fx-fix-' + timestamp();
  fs.copyFileSync(dbPath, backupPath);

  var db = new sqlite3.Database(dbPath);
  try {
    var fxRow = await get(db, "SELECT doc_json FROM fx_rates WHERE pair = 'USDJPY' ORDER BY rate_date DESC LIMIT 1");
    if (!fxRow) {
      throw new Error('No stored USDJPY rate found. Refresh prices before running this repair.');
    }

    var fxRate = JSON.parse(fxRow.doc_json);
    if (!Number.isFinite(fxRate.rate)) {
      throw new Error('Latest stored USDJPY rate is invalid.');
    }

    var assetRows = await all(db, "SELECT symbol, doc_json FROM assets WHERE doc_json LIKE '%MMF%' OR doc_json LIKE '%マネー・マーケット%'");
    await run(db, 'BEGIN IMMEDIATE TRANSACTION');
    for (var i = 0; i < assetRows.length; i++) {
      var doc = JSON.parse(assetRows[i].doc_json);
      doc.latestFxRate = fxRate.rate;
      doc.latestFxRatePair = fxRate.pair;
      doc.latestFxRateDate = fxRate.rateDate;
      await run(db, 'UPDATE assets SET doc_json = ? WHERE symbol = ?', [JSON.stringify(doc), assetRows[i].symbol]);
    }
    await run(db, 'COMMIT');

    console.log(JSON.stringify({
      backupPath: backupPath,
      updatedAssets: assetRows.length,
      latestFxRate: fxRate.rate,
      latestFxRateDate: fxRate.rateDate
    }, null, 2));
  } catch (err) {
    await run(db, 'ROLLBACK').catch(function () {});
    throw err;
  } finally {
    db.close();
  }
}

main().catch(function (err) {
  console.error(err.stack || err.message);
  process.exit(1);
});
