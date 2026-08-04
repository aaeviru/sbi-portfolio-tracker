var fs = require('fs');
var path = require('path');
var sqlite3 = require('sqlite3').verbose();

var DB_PATH = process.env.SBI_PORTFOLIO_DB_PATH || path.join(__dirname, '..', 'data', 'sbi-portfolio-tracker.sqlite');
var DATA_DIR = path.dirname(DB_PATH);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function encodeDoc(doc) {
  return JSON.stringify(doc || {});
}

function decodeDoc(row) {
  if (!row || !row.doc_json) {
    return null;
  }
  return JSON.parse(row.doc_json);
}

function text(value) {
  if (value == null) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function numberOrNull(value) {
  return typeof value == 'number' && isFinite(value) ? value : null;
}

function runStatements(db, statements, callback) {
  var index = 0;

  function next(err) {
    if (err) {
      callback(err);
      return;
    }
    if (index >= statements.length) {
      callback(null);
      return;
    }
    db.run(statements[index], next);
    index++;
  }

  next();
}

function initDb(db, callback) {
  runStatements(db, [
    'CREATE TABLE IF NOT EXISTS transactions (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    'source TEXT NOT NULL,' +
    'source_hash TEXT NOT NULL,' +
    'trade_date_time TEXT,' +
    'symbol TEXT,' +
    'doc_json TEXT NOT NULL,' +
    'UNIQUE(source, source_hash)' +
    ')',
    'CREATE INDEX IF NOT EXISTS idx_transactions_sort ON transactions(trade_date_time, symbol)',
    'CREATE TABLE IF NOT EXISTS fx_trades (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    'source TEXT NOT NULL,' +
    'source_hash TEXT NOT NULL,' +
    'trade_date_time TEXT,' +
    'doc_json TEXT NOT NULL,' +
    'UNIQUE(source, source_hash)' +
    ')',
    'CREATE INDEX IF NOT EXISTS idx_fx_trades_sort ON fx_trades(trade_date_time)',
    'CREATE TABLE IF NOT EXISTS gold_holdings (' +
    'id TEXT PRIMARY KEY,' +
    'doc_json TEXT NOT NULL' +
    ')',
    'CREATE TABLE IF NOT EXISTS assets (' +
    'symbol TEXT PRIMARY KEY,' +
    'asset_type TEXT,' +
    'code TEXT,' +
    'name TEXT,' +
    'doc_json TEXT NOT NULL' +
    ')',
    'CREATE TABLE IF NOT EXISTS fx_rates (' +
    'pair TEXT NOT NULL,' +
    'rate_date TEXT NOT NULL,' +
    'doc_json TEXT NOT NULL,' +
    'PRIMARY KEY(pair, rate_date)' +
    ')',
    'CREATE TABLE IF NOT EXISTS price_history (' +
    'symbol TEXT NOT NULL,' +
    'price_date TEXT NOT NULL,' +
    'source TEXT NOT NULL,' +
    'doc_json TEXT NOT NULL,' +
    'PRIMARY KEY(symbol, price_date, source)' +
    ')',
    'CREATE INDEX IF NOT EXISTS idx_price_history_symbol_date ON price_history(symbol, price_date DESC)',
    'CREATE TABLE IF NOT EXISTS price_history_coverage (' +
    'coverage_key TEXT PRIMARY KEY,' +
    'symbol TEXT NOT NULL,' +
    'source TEXT NOT NULL,' +
    'start_date TEXT NOT NULL,' +
    'end_date TEXT NOT NULL,' +
    'status TEXT NOT NULL,' +
    'doc_json TEXT NOT NULL' +
    ')',
    'CREATE INDEX IF NOT EXISTS idx_price_history_coverage_symbol_source ON price_history_coverage(symbol, source, start_date)',
    'CREATE TABLE IF NOT EXISTS daily_reports (' +
    'report_date TEXT PRIMARY KEY,' +
    'created_at TEXT NOT NULL,' +
    'doc_json TEXT NOT NULL' +
    ')',
    'CREATE INDEX IF NOT EXISTS idx_daily_reports_created ON daily_reports(created_at DESC)'
  ], callback);
}

function tableConfig(name) {
  if (name == 'transactions') {
    return {
      table: 'transactions',
      keyWhere: function (doc) { return ['source = ? AND source_hash = ?', [doc.source, doc.sourceHash]]; },
      insertSql: 'INSERT INTO transactions (source, source_hash, trade_date_time, symbol, doc_json) VALUES (?, ?, ?, ?, ?)',
      updateSql: 'UPDATE transactions SET trade_date_time = ?, symbol = ?, doc_json = ? WHERE source = ? AND source_hash = ?',
      insertParams: function (doc) { return [text(doc.source), text(doc.sourceHash), text(doc.tradeDateTime), text(doc.symbol), encodeDoc(doc)]; },
      updateParams: function (doc) { return [text(doc.tradeDateTime), text(doc.symbol), encodeDoc(doc), text(doc.source), text(doc.sourceHash)]; },
      order: 'trade_date_time ASC, symbol ASC'
    };
  }
  if (name == 'fxTrades') {
    return {
      table: 'fx_trades',
      keyWhere: function (doc) { return ['source = ? AND source_hash = ?', [doc.source, doc.sourceHash]]; },
      insertSql: 'INSERT INTO fx_trades (source, source_hash, trade_date_time, doc_json) VALUES (?, ?, ?, ?)',
      updateSql: 'UPDATE fx_trades SET trade_date_time = ?, doc_json = ? WHERE source = ? AND source_hash = ?',
      insertParams: function (doc) { return [text(doc.source), text(doc.sourceHash), text(doc.tradeDateTime), encodeDoc(doc)]; },
      updateParams: function (doc) { return [text(doc.tradeDateTime), encodeDoc(doc), text(doc.source), text(doc.sourceHash)]; },
      order: 'trade_date_time ASC'
    };
  }
  if (name == 'goldHoldings') {
    return {
      table: 'gold_holdings',
      keyWhere: function (doc) { return ['id = ?', [doc._id || doc.id]]; },
      insertSql: 'INSERT INTO gold_holdings (id, doc_json) VALUES (?, ?)',
      updateSql: 'UPDATE gold_holdings SET doc_json = ? WHERE id = ?',
      insertParams: function (doc) { return [text(doc._id || doc.id), encodeDoc(doc)]; },
      updateParams: function (doc) { return [encodeDoc(doc), text(doc._id || doc.id)]; },
      order: 'id ASC'
    };
  }
  if (name == 'assets') {
    return {
      table: 'assets',
      keyWhere: function (doc) { return ['symbol = ?', [doc.symbol]]; },
      insertSql: 'INSERT INTO assets (symbol, asset_type, code, name, doc_json) VALUES (?, ?, ?, ?, ?)',
      updateSql: 'UPDATE assets SET asset_type = ?, code = ?, name = ?, doc_json = ? WHERE symbol = ?',
      insertParams: function (doc) { return [text(doc.symbol), text(doc.assetType), text(doc.code), text(doc.name), encodeDoc(doc)]; },
      updateParams: function (doc) { return [text(doc.assetType), text(doc.code), text(doc.name), encodeDoc(doc), text(doc.symbol)]; },
      order: 'symbol ASC'
    };
  }
  if (name == 'fxRates') {
    return {
      table: 'fx_rates',
      keyWhere: function (doc) { return ['pair = ? AND rate_date = ?', [doc.pair, doc.rateDate]]; },
      insertSql: 'INSERT INTO fx_rates (pair, rate_date, doc_json) VALUES (?, ?, ?)',
      updateSql: 'UPDATE fx_rates SET doc_json = ? WHERE pair = ? AND rate_date = ?',
      insertParams: function (doc) { return [text(doc.pair), text(doc.rateDate), encodeDoc(doc)]; },
      updateParams: function (doc) { return [encodeDoc(doc), text(doc.pair), text(doc.rateDate)]; },
      order: 'rate_date DESC'
    };
  }
  if (name == 'priceHistory') {
    return {
      table: 'price_history',
      keyWhere: function (doc) { return ['symbol = ? AND price_date = ? AND source = ?', [doc.symbol, doc.priceDate, doc.source]]; },
      insertSql: 'INSERT INTO price_history (symbol, price_date, source, doc_json) VALUES (?, ?, ?, ?)',
      updateSql: 'UPDATE price_history SET doc_json = ? WHERE symbol = ? AND price_date = ? AND source = ?',
      insertParams: function (doc) { return [text(doc.symbol), text(doc.priceDate), text(doc.source), encodeDoc(doc)]; },
      updateParams: function (doc) { return [encodeDoc(doc), text(doc.symbol), text(doc.priceDate), text(doc.source)]; },
      order: 'symbol ASC, price_date DESC'
    };
  }
  if (name == 'priceHistoryCoverage') {
    return {
      table: 'price_history_coverage',
      keyWhere: function (doc) { return ['coverage_key = ?', [doc.coverageKey]]; },
      insertSql: 'INSERT INTO price_history_coverage (coverage_key, symbol, source, start_date, end_date, status, doc_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      updateSql: 'UPDATE price_history_coverage SET symbol = ?, source = ?, start_date = ?, end_date = ?, status = ?, doc_json = ? WHERE coverage_key = ?',
      insertParams: function (doc) { return [text(doc.coverageKey), text(doc.symbol), text(doc.source), text(doc.startDate), text(doc.endDate), text(doc.status), encodeDoc(doc)]; },
      updateParams: function (doc) { return [text(doc.symbol), text(doc.source), text(doc.startDate), text(doc.endDate), text(doc.status), encodeDoc(doc), text(doc.coverageKey)]; },
      order: 'symbol ASC, source ASC, start_date ASC'
    };
  }
  if (name == 'dailyReports') {
    return {
      table: 'daily_reports',
      keyWhere: function (doc) { return ['report_date = ?', [doc.reportDate]]; },
      insertSql: 'INSERT INTO daily_reports (report_date, created_at, doc_json) VALUES (?, ?, ?)',
      updateSql: 'UPDATE daily_reports SET created_at = ?, doc_json = ? WHERE report_date = ?',
      insertParams: function (doc) { return [text(doc.reportDate), text(doc.createdAt), encodeDoc(doc)]; },
      updateParams: function (doc) { return [text(doc.createdAt), encodeDoc(doc), text(doc.reportDate)]; },
      order: 'report_date DESC'
    };
  }
  throw new Error('Unknown collection: ' + name);
}

function makeUpdateDoc(filter, update, existing) {
  var doc = existing ? Object.assign({}, existing) : Object.assign({}, filter);
  if (!existing && update && update.$setOnInsert) {
    Object.assign(doc, update.$setOnInsert);
  }
  if (update && update.$set) {
    Object.assign(doc, update.$set);
  }
  return doc;
}

function makeSimpleWhere(filter) {
  var columns = {
    coverageKey: 'coverage_key',
    symbol: 'symbol',
    source: 'source',
    status: 'status',
    startDate: 'start_date',
    endDate: 'end_date',
    priceDate: 'price_date',
    pair: 'pair',
    rateDate: 'rate_date'
  };
  var parts = [];
  var params = [];

  Object.keys(filter || {}).forEach(function (key) {
    if (columns[key] && filter[key] && typeof filter[key] != 'object') {
      parts.push(columns[key] + ' = ?');
      params.push(text(filter[key]));
    }
  });

  return {
    sql: parts.length ? parts.join(' AND ') : '',
    params: params
  };
}

function makeCursor(db, config, query) {
  var state = {
    sort: '',
    skip: 0,
    limit: 0
  };

  return {
    sort: function (sortSpec) {
      if (sortSpec && sortSpec.tradeDateTime === -1) {
        state.sort = config.table == 'transactions' ? 'trade_date_time DESC, symbol ASC' : 'trade_date_time DESC';
      } else if (sortSpec && sortSpec.tradeDateTime === 1) {
        state.sort = config.order;
      } else if (sortSpec && sortSpec.reportDate === -1) {
        state.sort = 'report_date DESC';
      } else if (sortSpec && sortSpec.reportDate === 1) {
        state.sort = 'report_date ASC';
      } else if (sortSpec && sortSpec.createdAt === -1) {
        state.sort = 'created_at DESC';
      } else if (sortSpec && sortSpec.createdAt === 1) {
        state.sort = 'created_at ASC';
      } else {
        state.sort = config.order;
      }
      return this;
    },
    skip: function (value) {
      state.skip = value || 0;
      return this;
    },
    limit: function (value) {
      state.limit = value || 0;
      return this;
    },
    toArray: function (callback) {
      var where = '';
      var params = [];
      if (query && query.symbol && query.symbol.$in) {
        where = ' WHERE symbol IN (' + query.symbol.$in.map(function () { return '?'; }).join(',') + ')';
        params = query.symbol.$in;
      } else {
        var simpleWhere = makeSimpleWhere(query);
        if (simpleWhere.sql) {
          where = ' WHERE ' + simpleWhere.sql;
          params = simpleWhere.params;
        }
      }

      var sql = 'SELECT doc_json FROM ' + config.table + where + ' ORDER BY ' + (state.sort || config.order);
      if (state.limit) {
        sql += ' LIMIT ? OFFSET ?';
        params.push(state.limit, state.skip);
      }

      db.all(sql, params, function (err, rows) {
        if (err) {
          callback(err);
          return;
        }
        callback(null, rows.map(decodeDoc).filter(Boolean));
      });
    }
  };
}

function makeCollection(db, name) {
  var config = tableConfig(name);

  return {
    updateOne: function (filter, update, options, callback) {
      if (typeof options == 'function') {
        callback = options;
        options = {};
      }

      var seedDoc = makeUpdateDoc(filter, update, null);
      var key = config.keyWhere(seedDoc);
      db.get('SELECT doc_json FROM ' + config.table + ' WHERE ' + key[0], key[1], function (err, row) {
        if (err) {
          callback(err);
          return;
        }

        var existing = decodeDoc(row);
        var doc = makeUpdateDoc(filter, update, existing);
        if (existing) {
          db.run(config.updateSql, config.updateParams(doc), function (updateErr) {
            callback(updateErr, updateErr ? null : { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 });
          });
        } else if (options && options.upsert) {
          db.run(config.insertSql, config.insertParams(doc), function (insertErr) {
            callback(insertErr, insertErr ? null : { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 });
          });
        } else {
          callback(null, { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 });
        }
      });
    },
    bulkWrite: function (updates, options, callback) {
      var inserted = 0;
      var modified = 0;
      var index = 0;

      function next(err) {
        if (err) {
          callback(err);
          return;
        }
        if (index >= updates.length) {
          callback(null, { insertedCount: inserted, modifiedCount: modified });
          return;
        }

        var op = updates[index].updateOne;
        index++;
        thisCollection.updateOne(op.filter, op.update, { upsert: op.upsert }, function (updateErr, result) {
          if (!updateErr && result) {
            inserted += result.upsertedCount || 0;
            modified += result.modifiedCount || 0;
          }
          next(updateErr);
        });
      }

      var thisCollection = this;
      next();
    },
    find: function (query) {
      return makeCursor(db, config, query);
    },
    findOne: function (filter, callback) {
      var doc = Object.assign({}, filter);
      var key = config.keyWhere(doc);
      db.get('SELECT doc_json FROM ' + config.table + ' WHERE ' + key[0], key[1], function (err, row) {
        if (err) {
          callback(err);
          return;
        }
        callback(null, decodeDoc(row));
      });
    },
    deleteMany: function (filter, callback) {
      var where = makeSimpleWhere(filter);
      if (!where.sql) {
        callback(new Error('deleteMany requires a supported equality filter'));
        return;
      }

      db.run('DELETE FROM ' + config.table + ' WHERE ' + where.sql, where.params, function (err) {
        callback(err, err ? null : { deletedCount: this.changes || 0 });
      });
    },
    countDocuments: function (callback) {
      db.get('SELECT COUNT(*) AS count FROM ' + config.table, [], function (err, row) {
        callback(err, row ? row.count : 0);
      });
    }
  };
}

function makeAdapter(db) {
  return {
    collection: function (name) {
      return makeCollection(db, name);
    }
  };
}

function withDb(callback) {
  ensureDataDir();
  var db = new sqlite3.Database(DB_PATH, function (err) {
    if (err) {
      callback(err);
      return;
    }

    initDb(db, function (initErr) {
      if (initErr) {
        db.close();
        callback(initErr);
        return;
      }

      callback(null, makeAdapter(db), function () {
        db.close();
      });
    });
  });
}

module.exports = {
  DB_PATH: DB_PATH,
  withDb: withDb
};
