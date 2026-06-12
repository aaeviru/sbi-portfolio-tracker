var express = require('express');
var formidable = require('formidable');
var fs = require('fs');
var path = require('path')
var crypto = require('crypto');
var TextDecoder = require('util').TextDecoder;
var buildPortfolioSummary = require('./lib/portfolioSummary').buildPortfolioSummary;
var buildPortfolioSummaryReport = require('./lib/portfolioSummary').buildPortfolioSummaryReport;
var buildTradeChartData = require('./lib/tradeChart').buildTradeChartData;
var attachPriceHistoryToTradeChartData = require('./lib/tradeChart').attachPriceHistoryToTradeChartData;
var withDb = require('./lib/db').withDb;
var app = express();

var PORT = 80;
app.set('view engine', 'ejs');
app.use(express.static('public'));
const bodyParser = require('body-parser')

app.use(
  bodyParser.urlencoded({
    extended: true
  })
)

app.use(bodyParser.json())

function parseCsvLine(line) {
  var values = [];
  var current = '';
  var quoted = false;

  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    var next = line[i + 1];

    if (c == '"' && quoted && next == '"') {
      current += '"';
      i++;
    } else if (c == '"') {
      quoted = !quoted;
    } else if (c == ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += c;
    }
  }

  values.push(current);
  return values;
}

function cleanCsvValue(value) {
  if (value == null) {
    return '';
  }

  value = String(value).trim();
  if (value == '--') {
    return '';
  }
  return value;
}

function parseNumber(value) {
  value = cleanCsvValue(value).replace(/,/g, '');
  value = value.replace(/円|¥|USD|USドル|g/g, '');
  if (value === '') {
    return null;
  }

  var parsed = Number(value);
  return isNaN(parsed) ? null : parsed;
}

function detectMoneyCurrency(value, fallback) {
  value = cleanCsvValue(value);
  if (/USD|USドル/i.test(value)) {
    return 'USD';
  }
  if (/円|¥/.test(value)) {
    return 'JPY';
  }
  return fallback || 'JPY';
}

function normalizeDate(value) {
  value = cleanCsvValue(value);
  if (!value) {
    return '';
  }

  return value.replace(/\//g, '-');
}

function normalizeSide(action) {
  if (action.indexOf('買') >= 0) {
    return 'BUY';
  }
  if (action.indexOf('売') >= 0 || action.indexOf('解約') >= 0) {
    return 'SELL';
  }
  return 'OTHER';
}

function normalizeAssetType(row) {
  if (row.productCategory && row.productCategory.indexOf('米国株') >= 0) {
    return 'US_STOCK';
  }
  if (row.code) {
    return 'STOCK';
  }
  if (row.action.indexOf('投信') >= 0) {
    return 'FUND';
  }
  return 'UNKNOWN';
}

function normalizeStockCode(code) {
  code = cleanCsvValue(code).toUpperCase();
  var alphaCode = code.match(/^([0-9]{3}[A-Z])/);
  if (alphaCode) {
    return alphaCode[1];
  }
  return code;
}

function makeSymbol(row) {
  if (row.assetType == 'US_STOCK' && row.code) {
    return row.code;
  }
  if (row.code) {
    return normalizeStockCode(row.code) + '.T';
  }

  return 'FUND:' + row.assetName;
}

function makeTradeTime(side) {
  if (side == 'BUY') {
    return '09:00:00';
  }
  if (side == 'SELL') {
    return '15:00:00';
  }
  return '12:00:00';
}

function decodeSbiCsv(buffer) {
  return new TextDecoder('shift_jis').decode(buffer);
}

function parseSbiCsv(buffer, sourceFile) {
  var text = decodeSbiCsv(buffer);
  var lines = text.split(/\r?\n/);
  var headerIndex = -1;
  var parser = 'DOMESTIC';

  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('約定日,銘柄,銘柄コード') === 0) {
      headerIndex = i;
      break;
    }
    if (lines[i].indexOf('"国内約定日","銘柄","銘柄コード"') === 0 || lines[i].indexOf('国内約定日,銘柄,銘柄コード') === 0) {
      headerIndex = i;
      parser = 'FOREIGN_STOCK';
      break;
    }
  }

  if (headerIndex < 0) {
    throw new Error('SBI CSV header was not found.');
  }

  var headers = parseCsvLine(lines[headerIndex]).map(cleanCsvValue);
  var importedAt = new Date();
  var docs = [];

  for (var lineIndex = headerIndex + 1; lineIndex < lines.length; lineIndex++) {
    var line = lines[lineIndex].trim();
    if (!line) {
      continue;
    }

    var columns = parseCsvLine(line);
    if (columns.length < headers.length) {
      continue;
    }

    var raw = {};
    headers.forEach(function (header, index) {
      raw[header] = cleanCsvValue(columns[index]);
    });

    var row;
    if (parser == 'FOREIGN_STOCK') {
      row = {
        tradeDate: normalizeDate(raw['国内約定日']),
        assetName: raw['銘柄'],
        code: cleanCsvValue(raw['銘柄コード']).toUpperCase(),
        market: raw['市場'],
        productCategory: raw['商品区分'],
        orderType: raw['注文種別'],
        action: raw['取引'],
        term: '',
        account: raw['預り区分'],
        taxCategory: '',
        quantity: parseNumber(raw['約定数量']),
        price: parseNumber(raw['約定単価']),
        fee: 0,
        tax: 0,
        settlementDate: normalizeDate(raw['国内受渡日']),
        settlementAmount: parseNumber(raw['受渡金額/決済損益']),
        currency: 'USD',
        settlementCurrency: detectMoneyCurrency(raw['受渡金額/決済損益'], 'USD')
      };
    } else {
      row = {
        tradeDate: normalizeDate(raw['約定日']),
        assetName: raw['銘柄'],
        code: normalizeStockCode(raw['銘柄コード']),
        market: raw['市場'],
        action: raw['取引'],
        term: raw['期限'],
        account: raw['預り'],
        taxCategory: raw['課税'],
        quantity: parseNumber(raw['約定数量']),
        price: parseNumber(raw['約定単価']),
        fee: parseNumber(raw['手数料/諸経費等']) || 0,
        tax: parseNumber(raw['税額']) || 0,
        settlementDate: normalizeDate(raw['受渡日']),
        settlementAmount: parseNumber(raw['受渡金額/決済損益']),
        currency: 'JPY',
        settlementCurrency: 'JPY'
      };
    }

    row.side = normalizeSide(row.action);
    row.assetType = normalizeAssetType(row);
    row.symbol = makeSymbol(row);
    row.tradeTime = makeTradeTime(row.side);
    row.tradeDateTime = row.tradeDate ? row.tradeDate + 'T' + row.tradeTime : '';
    row.priceUnit = row.assetType == 'FUND' ? 'PER_10000_UNITS' : 'PER_SHARE';
    row.unitPrice = row.assetType == 'FUND' && row.price != null ? row.price / 10000 : row.price;

    var hashSource = [
      row.tradeDate,
      row.assetName,
      row.code,
      row.action,
      row.quantity,
      row.price,
      row.settlementDate,
      row.settlementAmount
    ].join('|');

    docs.push({
      source: 'SBI',
      sourceFile: sourceFile,
      sourceHash: crypto.createHash('sha1').update(hashSource).digest('hex'),
      importedAt: importedAt,
      raw: raw,
      tradeDate: row.tradeDate,
      tradeTime: row.tradeTime,
      tradeDateTime: row.tradeDateTime,
      settlementDate: row.settlementDate,
      assetName: row.assetName,
      assetType: row.assetType,
      code: row.code,
      market: row.market,
      symbol: row.symbol,
      productCategory: row.productCategory || '',
      orderType: row.orderType || '',
      side: row.side,
      action: row.action,
      account: row.account,
      taxCategory: row.taxCategory,
      quantity: row.quantity,
      price: row.price,
      unitPrice: row.unitPrice,
      priceUnit: row.priceUnit,
      currency: row.currency,
      settlementCurrency: row.settlementCurrency,
      fee: row.fee,
      tax: row.tax,
      settlementAmount: row.settlementAmount
    });
  }

  docs.sort(function (a, b) {
    if (a.tradeDateTime < b.tradeDateTime) {
      return -1;
    }
    if (a.tradeDateTime > b.tradeDateTime) {
      return 1;
    }
    if (a.symbol < b.symbol) {
      return -1;
    }
    if (a.symbol > b.symbol) {
      return 1;
    }
    return 0;
  });

  return docs;
}

function parseFxCsv(buffer, sourceFile) {
  var text = decodeSbiCsv(buffer);
  var lines = text.split(/\r?\n/);
  var headerIndex = -1;

  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('注文番号,約定日,建玉番号,通貨ペア') === 0) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex < 0) {
    throw new Error('FX CSV header was not found.');
  }

  var headers = parseCsvLine(lines[headerIndex]).map(cleanCsvValue);
  var importedAt = new Date();
  var docs = [];

  for (var lineIndex = headerIndex + 1; lineIndex < lines.length; lineIndex++) {
    var line = lines[lineIndex].trim();
    if (!line) {
      continue;
    }

    var columns = parseCsvLine(line);
    if (columns.length < headers.length) {
      continue;
    }

    var raw = {};
    headers.forEach(function (header, index) {
      raw[header] = cleanCsvValue(columns[index]);
    });

    var tradeDateTime = normalizeDate(raw['約定日']);
    var hashSource = [
      raw['注文番号'],
      raw['約定日'],
      raw['建玉番号'],
      raw['通貨ペア'],
      raw['取引'],
      raw['数量'],
      raw['決済価格(建単価)'],
      raw['合計損益']
    ].join('|');

    docs.push({
      source: 'SBI_FX',
      sourceFile: sourceFile,
      sourceHash: crypto.createHash('sha1').update(hashSource).digest('hex'),
      importedAt: importedAt,
      raw: raw,
      orderId: raw['注文番号'],
      positionId: raw['建玉番号'],
      tradeDateTime: tradeDateTime,
      pair: raw['通貨ペア'],
      action: raw['取引'],
      quantity: parseNumber(raw['数量']),
      rate: parseNumber(raw['決済価格(建単価)']),
      conversionRate: parseNumber(raw['換算レート']),
      fee: parseNumber(raw['手数料']) || 0,
      realizedSwap: parseNumber(raw['実現スワップ']) || 0,
      realizedPl: parseNumber(raw['実現損益']) || 0,
      totalPl: parseNumber(raw['合計損益']) || 0
    });
  }

  docs.sort(function (a, b) {
    if (a.tradeDateTime < b.tradeDateTime) {
      return -1;
    }
    if (a.tradeDateTime > b.tradeDateTime) {
      return 1;
    }
    return 0;
  });

  return docs;
}

function parseGoldCsv(buffer, sourceFile) {
  var text = buffer.toString('utf8');
  if (text.indexOf('受付番号') < 0) {
    text = decodeSbiCsv(buffer);
  }
  text = text.replace(/^\uFEFF/, '');
  var lines = text.split(/\r?\n/);
  var headerIndex = -1;

  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('"受付番号","注文日時","注文状況","商品","取引種別"') === 0 ||
      lines[i].indexOf('受付番号,注文日時,注文状況,商品,取引種別') === 0) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex < 0) {
    throw new Error('Gold CSV header was not found.');
  }

  var headers = parseCsvLine(lines[headerIndex]).map(cleanCsvValue);
  var rows = [];
  var grams = 0;
  var buyAmount = 0;
  var importedAt = new Date();

  for (var lineIndex = headerIndex + 1; lineIndex < lines.length; lineIndex++) {
    var line = lines[lineIndex].trim();
    if (!line) {
      continue;
    }

    var columns = parseCsvLine(line);
    if (columns.length < headers.length) {
      continue;
    }

    var raw = {};
    headers.forEach(function (header, index) {
      raw[header] = cleanCsvValue(columns[index]);
    });

    if (raw['注文状況'] != '全約定' || raw['商品'] != '金') {
      continue;
    }

    var quantity = parseNumber(raw['約定数量']);
    var amount = parseNumber(raw['約定金額']);
    var fee = parseNumber(raw['手数料 (税込)']) || 0;
    if (!isFinite(quantity) || quantity <= 0 || !isFinite(amount)) {
      continue;
    }

    var side = raw['取引種別'].indexOf('買付') >= 0 ? 'BUY' : raw['取引種別'].indexOf('売') >= 0 ? 'SELL' : 'OTHER';
    if (side != 'BUY') {
      continue;
    }

    grams += quantity;
    buyAmount += amount + fee;
    rows.push(raw);
  }

  return {
    _id: 'gold',
    source: 'SBI_GOLD',
    sourceFile: sourceFile,
    importedAt: importedAt,
    grams: Math.round(grams * 10000) / 10000,
    buyAmount: Math.round(buyAmount),
    rowCount: rows.length,
    rawRows: rows
  };
}

function importTransactions(db, docs, callback) {
  var collection = db.collection('transactions');
  var inserted = 0;
  var updated = 0;
  var pending = docs.length;

  if (pending === 0) {
    callback(null, { inserted: 0, updated: 0, total: 0 });
    return;
  }

  docs.forEach(function (doc) {
    collection.updateOne(
      { source: doc.source, sourceHash: doc.sourceHash },
      { $set: doc },
      { upsert: true },
      function (err, result) {
        if (err) {
          callback(err);
          callback = function () { };
          return;
        }

        if (result.upsertedCount) {
          inserted += result.upsertedCount;
        } else if (result.modifiedCount) {
          updated += result.modifiedCount;
        }

        pending--;
        if (pending === 0) {
          callback(null, { inserted: inserted, updated: updated, total: docs.length });
        }
      }
    );
  });
}

function importFxTrades(db, docs, callback) {
  var collection = db.collection('fxTrades');
  var inserted = 0;
  var updated = 0;
  var pending = docs.length;

  if (pending === 0) {
    callback(null, { inserted: 0, updated: 0, total: 0 });
    return;
  }

  docs.forEach(function (doc) {
    collection.updateOne(
      { source: doc.source, sourceHash: doc.sourceHash },
      { $set: doc },
      { upsert: true },
      function (err, result) {
        if (err) {
          callback(err);
          callback = function () { };
          return;
        }

        if (result.upsertedCount) {
          inserted += result.upsertedCount;
        } else if (result.modifiedCount) {
          updated += result.modifiedCount;
        }

        pending--;
        if (pending === 0) {
          callback(null, { inserted: inserted, updated: updated, total: docs.length });
        }
      }
    );
  });
}

function importGoldHolding(db, holding, callback) {
  db.collection('goldHoldings').updateOne(
    { _id: 'gold' },
    {
      $set: {
        source: holding.source,
        sourceFile: holding.sourceFile,
        importedAt: holding.importedAt,
        grams: holding.grams,
        buyAmount: holding.buyAmount,
        rowCount: holding.rowCount,
        rawRows: holding.rawRows,
        updatedAt: new Date()
      }
    },
    { upsert: true },
    function (err, result) {
      if (err) {
        callback(err);
        return;
      }

      callback(null, {
        inserted: result.upsertedCount || 0,
        updated: result.modifiedCount || result.matchedCount || 0,
        total: holding.rowCount
      });
    }
  );
}

function findAllFxTrades(db, callback) {
  db.collection('fxTrades').find().sort({ tradeDateTime: 1 }).toArray(function (err, docs) {
    callback(err, docs);
  });
}

function buildFxSummary(trades) {
  var byPair = {};
  trades.forEach(function (trade) {
    if (!byPair[trade.pair]) {
      byPair[trade.pair] = {
        pair: trade.pair,
        txCount: 0,
        openQty: 0,
        settlementQty: 0,
        deliveryQty: 0,
        realizedSwap: 0,
        realizedPl: 0,
        totalPl: 0
      };
    }

    var row = byPair[trade.pair];
    row.txCount++;
    if (trade.action == '新規買') {
      row.openQty += trade.quantity || 0;
    } else if (trade.action == '決済売') {
      row.settlementQty += trade.quantity || 0;
    } else if (trade.action == '現引') {
      row.deliveryQty += trade.quantity || 0;
    }
    row.realizedSwap += trade.realizedSwap || 0;
    row.realizedPl += trade.realizedPl || 0;
    row.totalPl += trade.totalPl || 0;
  });

  var rows = Object.keys(byPair).map(function (pair) {
    var row = byPair[pair];
    row.realizedSwap = Math.round(row.realizedSwap);
    row.realizedPl = Math.round(row.realizedPl);
    row.totalPl = Math.round(row.totalPl);
    return row;
  }).sort(function (a, b) {
    return a.pair.localeCompare(b.pair);
  });

  var totals = rows.reduce(function (total, row) {
    total.realizedSwap += row.realizedSwap;
    total.realizedPl += row.realizedPl;
    total.totalPl += row.totalPl;
    return total;
  }, { realizedSwap: 0, realizedPl: 0, totalPl: 0 });

  return { rows: rows, totals: totals };
}

function buildCombinedSummaryTotals(portfolioTotals, fxTotals) {
  portfolioTotals = portfolioTotals || {};
  fxTotals = fxTotals || {};

  var portfolioMarketValue = portfolioTotals.marketValue || 0;
  var portfolioUnrealizedPl = portfolioTotals.unrealizedPl || 0;
  var portfolioRealizedPl = portfolioTotals.realizedPl || 0;
  var portfolioTotalPl = portfolioTotals.totalPl || 0;
  var fxTotalPl = fxTotals.totalPl || 0;

  return {
    portfolioMarketValue: portfolioMarketValue,
    portfolioUnrealizedPl: portfolioUnrealizedPl,
    portfolioRealizedPl: portfolioRealizedPl,
    portfolioTotalPl: portfolioTotalPl,
    fxTotalPl: fxTotalPl,
    combinedRealizedPl: portfolioRealizedPl + fxTotalPl,
    combinedTotalPl: portfolioTotalPl + fxTotalPl
  };
}

function findGoldHolding(db, callback) {
  db.collection('goldHoldings').findOne({ _id: 'gold' }, function (err, doc) {
    callback(err, doc || { _id: 'gold', grams: 0, buyAmount: 0 });
  });
}

function makeGoldTransaction(goldHolding) {
  if (!goldHolding || !isFinite(goldHolding.grams) || goldHolding.grams <= 0) {
    return null;
  }

  var buyAmount = isFinite(goldHolding.buyAmount) ? goldHolding.buyAmount : 0;
  return {
    source: 'MANUAL',
    sourceFile: '',
    sourceHash: 'manual-gold',
    tradeDate: '',
    tradeTime: '09:00:00',
    tradeDateTime: '9999-12-31T09:00:00',
    settlementDate: '',
    assetName: 'Gold',
    assetType: 'GOLD',
    code: '',
    market: '',
    symbol: 'GOLD_JPY',
    productCategory: '',
    orderType: '',
    side: 'BUY',
    action: 'Manual',
    account: '',
    taxCategory: '',
    quantity: goldHolding.grams,
    price: buyAmount / goldHolding.grams,
    unitPrice: buyAmount / goldHolding.grams,
    priceUnit: 'PER_GRAM',
    currency: 'JPY',
    settlementCurrency: 'JPY',
    fee: 0,
    tax: 0,
    settlementAmount: buyAmount
  };
}

function addGoldTransaction(transactions, goldHolding) {
  var goldTransaction = makeGoldTransaction(goldHolding);
  if (goldTransaction) {
    return transactions.concat([goldTransaction]);
  }
  return transactions;
}

function getHistoryBuyDate(tx) {
  var date = normalizeDate(tx.tradeDateTime || tx.tradeDate);
  if (!date) {
    return '';
  }
  if (tx.assetType == 'US_STOCK') {
    return addDays(date, -1);
  }
  return date;
}

function findLatestBuyDatesBySymbol(transactions) {
  var latestBySymbol = {};

  transactions.forEach(function (tx) {
    if (tx.side != 'BUY' || (tx.assetType != 'STOCK' && tx.assetType != 'US_STOCK')) {
      return;
    }

    var symbol = tx.symbol || tx.code;
    var date = getHistoryBuyDate(tx);
    if (!symbol || !date) {
      return;
    }

    if (!latestBySymbol[symbol] || date > latestBySymbol[symbol]) {
      latestBySymbol[symbol] = date;
    }
  });

  return latestBySymbol;
}

function summaryRowsToAssetUpdates(rows) {
  return rows.map(function (row) {
    return {
      updateOne: {
        filter: { symbol: row.symbol },
        update: {
          $set: {
            symbol: row.symbol,
            assetType: row.assetType,
            code: row.code,
            name: row.name
          },
          $setOnInsert: {
            priceSource: row.assetType == 'STOCK' || row.assetType == 'US_STOCK' || row.assetType == 'GOLD' ? 'YAHOO_CHART' : 'MAPPED_URL',
            priceSourceUrl: '',
            latestPrice: null,
            latestPriceDate: '',
            latestPriceFetchedAt: '',
            priceFetchStatus: '',
            priceFetchError: '',
            priceHistoryFetchedAt: '',
            priceHistoryFetchStatus: '',
            priceHistoryFetchError: '',
            priceHistoryLatestDate: ''
          }
        },
        upsert: true
      }
    };
  });
}

function syncAssetsFromSummary(db, rows, callback) {
  var updates = summaryRowsToAssetUpdates(rows);
  if (updates.length === 0) {
    callback(null);
    return;
  }

  db.collection('assets').bulkWrite(updates, { ordered: false }, callback);
}

function findAssetsBySymbols(db, symbols, callback) {
  if (symbols.length === 0) {
    callback(null, {});
    return;
  }

  db.collection('assets').find({ symbol: { $in: symbols } }).toArray(function (err, docs) {
    if (err) {
      callback(err);
      return;
    }

    var assetsBySymbol = {};
    docs.forEach(function (doc) {
      assetsBySymbol[doc.symbol] = doc;
    });
    callback(null, assetsBySymbol);
  });
}

function upsertFxRate(db, rate, callback) {
  db.collection('fxRates').updateOne(
    { pair: rate.pair, rateDate: rate.rateDate },
    {
      $set: {
        pair: rate.pair,
        rate: rate.rate,
        rateDate: rate.rateDate,
        fetchedAt: rate.fetchedAt,
        status: rate.status,
        error: rate.error
      }
    },
    { upsert: true },
    function (err) {
      callback(err, rate);
    }
  );
}

function findLatestFxRate(db, pair, callback) {
  db.collection('fxRates').find({ pair: pair }).sort({ rateDate: -1 }).limit(1).toArray(function (err, rows) {
    if (err) {
      callback(err);
      return;
    }
    callback(null, rows[0] || null);
  });
}

function getLatestFxRate(db, pair, callback) {
  findLatestFxRate(db, pair, function (findErr, existing) {
    if (findErr) {
      callback(findErr);
      return;
    }

    if (pair != 'USDJPY') {
      callback(new Error('Unsupported FX pair: ' + pair));
      return;
    }

    fetchUsdJpyDailyRates('7d', function (fetchErr, rates) {
      if (fetchErr) {
        if (existing && isFinite(existing.rate)) {
          existing.status = 'STALE';
          existing.error = fetchErr.message;
          callback(null, existing);
          return;
        }
        callback(fetchErr);
        return;
      }

      upsertFxRates(db, rates, function (upsertErr) {
        if (upsertErr) {
          callback(upsertErr);
          return;
        }
        findLatestFxRate(db, pair, callback);
      });
    });
  });
}

function upsertFxRates(db, rates, callback) {
  var pending = rates.length;
  if (pending === 0) {
    callback(new Error('No FX rates returned'));
    return;
  }

  rates.forEach(function (rate) {
    upsertFxRate(db, rate, function (err) {
      if (err) {
        callback(err);
        callback = function () { };
        return;
      }

      pending--;
      if (pending === 0) {
        callback(null);
      }
    });
  });
}

function normalizeSourceUrl(value) {
  value = cleanCsvValue(value);
  if (!value) {
    return '';
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return 'https://finance.yahoo.co.jp/quote/' + encodeURIComponent(value);
}

function fetchText(url, callback) {
  https.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 iriyano-price-fetcher'
    }
  }, function (resp) {
    var data = '';

    resp.on('data', function (chunk) {
      data += chunk;
    });

    resp.on('end', function () {
      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        callback(new Error('HTTP ' + resp.statusCode));
        return;
      }
      callback(null, data);
    });
  }).on('error', callback);
}

function fetchYahooChartPrice(symbol, callback) {
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=1d&interval=1d';
  fetchText(url, function (err, data) {
    if (err) {
      callback(err);
      return;
    }

    try {
      var json = JSON.parse(data);
      var result = json.chart && json.chart.result && json.chart.result[0];
      var meta = result && result.meta;
      var price = meta && meta.regularMarketPrice;
      var marketTime = meta && meta.regularMarketTime;

      if (!isFinite(price)) {
        callback(new Error('Price not found'));
        return;
      }

      callback(null, {
        price: Number(price),
        priceDate: marketTime ? new Date(marketTime * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
      });
    } catch (parseErr) {
      callback(parseErr);
    }
  });
}

function parseYahooChartDailyRates(json, pair) {
  var result = json.chart && json.chart.result && json.chart.result[0];
  var timestamps = result && result.timestamp;
  var quote = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
  var rates = [];

  if (!timestamps || !quote || !quote.close) {
    return rates;
  }

  for (var i = 0; i < timestamps.length; i++) {
    var close = quote.close[i];
    if (!isFinite(close)) {
      continue;
    }

    var rateDate = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    rates.push({
      pair: pair,
      rateDate: rateDate,
      rateType: 'DAILY_CLOSE',
      rate: Number(close),
      open: isFinite(quote.open && quote.open[i]) ? Number(quote.open[i]) : null,
      high: isFinite(quote.high && quote.high[i]) ? Number(quote.high[i]) : null,
      low: isFinite(quote.low && quote.low[i]) ? Number(quote.low[i]) : null,
      close: Number(close),
      source: 'YAHOO_CHART',
      fetchedAt: new Date(),
      status: 'OK',
      error: ''
    });
  }

  return rates;
}

function fetchYahooChartDailyRates(symbol, pair, range, callback) {
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=' + encodeURIComponent(range) + '&interval=1d';
  fetchText(url, function (err, data) {
    if (err) {
      callback(err);
      return;
    }

    try {
      var rates = parseYahooChartDailyRates(JSON.parse(data), pair);
      if (rates.length === 0) {
        callback(new Error('Daily FX rates not found'));
        return;
      }
      callback(null, rates);
    } catch (parseErr) {
      callback(parseErr);
    }
  });
}

function parseYahooChartDailyPriceHistory(json, asset) {
  var result = json.chart && json.chart.result && json.chart.result[0];
  var timestamps = result && result.timestamp;
  var quote = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
  var rows = [];

  if (!timestamps || !quote || !quote.close) {
    return rows;
  }

  for (var i = 0; i < timestamps.length; i++) {
    var close = quote.close[i];
    if (!isFinite(close)) {
      continue;
    }

    rows.push({
      symbol: asset.symbol,
      assetType: asset.assetType,
      priceDate: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      currency: asset.assetType == 'US_STOCK' ? 'USD' : 'JPY',
      open: isFinite(quote.open && quote.open[i]) ? Number(quote.open[i]) : null,
      high: isFinite(quote.high && quote.high[i]) ? Number(quote.high[i]) : null,
      low: isFinite(quote.low && quote.low[i]) ? Number(quote.low[i]) : null,
      close: Number(close),
      volume: isFinite(quote.volume && quote.volume[i]) ? Number(quote.volume[i]) : null,
      source: 'YAHOO_CHART',
      fetchedAt: new Date(),
      status: 'OK',
      error: ''
    });
  }

  return rows;
}

function fetchYahooChartDailyPriceHistory(asset, startDate, endDate, callback) {
  var period1 = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / 1000);
  var period2 = Math.floor(new Date(addDays(endDate, 1) + 'T00:00:00Z').getTime() / 1000);
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(asset.symbol) +
    '?period1=' + period1 + '&period2=' + period2 + '&interval=1d';

  fetchText(url, function (err, data) {
    if (err) {
      callback(err);
      return;
    }

    try {
      var rows = parseYahooChartDailyPriceHistory(JSON.parse(data), asset);
      if (rows.length === 0) {
        callback(new Error('Daily price history not found'));
        return;
      }
      callback(null, rows);
    } catch (parseErr) {
      callback(parseErr);
    }
  });
}

function addDays(dateText, days) {
  var date = new Date(dateText + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function maxDateText(a, b) {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return a > b ? a : b;
}

function minDateText(a, b) {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return a < b ? a : b;
}

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function hoursSince(value) {
  if (!value) {
    return Infinity;
  }
  var time = new Date(value).getTime();
  if (!isFinite(time)) {
    return Infinity;
  }
  return (Date.now() - time) / (60 * 60 * 1000);
}

function findLatestPriceHistory(db, symbol, callback) {
  db.collection('priceHistory').find({ symbol: symbol }).limit(1).toArray(function (err, rows) {
    if (err) {
      callback(err);
      return;
    }
    callback(null, rows[0] || null);
  });
}

function upsertPriceHistoryRows(db, rows, callback) {
  var pending = rows.length;
  if (pending === 0) {
    callback(null, { inserted: 0, updated: 0, total: 0 });
    return;
  }

  var inserted = 0;
  var updated = 0;
  rows.forEach(function (row) {
    db.collection('priceHistory').updateOne(
      { symbol: row.symbol, priceDate: row.priceDate, source: row.source },
      { $set: row },
      { upsert: true },
      function (err, result) {
        if (err) {
          callback(err);
          callback = function () { };
          return;
        }
        inserted += result.upsertedCount || 0;
        updated += result.modifiedCount || 0;
        pending--;
        if (pending === 0) {
          callback(null, { inserted: inserted, updated: updated, total: rows.length });
        }
      }
    );
  });
}

function updateAssetPriceHistoryStatus(db, asset, fields, callback) {
  db.collection('assets').updateOne({ symbol: asset.symbol }, { $set: fields }, callback);
}

function refreshAssetPriceHistory(db, asset, callback) {
  var isStock = asset.assetType == 'STOCK' || asset.assetType == 'US_STOCK';
  if (!isStock) {
    callback(null, { ok: true, symbol: asset.symbol, skipped: true, reason: 'NOT_STOCK' });
    return;
  }

  if (hoursSince(asset.priceHistoryFetchedAt) < 12) {
    callback(null, { ok: true, symbol: asset.symbol, skipped: true, reason: 'COOLDOWN' });
    return;
  }

  findLatestPriceHistory(db, asset.symbol, function (findErr, latest) {
    if (findErr) {
      callback(findErr);
      return;
    }

    var today = todayText();
    var startDate = latest && latest.priceDate
      ? addDays(latest.priceDate, 1)
      : maxDateText(addDays(today, -30), asset.priceHistoryStartDate || '');
    var endDate = minDateText(today, addDays(startDate, 29));
    if (startDate > endDate) {
      updateAssetPriceHistoryStatus(db, asset, {
        priceHistoryFetchedAt: new Date(),
        priceHistoryFetchStatus: 'UP_TO_DATE',
        priceHistoryFetchError: ''
      }, function (statusErr) {
        callback(statusErr, { ok: !statusErr, symbol: asset.symbol, skipped: true, reason: 'UP_TO_DATE' });
      });
      return;
    }

    fetchYahooChartDailyPriceHistory(asset, startDate, endDate, function (fetchErr, rows) {
      if (fetchErr) {
        updateAssetPriceHistoryStatus(db, asset, {
          priceHistoryFetchedAt: new Date(),
          priceHistoryFetchStatus: fetchErr.message == 'HTTP 429' ? 'RATE_LIMITED' : 'ERROR',
          priceHistoryFetchError: fetchErr.message
        }, function (statusErr) {
          callback(statusErr, { ok: false, symbol: asset.symbol, error: fetchErr.message, stop: fetchErr.message == 'HTTP 429' });
        });
        return;
      }

      upsertPriceHistoryRows(db, rows, function (upsertErr, result) {
        if (upsertErr) {
          callback(upsertErr);
          return;
        }

        updateAssetPriceHistoryStatus(db, asset, {
          priceHistoryFetchedAt: new Date(),
          priceHistoryFetchStatus: 'OK',
          priceHistoryFetchError: '',
          priceHistoryLatestDate: rows[rows.length - 1].priceDate
        }, function (statusErr) {
          callback(statusErr, {
            ok: !statusErr,
            symbol: asset.symbol,
            historyRows: result.total,
            historyInserted: result.inserted,
            historyUpdated: result.updated
          });
        });
      });
    });
  });
}

function fetchStockPrice(symbol, callback) {
  fetchYahooChartPrice(symbol, function (err, result) {
    if (err) {
      fetchStockPriceFromYahooJapan(symbol, callback);
      return;
    }
    callback(null, result);
  });
}

function fetchGoldPrice(callback) {
  fetchYahooChartPrice('GC=F', function (goldErr, goldResult) {
    if (goldErr) {
      callback(goldErr);
      return;
    }

    fetchUsdJpyRate(function (fxErr, fxResult) {
      if (fxErr) {
        callback(fxErr);
        return;
      }

      var pricePerGramJpy = calculateGoldPricePerGramJpy(goldResult.price, fxResult.rate);
      if (!isFinite(pricePerGramJpy)) {
        callback(new Error('Gold JPY price not found'));
        return;
      }
      callback(null, {
        price: Math.round(pricePerGramJpy * 100) / 100,
        priceDate: goldResult.priceDate || fxResult.priceDate || new Date().toISOString().slice(0, 10)
      });
    });
  });
}

function calculateGoldPricePerGramJpy(goldUsdPerTroyOunce, usdJpyRate) {
  if (typeof goldUsdPerTroyOunce != 'number' || !isFinite(goldUsdPerTroyOunce) ||
    typeof usdJpyRate != 'number' || !isFinite(usdJpyRate)) {
    return null;
  }
  return Math.round((goldUsdPerTroyOunce * usdJpyRate / 31.1034768) * 100) / 100;
}

function fetchUsdJpyRate(callback) {
  fetchYahooChartPrice('JPY=X', function (err, result) {
    if (err) {
      callback(err);
      return;
    }

    callback(null, {
      pair: 'USDJPY',
      rate: result.price,
      rateDate: result.priceDate,
      fetchedAt: new Date(),
      status: 'OK',
      error: ''
    });
  });
}

function fetchUsdJpyDailyRates(range, callback) {
  fetchYahooChartDailyRates('JPY=X', 'USDJPY', range, callback);
}

function parseStockPriceFromHtml(html, symbol) {
  var text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

  var code = symbol.replace(/\.T$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var match = text.match(new RegExp(code + '[\\s\\S]{0,500}?([0-9][0-9,]*(?:\\.[0-9]+)?)\\s+前日比'));
  if (!match) {
    match = text.match(/東証[\s\S]{0,500}?([0-9][0-9,]*(?:\.[0-9]+)?)\s+前日比/);
  }
  if (!match) {
    return null;
  }

  var price = Number(match[1].replace(/,/g, ''));
  return isFinite(price) ? price : null;
}

function fetchStockPriceFromYahooJapan(symbol, callback) {
  var url = 'https://finance.yahoo.co.jp/quote/' + encodeURIComponent(symbol);
  fetchText(url, function (err, html) {
    if (err) {
      callback(err);
      return;
    }

    var price = parseStockPriceFromHtml(html, symbol);
    if (!isFinite(price)) {
      callback(new Error('Stock price not found'));
      return;
    }

    callback(null, {
      price: price,
      priceDate: new Date().toISOString().slice(0, 10)
    });
  });
}

function parseFundPriceFromHtml(html, sourceUrl) {
  var text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

  var codeMatch = sourceUrl.match(/quote\/([^/?#]+)/);
  var match = null;
  if (codeMatch) {
    var code = codeMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    match = text.match(new RegExp(code + '[\\s\\S]{0,500}?([0-9][0-9,]*(?:\\.[0-9]+)?)\\s+前日比'));
  }

  if (!match) {
    match = text.match(/投資信託[\s\S]{0,500}?([0-9][0-9,]*(?:\.[0-9]+)?)\s+前日比/);
  }
  if (!match) {
    match = text.match(/基準価額[\s\S]{0,200}?([0-9][0-9,]*(?:\.[0-9]+)?)/);
  }
  if (!match) {
    return null;
  }

  var pricePer10000 = Number(match[1].replace(/,/g, ''));
  if (!isFinite(pricePer10000)) {
    return null;
  }

  return pricePer10000 / 10000;
}

module.exports = {
  parseSbiCsv: parseSbiCsv,
  parseFxCsv: parseFxCsv,
  parseGoldCsv: parseGoldCsv,
  buildCombinedSummaryTotals: buildCombinedSummaryTotals,
  calculateGoldPricePerGramJpy: calculateGoldPricePerGramJpy,
  findLatestBuyDatesBySymbol: findLatestBuyDatesBySymbol,
  parseYahooChartDailyRates: parseYahooChartDailyRates,
  parseYahooChartDailyPriceHistory: parseYahooChartDailyPriceHistory,
  parseFundPriceFromHtml: parseFundPriceFromHtml,
  parseStockPriceFromHtml: parseStockPriceFromHtml
};

function fetchFundPrice(asset, callback) {
  if (!asset.priceSourceUrl) {
    callback(new Error('Mapping required'));
    return;
  }

  fetchText(asset.priceSourceUrl, function (err, html) {
    if (err) {
      callback(err);
      return;
    }

    var price = parseFundPriceFromHtml(html, asset.priceSourceUrl);
    if (!isFinite(price)) {
      callback(new Error('Fund price not found'));
      return;
    }

    callback(null, {
      price: price,
      priceDate: new Date().toISOString().slice(0, 10)
    });
  });
}

function refreshAssetPrice(db, asset, options, callback) {
  if (typeof options == 'function') {
    callback = options;
    options = {};
  }
  options = options || {};

  var isStock = asset.assetType == 'STOCK' || asset.assetType == 'US_STOCK';
  var isGold = asset.assetType == 'GOLD';
  var fetcher = isGold ? fetchGoldPrice : isStock ? fetchStockPrice : fetchFundPrice;
  var fetchArg = isGold ? null : isStock ? asset.symbol : asset;
  var done = function (err, result) {
    var update;

    if (err) {
      update = {
        $set: {
          latestPriceFetchedAt: new Date(),
          priceFetchStatus: err.message == 'Mapping required' ? 'MAPPING_REQUIRED' : 'ERROR',
          priceFetchError: err.message
        }
      };
    } else {
      update = {
        $set: {
          latestPrice: result.price,
          latestPriceDate: result.priceDate,
          latestPriceFetchedAt: new Date(),
          priceFetchStatus: 'OK',
          priceFetchError: ''
        }
      };
      if (asset.assetType == 'US_STOCK' && options.usdJpyRate && isFinite(options.usdJpyRate.rate)) {
        update.$set.latestFxRate = options.usdJpyRate.rate;
        update.$set.latestFxRatePair = options.usdJpyRate.pair;
        update.$set.latestFxRateDate = options.usdJpyRate.rateDate;
      }
    }

    db.collection('assets').updateOne({ symbol: asset.symbol }, update, function (updateErr) {
      callback(updateErr, err ? { ok: false, symbol: asset.symbol, error: err.message } : { ok: true, symbol: asset.symbol });
    });
  };

  if (isGold) {
    fetcher(done);
  } else {
    fetcher(fetchArg, done);
  }
}

function refreshAssetPrices(db, assets, callback) {
  var results = [];
  var delayMs = 800;

  if (assets.length === 0) {
    callback(null, results);
    return;
  }

  var hasUsStock = assets.some(function (asset) {
    return asset.assetType == 'US_STOCK';
  });

  function refreshAll(usdJpyRate) {
    var index = 0;

    function next() {
      if (index >= assets.length) {
        callback(null, results);
        return;
      }

      var asset = assets[index];
      index++;

      refreshAssetPrice(db, asset, { usdJpyRate: usdJpyRate }, function (err, result) {
        if (err) {
          results.push({ ok: false, symbol: asset.symbol, error: err.message });
        } else {
          results.push(result);
        }

        if (result && result.error == 'HTTP 429') {
          callback(null, results.concat([{ ok: false, symbol: '*', error: 'Rate limited; stopped remaining price refreshes' }]));
          return;
        }

        refreshAssetPriceHistory(db, asset, function (historyErr, historyResult) {
          if (historyErr) {
            results.push({ ok: false, symbol: asset.symbol, error: historyErr.message });
          } else if (historyResult && !historyResult.skipped) {
            results.push(Object.assign({ type: 'PRICE_HISTORY' }, historyResult));
          }

          if (historyResult && historyResult.stop) {
            callback(null, results.concat([{ ok: false, symbol: '*', error: 'Rate limited; stopped remaining history refreshes' }]));
            return;
          }

          setTimeout(next, delayMs);
        });
      });
    }

    next();
  }

  if (hasUsStock) {
    getLatestFxRate(db, 'USDJPY', function (rateErr, usdJpyRate) {
      if (rateErr) {
        callback(rateErr);
        return;
      }
      refreshAll(usdJpyRate);
    });
  } else {
    refreshAll(null);
  }
}

const findTransactions = function (db, page, pageSize, callback) {
  const collection = db.collection('transactions');
  var skip = (page - 1) * pageSize;

  collection.countDocuments(function (countErr, total) {
    if (countErr) {
      callback(countErr);
      return;
    }

    collection.find().sort({ tradeDateTime: -1, symbol: 1 }).skip(skip).limit(pageSize).toArray(function (err, docs) {
      callback(err, docs, total);
    });
  });
}

const findAllTransactions = function (db, callback) {
  const collection = db.collection('transactions');
  collection.find().sort({ tradeDateTime: 1, symbol: 1 }).toArray(function (err, docs) {
    callback(err, docs);
  });
}

app.get('/', function (req, res) {
  res.redirect('/summary');
});

app.get('/import', function (req, res) {
  res.render('import.ejs', { result: null, error: null });
});

app.post('/import/sbi', function (req, res) {
  var form = new formidable.IncomingForm();
  form.parse(req, function (err, fields, files) {
    if (err) {
      res.status(400).render('import.ejs', { result: null, error: err.message });
      return;
    }

    var file = files.csv;
    if (Array.isArray(file)) {
      file = file[0];
    }

    if (!file) {
      res.status(400).render('import.ejs', { result: null, error: 'CSV file is required.' });
      return;
    }

    var uploadPath = file.filepath || file.path;
    var sourceFile = file.originalFilename || file.name || 'sbi.csv';

    fs.readFile(uploadPath, function (readErr, buffer) {
      if (readErr) {
        res.status(400).render('import.ejs', { result: null, error: readErr.message });
        return;
      }

      var docs;
      try {
        docs = parseSbiCsv(buffer, sourceFile);
      } catch (parseErr) {
        res.status(400).render('import.ejs', { result: null, error: parseErr.message });
        return;
      }

      withDb(function (dbErr, db, close) {
        if (dbErr) {
          res.status(500).render('import.ejs', { result: null, error: dbErr.message });
          return;
        }

        importTransactions(db, docs, function (importErr, result) {
          close();
          if (importErr) {
            res.status(500).render('import.ejs', { result: null, error: importErr.message });
            return;
          }

          result.label = 'SBI CSV';
          result.link = '/transactions';
          result.linkText = 'View imported transactions';
          res.render('import.ejs', { result: result, error: null });
        });
      });
    });
  });
});

app.post('/import/fx', function (req, res) {
  var form = new formidable.IncomingForm();
  form.parse(req, function (err, fields, files) {
    if (err) {
      res.status(400).render('import.ejs', { result: null, error: err.message });
      return;
    }

    var file = files.csv;
    if (Array.isArray(file)) {
      file = file[0];
    }

    if (!file) {
      res.status(400).render('import.ejs', { result: null, error: 'CSV file is required.' });
      return;
    }

    var uploadPath = file.filepath || file.path;
    var sourceFile = file.originalFilename || file.name || 'fx.csv';

    fs.readFile(uploadPath, function (readErr, buffer) {
      if (readErr) {
        res.status(400).render('import.ejs', { result: null, error: readErr.message });
        return;
      }

      var docs;
      try {
        docs = parseFxCsv(buffer, sourceFile);
      } catch (parseErr) {
        res.status(400).render('import.ejs', { result: null, error: parseErr.message });
        return;
      }

      withDb(function (dbErr, db, close) {
        if (dbErr) {
          res.status(500).render('import.ejs', { result: null, error: dbErr.message });
          return;
        }

        importFxTrades(db, docs, function (importErr, result) {
          close();
          if (importErr) {
            res.status(500).render('import.ejs', { result: null, error: importErr.message });
            return;
          }

          result.label = 'FX CSV';
          result.link = '/summary';
          result.linkText = 'View portfolio summary';
          res.render('import.ejs', { result: result, error: null });
        });
      });
    });
  });
});

app.post('/import/gold', function (req, res) {
  var form = new formidable.IncomingForm();
  form.parse(req, function (err, fields, files) {
    if (err) {
      res.status(400).render('import.ejs', { result: null, error: err.message });
      return;
    }

    var file = files.csv;
    if (Array.isArray(file)) {
      file = file[0];
    }

    if (!file) {
      res.status(400).render('import.ejs', { result: null, error: 'CSV file is required.' });
      return;
    }

    var uploadPath = file.filepath || file.path;
    var sourceFile = file.originalFilename || file.name || 'gold.csv';

    fs.readFile(uploadPath, function (readErr, buffer) {
      if (readErr) {
        res.status(400).render('import.ejs', { result: null, error: readErr.message });
        return;
      }

      var holding;
      try {
        holding = parseGoldCsv(buffer, sourceFile);
      } catch (parseErr) {
        res.status(400).render('import.ejs', { result: null, error: parseErr.message });
        return;
      }

      withDb(function (dbErr, db, close) {
        if (dbErr) {
          res.status(500).render('import.ejs', { result: null, error: dbErr.message });
          return;
        }

        importGoldHolding(db, holding, function (importErr, result) {
          close();
          if (importErr) {
            res.status(500).render('import.ejs', { result: null, error: importErr.message });
            return;
          }

          result.label = 'Gold CSV';
          result.link = '/summary';
          result.linkText = 'View portfolio summary';
          result.extra = 'Gold grams: ' + holding.grams + ', buy amount JPY: ' + holding.buyAmount;
          res.render('import.ejs', { result: result, error: null });
        });
      });
    });
  });
});

app.post('/fx/import-sample', function (req, res) {
  var samplePath = path.join(__dirname, 'samples', 'kessai20260610.csv');
  fs.readFile(samplePath, function (readErr, buffer) {
    if (readErr) {
      res.status(400).send(readErr.message);
      return;
    }

    var docs;
    try {
      docs = parseFxCsv(buffer, 'kessai20260610.csv');
    } catch (parseErr) {
      res.status(400).send(parseErr.message);
      return;
    }

    withDb(function (dbErr, db, close) {
      if (dbErr) {
        res.status(500).send(dbErr.message);
        return;
      }

      importFxTrades(db, docs, function (importErr, result) {
        close();
        if (importErr) {
          res.status(500).send(importErr.message);
          return;
        }

        res.redirect('/summary?message=' + encodeURIComponent('FX import finished. Imported rows: ' + result.total));
      });
    });
  });
});

app.get('/transactions', function (req, res) {
  var pageSize = 30;
  var page = parseInt(req.query.page, 10);
  if (isNaN(page) || page < 1) {
    page = 1;
  }

  withDb(function (err, db, close) {
    if (err) {
      res.status(500).send(err.message);
      return;
    }

    findTransactions(db, page, pageSize, function (findErr, docs, total) {
      close();
      if (findErr) {
        res.status(500).send(findErr.message);
        return;
      }

      var totalPages = Math.max(1, Math.ceil(total / pageSize));
      if (page > totalPages) {
        res.redirect('/transactions?page=' + totalPages);
        return;
      }

      res.render('transactions.ejs', {
        listitem: docs,
        pagination: {
          page: page,
          pageSize: pageSize,
          total: total,
          totalPages: totalPages,
          hasPrevious: page > 1,
          hasNext: page < totalPages,
          previousPage: page - 1,
          nextPage: page + 1,
          start: total === 0 ? 0 : (page - 1) * pageSize + 1,
          end: Math.min(page * pageSize, total)
        }
      });
    });
  });
});

app.get('/trade-chart', function (req, res) {
  withDb(function (err, db, close) {
    if (err) {
      res.status(500).send(err.message);
      return;
    }

    findAllTransactions(db, function (findErr, docs) {
      if (findErr) {
        close();
        res.status(500).send(findErr.message);
        return;
      }

      var assets = buildTradeChartData(docs);
      var symbols = assets.map(function (asset) { return asset.symbol; });

      if (symbols.length === 0) {
        close();
        res.render('trade-chart.ejs', {
          assets: assets,
          chartDataJson: JSON.stringify(assets).replace(/</g, '\\u003c')
        });
        return;
      }

      db.collection('priceHistory').find({ symbol: { $in: symbols } }).toArray(function (historyErr, historyRows) {
        close();
        if (historyErr) {
          res.status(500).send(historyErr.message);
          return;
        }

        attachPriceHistoryToTradeChartData(assets, historyRows);
        res.render('trade-chart.ejs', {
          assets: assets,
          chartDataJson: JSON.stringify(assets).replace(/</g, '\\u003c')
        });
      });
    });
  });
});

app.get('/summary', function (req, res) {
  withDb(function (err, db, close) {
    if (err) {
      res.status(500).send(err.message);
      return;
    }

    findAllTransactions(db, function (findErr, transactionDocs) {
      if (findErr) {
        close();
        res.status(500).send(findErr.message);
        return;
      }

      findGoldHolding(db, function (goldErr, goldHolding) {
        if (goldErr) {
          close();
          res.status(500).send(goldErr.message);
          return;
        }

        var docs = addGoldTransaction(transactionDocs, goldHolding);
        var summaryRows = buildPortfolioSummary(docs);
        syncAssetsFromSummary(db, summaryRows, function (syncErr) {
          if (syncErr) {
            close();
            res.status(500).send(syncErr.message);
            return;
          }

          findAssetsBySymbols(db, summaryRows.map(function (row) { return row.symbol; }), function (assetErr, assetsBySymbol) {
            if (assetErr) {
              close();
              res.status(500).send(assetErr.message);
              return;
            }

            var report = buildPortfolioSummaryReport(docs, assetsBySymbol);
            findAllFxTrades(db, function (fxErr, fxTrades) {
              close();
              if (fxErr) {
                res.status(500).send(fxErr.message);
                return;
              }

              var fxSummary = buildFxSummary(fxTrades);
              res.render('summary.ejs', {
                listitem: report.rows,
                totals: report.totals,
                fxSummary: fxSummary,
                combinedTotals: buildCombinedSummaryTotals(report.totals, fxSummary.totals),
                goldHolding: goldHolding,
                message: req.query.message || ''
              });
            });
          });
        });
      });
    });
  });
});

app.post('/gold', function (req, res) {
  var grams = parseNumber(req.body.grams);
  var buyAmount = parseNumber(req.body.buyAmount);

  if (!isFinite(grams) || grams < 0 || !isFinite(buyAmount) || buyAmount < 0) {
    res.redirect('/summary?message=' + encodeURIComponent('Gold grams and buy amount must be zero or positive numbers'));
    return;
  }

  withDb(function (err, db, close) {
    if (err) {
      res.status(500).send(err.message);
      return;
    }

    db.collection('goldHoldings').updateOne(
      { _id: 'gold' },
      {
        $set: {
          grams: grams,
          buyAmount: buyAmount,
          updatedAt: new Date()
        }
      },
      { upsert: true },
      function (updateErr) {
        close();
        if (updateErr) {
          res.status(500).send(updateErr.message);
          return;
        }

        res.redirect('/summary?message=' + encodeURIComponent('Saved gold holding'));
      }
    );
  });
});

app.post('/assets/mapping', function (req, res) {
  var symbol = cleanCsvValue(req.body.symbol);
  var sourceUrl = normalizeSourceUrl(req.body.priceSourceUrl);

  if (!symbol) {
    res.redirect('/summary?message=' + encodeURIComponent('Missing asset symbol'));
    return;
  }

  withDb(function (err, db, close) {
    if (err) {
      res.status(500).send(err.message);
      return;
    }

    db.collection('assets').updateOne(
      { symbol: symbol },
      {
        $set: {
          priceSource: sourceUrl ? 'MAPPED_URL' : '',
          priceSourceUrl: sourceUrl,
          priceFetchStatus: sourceUrl ? 'MAPPED' : '',
          priceFetchError: ''
        }
      },
      { upsert: true },
      function (updateErr) {
        close();
        if (updateErr) {
          res.status(500).send(updateErr.message);
          return;
        }

        res.redirect('/summary?message=' + encodeURIComponent('Saved price mapping'));
      }
    );
  });
});

app.post('/prices/refresh', function (req, res) {
  withDb(function (err, db, close) {
    if (err) {
      res.status(500).send(err.message);
      return;
    }

    findAllTransactions(db, function (findErr, transactionDocs) {
      if (findErr) {
        close();
        res.status(500).send(findErr.message);
        return;
      }

      findGoldHolding(db, function (goldErr, goldHolding) {
        if (goldErr) {
          close();
          res.status(500).send(goldErr.message);
          return;
        }

        var docs = addGoldTransaction(transactionDocs, goldHolding);
        var summaryRows = buildPortfolioSummary(docs);
        syncAssetsFromSummary(db, summaryRows, function (syncErr) {
          if (syncErr) {
            close();
            res.status(500).send(syncErr.message);
            return;
          }

          findAssetsBySymbols(db, summaryRows.map(function (row) { return row.symbol; }), function (assetErr, assetsBySymbol) {
            if (assetErr) {
              close();
              res.status(500).send(assetErr.message);
              return;
            }

            var activeSymbols = {};
            summaryRows.forEach(function (row) {
              if (isFinite(row.netQty) && Math.abs(row.netQty) > 0.0000001) {
                activeSymbols[row.symbol] = true;
              }
            });
            var latestBuyDatesBySymbol = findLatestBuyDatesBySymbol(docs);

            var assets = Object.keys(assetsBySymbol)
              .filter(function (symbol) { return activeSymbols[symbol]; })
              .map(function (symbol) {
                return Object.assign({}, assetsBySymbol[symbol], {
                  priceHistoryStartDate: latestBuyDatesBySymbol[symbol] || ''
                });
              });

            refreshAssetPrices(db, assets, function (refreshErr, results) {
              close();
              if (refreshErr) {
                res.status(500).send(refreshErr.message);
                return;
              }

              var ok = results.filter(function (result) { return result.ok; }).length;
              var failed = results.length - ok;
              res.redirect('/summary?message=' + encodeURIComponent('Price refresh finished. OK: ' + ok + ', Failed/skipped: ' + failed));
            });
          });
        });
      });
    });
  });
});

var https = require('https');

if (require.main === module) {
  app.listen(PORT, function () {
    console.log('Server is running on PORT:', PORT);
  });
}
