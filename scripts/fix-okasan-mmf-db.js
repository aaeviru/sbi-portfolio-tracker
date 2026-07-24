var fs = require('fs');
var path = require('path');
var sqlite3 = require('sqlite3').verbose();

var DB_PATH = path.join(__dirname, '..', 'data', 'sbi-portfolio-tracker.sqlite');
var CANONICAL_NAME = 'ＳＢＩ岡三・ＵＳドル・マネー・マーケット・ファンド';
var VARIANT_NAME = 'ＳＢＩ岡三・ＵＳドル・マネー・マーケット・ファンド（米ドル）';
var CANONICAL_SYMBOL = 'FUND:' + CANONICAL_NAME;
var VARIANT_SYMBOL = 'FUND:' + VARIANT_NAME;

function timestamp() {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

function parseDoc(row) {
  return JSON.parse(row.doc_json);
}

function encodeDoc(doc) {
  return JSON.stringify(doc || {});
}

function normalizeDoc(doc) {
  if (doc.assetName == VARIANT_NAME) {
    doc.assetName = CANONICAL_NAME;
  }
  if (doc.name == VARIANT_NAME) {
    doc.name = CANONICAL_NAME;
  }
  if (doc.symbol == VARIANT_SYMBOL) {
    doc.symbol = CANONICAL_SYMBOL;
  }
  return doc;
}

function mergeAssetDocs(canonical, variant) {
  var merged = Object.assign({}, variant || {}, canonical || {});
  Object.keys(variant || {}).forEach(function (key) {
    if ((merged[key] == null || merged[key] === '') && variant[key] != null && variant[key] !== '') {
      merged[key] = variant[key];
    }
  });
  merged.symbol = CANONICAL_SYMBOL;
  merged.name = CANONICAL_NAME;
  merged.assetName = CANONICAL_NAME;
  merged.assetType = merged.assetType || 'FUND';
  merged.assetSubType = merged.assetSubType || 'MMF';
  return merged;
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

async function updateTransactions(db) {
  var rows = await all(
    db,
    "SELECT id, source_hash, doc_json FROM transactions WHERE symbol = ? OR doc_json LIKE ?",
    [VARIANT_SYMBOL, '%' + VARIANT_NAME + '%']
  );
  var changed = 0;

  for (var i = 0; i < rows.length; i++) {
    var doc = normalizeDoc(parseDoc(rows[i]));
    await run(
      db,
      'UPDATE transactions SET symbol = ?, doc_json = ? WHERE id = ?',
      [doc.symbol || CANONICAL_SYMBOL, encodeDoc(doc), rows[i].id]
    );
    changed++;
  }

  return changed;
}

async function mergeAssets(db) {
  var canonicalRow = await get(db, 'SELECT doc_json FROM assets WHERE symbol = ?', [CANONICAL_SYMBOL]);
  var variantRow = await get(db, 'SELECT doc_json FROM assets WHERE symbol = ?', [VARIANT_SYMBOL]);
  if (!canonicalRow && !variantRow) {
    return 0;
  }

  var canonical = canonicalRow ? normalizeDoc(parseDoc(canonicalRow)) : null;
  var variant = variantRow ? normalizeDoc(parseDoc(variantRow)) : null;
  var merged = mergeAssetDocs(canonical, variant);
  var exists = !!canonicalRow;

  await run(
    db,
    exists
      ? 'UPDATE assets SET asset_type = ?, code = ?, name = ?, doc_json = ? WHERE symbol = ?'
      : 'INSERT INTO assets (symbol, asset_type, code, name, doc_json) VALUES (?, ?, ?, ?, ?)',
    exists
      ? [merged.assetType || '', merged.code || '', merged.name || '', encodeDoc(merged), CANONICAL_SYMBOL]
      : [CANONICAL_SYMBOL, merged.assetType || '', merged.code || '', merged.name || '', encodeDoc(merged)]
  );

  if (variantRow) {
    await run(db, 'DELETE FROM assets WHERE symbol = ?', [VARIANT_SYMBOL]);
  }

  return 1;
}

async function movePriceHistory(db) {
  var rows = await all(db, 'SELECT price_date, source, doc_json FROM price_history WHERE symbol = ?', [VARIANT_SYMBOL]);
  var moved = 0;

  for (var i = 0; i < rows.length; i++) {
    var doc = normalizeDoc(parseDoc(rows[i]));
    var existing = await get(
      db,
      'SELECT 1 FROM price_history WHERE symbol = ? AND price_date = ? AND source = ?',
      [CANONICAL_SYMBOL, rows[i].price_date, rows[i].source]
    );
    if (!existing) {
      await run(
        db,
        'INSERT INTO price_history (symbol, price_date, source, doc_json) VALUES (?, ?, ?, ?)',
        [CANONICAL_SYMBOL, rows[i].price_date, rows[i].source, encodeDoc(doc)]
      );
      moved++;
    }
    await run(
      db,
      'DELETE FROM price_history WHERE symbol = ? AND price_date = ? AND source = ?',
      [VARIANT_SYMBOL, rows[i].price_date, rows[i].source]
    );
  }

  return moved;
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error('SQLite DB not found: ' + DB_PATH);
  }

  var backupPath = DB_PATH + '.backup-before-okasan-mmf-merge-' + timestamp();
  fs.copyFileSync(DB_PATH, backupPath);

  var db = new sqlite3.Database(DB_PATH);
  try {
    await run(db, 'BEGIN IMMEDIATE TRANSACTION');
    var transactions = await updateTransactions(db);
    var assets = await mergeAssets(db);
    var priceHistory = await movePriceHistory(db);
    await run(db, 'COMMIT');
    console.log(JSON.stringify({
      backupPath: backupPath,
      canonicalSymbol: CANONICAL_SYMBOL,
      updatedTransactions: transactions,
      mergedAssets: assets,
      movedPriceHistoryRows: priceHistory
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
