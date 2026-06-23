var express = require('express');
var formidable = require('formidable');
var fs = require('fs');
var path = require('path')
var crypto = require('crypto');
var TextDecoder = require('util').TextDecoder;
var buildPortfolioSummary = require('./lib/portfolioSummary').buildPortfolioSummary;
var buildPortfolioSummaryReport = require('./lib/portfolioSummary').buildPortfolioSummaryReport;
var buildCombinedSummaryHistory = require('./lib/combinedSummaryHistory').buildCombinedSummaryHistory;
var buildTradeChartData = require('./lib/tradeChart').buildTradeChartData;
var attachPriceHistoryToTradeChartData = require('./lib/tradeChart').attachPriceHistoryToTradeChartData;
var sortTradeChartAssetsBySummaryRows = require('./lib/tradeChart').sortTradeChartAssetsBySummaryRows;
var withDb = require('./lib/db').withDb;
var buildDailyReportSnapshot = require('./lib/dailyReport').buildDailyReportSnapshot;
var generateDailyReport = require('./lib/openaiReport').generateDailyReport;
var buildChatGptReportPrompt = require('./lib/openaiReport').buildChatGptReportPrompt;
var buildChineseChatGptReportPrompt = require('./lib/openaiReport').buildChineseChatGptReportPrompt;
var buildJapaneseChatGptReportPrompt = require('./lib/openaiReport').buildJapaneseChatGptReportPrompt;
var app = express();

var PORT = 80;
var AUTH_COOKIE_NAME = 'sbi_auth';
var AUTH_PASSWORD = process.env.SBI_AUTH_PASSWORD || 'admin';
var JWT_SECRET = process.env.SBI_JWT_SECRET || crypto.createHash('sha256').update('local-dev-secret:' + AUTH_PASSWORD).digest('hex');
var JWT_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
var priceRefreshJob = {
  status: 'IDLE',
  startedAt: '',
  finishedAt: '',
  ok: 0,
  failed: 0,
  error: ''
};
app.set('view engine', 'ejs');
app.use(express.static('public'));
const bodyParser = require('body-parser')

app.use(
  bodyParser.urlencoded({
    extended: true
  })
)

app.use(bodyParser.json())

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(value) {
  value = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (value.length % 4) {
    value += '=';
  }
  return Buffer.from(value, 'base64').toString('utf8');
}

function signJwt(payload, secret) {
  var header = { alg: 'HS256', typ: 'JWT' };
  var encodedHeader = base64UrlEncode(JSON.stringify(header));
  var encodedPayload = base64UrlEncode(JSON.stringify(payload));
  var body = encodedHeader + '.' + encodedPayload;
  var signature = crypto.createHmac('sha256', secret).update(body).digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return body + '.' + signature;
}

function verifyJwt(token, secret) {
  var parts = String(token || '').split('.');
  if (parts.length != 3) {
    return null;
  }

  var body = parts[0] + '.' + parts[1];
  var expected = crypto.createHmac('sha256', secret).update(body).digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  var actual = parts[2];
  var expectedBuffer = Buffer.from(expected);
  var actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length != actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  try {
    var payload = JSON.parse(base64UrlDecode(parts[1]));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null;
    }
    return payload;
  } catch (err) {
    return null;
  }
}

function parseCookies(cookieHeader) {
  var cookies = {};
  String(cookieHeader || '').split(';').forEach(function (part) {
    var index = part.indexOf('=');
    if (index < 0) {
      return;
    }
    var name = part.slice(0, index).trim();
    var value = part.slice(index + 1).trim();
    if (name) {
      cookies[name] = decodeURIComponent(value);
    }
  });
  return cookies;
}

function makeAuthToken() {
  var now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub: 'sbi-local-user',
    iat: now,
    exp: now + JWT_MAX_AGE_SECONDS
  }, JWT_SECRET);
}

function normalizeNextPath(value) {
  value = String(value || '/summary');
  if (value.charAt(0) != '/' || value.indexOf('//') === 0) {
    return '/summary';
  }
  return value;
}

function isAuthenticated(req) {
  var cookies = parseCookies(req.headers.cookie);
  return !!verifyJwt(cookies[AUTH_COOKIE_NAME], JWT_SECRET);
}

function authMiddleware(req, res, next) {
  if (req.path == '/login' || req.path == '/logout') {
    next();
    return;
  }

  if (isAuthenticated(req)) {
    next();
    return;
  }

  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || '/summary'));
}

app.get('/login', function (req, res) {
  var nextPath = normalizeNextPath(req.query.next);
  if (isAuthenticated(req)) {
    res.redirect(nextPath);
    return;
  }

  res.render('login.ejs', {
    error: req.query.error || '',
    next: nextPath
  });
});

app.post('/login', function (req, res) {
  var password = cleanCsvValue(req.body.password);
  var nextPath = normalizeNextPath(req.body.next);
  var expected = Buffer.from(AUTH_PASSWORD);
  var actual = Buffer.from(password);
  var ok = expected.length == actual.length && crypto.timingSafeEqual(expected, actual);
  if (!ok) {
    res.redirect('/login?error=' + encodeURIComponent('Invalid password') + '&next=' + encodeURIComponent(nextPath));
    return;
  }

  var secure = req.secure || req.headers['x-forwarded-proto'] == 'https';
  var cookie = AUTH_COOKIE_NAME + '=' + encodeURIComponent(makeAuthToken()) +
    '; Max-Age=' + JWT_MAX_AGE_SECONDS +
    '; Path=/' +
    '; HttpOnly' +
    '; SameSite=Lax' +
    (secure ? '; Secure' : '');
  res.setHeader('Set-Cookie', cookie);
  res.redirect(nextPath);
});

app.post('/logout', function (req, res) {
  res.setHeader('Set-Cookie', AUTH_COOKIE_NAME + '=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
  res.redirect('/login');
});

app.use(authMiddleware);

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

function isNumber(value) {
  return typeof value == 'number' && !isNaN(value);
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

function normalizeDateTime(value) {
  value = normalizeDate(value);
  if (!value) {
    return '';
  }

  return value.replace(' ', 'T');
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
  var docs = [];
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
    if (side != 'BUY' && side != 'SELL') {
      continue;
    }

    var tradeDateTime = normalizeDateTime(raw['約定日時'] || raw['注文日時']);
    var tradeDate = tradeDateTime.slice(0, 10);
    var sourceHash = crypto.createHash('sha1')
      .update([
        raw['受付番号'],
        raw['約定日時'],
        raw['取引種別'],
        raw['約定数量'],
        raw['約定金額']
      ].join('|'))
      .digest('hex');
    var settlementAmount = side == 'BUY' ? amount + fee : Math.max(0, amount - fee);
    var price = parseNumber(raw['約定価格/g'] || raw['注文価格/g']);

    if (side == 'BUY') {
      grams += quantity;
      buyAmount += amount + fee;
    } else {
      grams -= quantity;
      buyAmount -= settlementAmount;
    }

    rows.push(raw);
    docs.push({
      source: 'SBI_GOLD',
      sourceHash: sourceHash,
      sourceFile: sourceFile,
      importedAt: importedAt,
      raw: raw,
      tradeDate: tradeDate,
      tradeTime: tradeDateTime.indexOf('T') >= 0 ? tradeDateTime.split('T')[1] : '',
      tradeDateTime: tradeDateTime,
      settlementDate: normalizeDate(raw['受渡日']),
      assetName: 'Gold',
      assetType: 'GOLD',
      code: '',
      market: '',
      symbol: 'GOLD_JPY',
      productCategory: '金',
      orderType: raw['取引種別'],
      side: side,
      action: raw['取引種別'],
      account: '',
      taxCategory: '',
      quantity: quantity,
      price: isFinite(price) ? price : amount / quantity,
      unitPrice: isFinite(price) ? price : amount / quantity,
      priceUnit: 'PER_GRAM',
      currency: 'JPY',
      settlementCurrency: 'JPY',
      fee: fee,
      tax: 0,
      settlementAmount: settlementAmount
    });
  }

  return {
    _id: 'gold',
    source: 'SBI_GOLD',
    sourceFile: sourceFile,
    importedAt: importedAt,
    grams: Math.round(grams * 10000) / 10000,
    buyAmount: Math.round(buyAmount),
    rowCount: rows.length,
    rawRows: rows,
    transactions: docs
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
  var portfolioDayPl = portfolioTotals.dayPl || 0;
  var fxTotalPl = fxTotals.totalPl || 0;

  return {
    portfolioMarketValue: portfolioMarketValue,
    portfolioUnrealizedPl: portfolioUnrealizedPl,
    portfolioRealizedPl: portfolioRealizedPl,
    portfolioTotalPl: portfolioTotalPl,
    portfolioDayPl: portfolioDayPl,
    fxTotalPl: fxTotalPl,
    combinedRealizedPl: portfolioRealizedPl + fxTotalPl,
    combinedTotalPl: portfolioTotalPl + fxTotalPl
  };
}

function mapPriceHistoryBySymbol(rows) {
  var grouped = {};
  rows.forEach(function (row) {
    if (isLegacyFundLatestSnapshotRow(row)) {
      return;
    }
    if (!grouped[row.symbol]) {
      grouped[row.symbol] = [];
    }
    grouped[row.symbol].push(row);
  });
  return grouped;
}

function isLegacyFundLatestSnapshotRow(row) {
  return row && row.assetType == 'FUND' && row.source == 'YAHOO_FUND_HISTORY' &&
    !Object.prototype.hasOwnProperty.call(row, 'netAssetsBalance');
}

function findGoldHolding(db, callback) {
  db.collection('goldHoldings').findOne({ _id: 'gold' }, function (err, doc) {
    callback(err, doc || { _id: 'gold', grams: 0, buyAmount: 0 });
  });
}

function getGoldHoldingStartDate(goldHolding) {
  var dates = [];
  (goldHolding.rawRows || []).forEach(function (row) {
    var date = normalizeDate(row['約定日時'] || row['注文日時'] || row['受渡日']).slice(0, 10);
    if (isValidDateText(date)) {
      dates.push(date);
    }
  });

  var importedDate = normalizeDate(goldHolding.importedAt).slice(0, 10);
  if (isValidDateText(importedDate)) {
    dates.push(importedDate);
  }

  dates.sort();
  return dates[0] || '';
}

function makeGoldTransaction(goldHolding) {
  if (!goldHolding || !isFinite(goldHolding.grams) || goldHolding.grams <= 0) {
    return null;
  }

  var buyAmount = isFinite(goldHolding.buyAmount) ? goldHolding.buyAmount : 0;
  var tradeDate = getGoldHoldingStartDate(goldHolding);
  return {
    source: 'MANUAL',
    sourceFile: '',
    sourceHash: 'manual-gold',
    tradeDate: tradeDate,
    tradeTime: '09:00:00',
    tradeDateTime: tradeDate ? tradeDate + 'T09:00:00' : '',
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
  var hasDetailedGold = transactions.some(function (tx) {
    return tx.assetType == 'GOLD' && tx.source == 'SBI_GOLD';
  });
  if (hasDetailedGold) {
    return transactions;
  }

  var goldTransaction = makeGoldTransaction(goldHolding);
  if (goldTransaction) {
    return transactions.concat([goldTransaction]);
  }
  return transactions;
}

function getHistoryBuyDate(tx) {
  var date = normalizeDate(tx.tradeDate || tx.tradeDateTime).slice(0, 10);
  if (!isValidDateText(date)) {
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

function findOldestBuyDatesBySymbol(transactions) {
  var oldestBySymbol = {};

  transactions.forEach(function (tx) {
    if (tx.side != 'BUY' || (tx.assetType != 'STOCK' && tx.assetType != 'US_STOCK' && tx.assetType != 'FUND' && tx.assetType != 'GOLD')) {
      return;
    }

    var symbol = tx.symbol || tx.code;
    var date = getHistoryBuyDate(tx);
    if (!symbol || !date) {
      return;
    }

    if (!oldestBySymbol[symbol] || date < oldestBySymbol[symbol]) {
      oldestBySymbol[symbol] = date;
    }
  });

  return oldestBySymbol;
}

function findActiveQuantitySymbols(transactions) {
  var qtyBySymbol = {};

  transactions.forEach(function (tx) {
    if (tx.side != 'BUY' && tx.side != 'SELL') {
      return;
    }
    if (['STOCK', 'US_STOCK', 'FUND', 'GOLD'].indexOf(tx.assetType) < 0) {
      return;
    }
    if (!isFinite(tx.quantity) || tx.quantity <= 0) {
      return;
    }

    var symbol = tx.symbol || tx.code || tx.assetName;
    if (!symbol) {
      return;
    }

    if (!qtyBySymbol[symbol]) {
      qtyBySymbol[symbol] = 0;
    }
    qtyBySymbol[symbol] += tx.side == 'BUY' ? tx.quantity : -tx.quantity;
  });

  var activeSymbols = {};
  Object.keys(qtyBySymbol).forEach(function (symbol) {
    if (Math.abs(qtyBySymbol[symbol]) > 0.0000001) {
      activeSymbols[symbol] = true;
    }
  });
  return activeSymbols;
}

function compareTransactionDates(a, b) {
  var aDateTime = a.tradeDateTime || a.tradeDate || '';
  var bDateTime = b.tradeDateTime || b.tradeDate || '';
  if (aDateTime < bDateTime) {
    return -1;
  }
  if (aDateTime > bDateTime) {
    return 1;
  }
  return 0;
}

function findRemainingLotStartDatesBySymbol(transactions) {
  var lotsBySymbol = {};

  transactions.slice().sort(compareTransactionDates).forEach(function (tx) {
    if (tx.assetType != 'STOCK' && tx.assetType != 'US_STOCK') {
      return;
    }
    if (tx.side != 'BUY' && tx.side != 'SELL') {
      return;
    }
    if (!isFinite(tx.quantity) || tx.quantity <= 0) {
      return;
    }

    var symbol = tx.symbol || tx.code;
    if (!symbol) {
      return;
    }
    if (!lotsBySymbol[symbol]) {
      lotsBySymbol[symbol] = [];
    }

    if (tx.side == 'BUY') {
      var buyDate = getHistoryBuyDate(tx);
      if (buyDate) {
        lotsBySymbol[symbol].push({
          date: buyDate,
          remainingQty: tx.quantity
        });
      }
      return;
    }

    var sellQty = tx.quantity;
    while (sellQty > 0.0000001 && lotsBySymbol[symbol].length > 0) {
      var lot = lotsBySymbol[symbol][0];
      var consumed = Math.min(sellQty, lot.remainingQty);
      lot.remainingQty -= consumed;
      sellQty -= consumed;
      if (lot.remainingQty <= 0.0000001) {
        lotsBySymbol[symbol].shift();
      }
    }
  });

  var startDatesBySymbol = {};
  Object.keys(lotsBySymbol).forEach(function (symbol) {
    var dates = lotsBySymbol[symbol]
      .filter(function (lot) { return lot.remainingQty > 0.0000001 && lot.date; })
      .map(function (lot) { return lot.date; })
      .sort();
    if (dates.length > 0) {
      startDatesBySymbol[symbol] = dates[0];
    }
  });

  return startDatesBySymbol;
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
  fetchTextWithHeaders(url, { 'User-Agent': 'Mozilla/5.0 iriyano-price-fetcher' }, callback);
}

function fetchTextWithHeaders(url, headers, callback) {
  https.get(url, {
    headers: headers || {}
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
    if (!isNumber(close)) {
      continue;
    }

    var rateDate = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    rates.push({
      pair: pair,
      rateDate: rateDate,
      rateType: 'DAILY_CLOSE',
      rate: Number(close),
      open: isNumber(quote.open && quote.open[i]) ? Number(quote.open[i]) : null,
      high: isNumber(quote.high && quote.high[i]) ? Number(quote.high[i]) : null,
      low: isNumber(quote.low && quote.low[i]) ? Number(quote.low[i]) : null,
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
    if (!isNumber(close)) {
      continue;
    }

    rows.push({
      symbol: asset.symbol,
      assetType: asset.assetType,
      priceDate: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      currency: asset.assetType == 'US_STOCK' ? 'USD' : 'JPY',
      open: isNumber(quote.open && quote.open[i]) ? Number(quote.open[i]) : null,
      high: isNumber(quote.high && quote.high[i]) ? Number(quote.high[i]) : null,
      low: isNumber(quote.low && quote.low[i]) ? Number(quote.low[i]) : null,
      close: Number(close),
      volume: isNumber(quote.volume && quote.volume[i]) ? Number(quote.volume[i]) : null,
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
      var rows = parseYahooChartDailyPriceHistory(JSON.parse(data), asset).filter(function (row) {
        return row.priceDate >= startDate && row.priceDate <= endDate;
      });
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

function buildGoldPriceHistoryRows(goldRows, fxRows, asset) {
  var fxByDate = {};
  var fxDates = [];
  fxRows.forEach(function (row) {
    if (row.priceDate && isFinite(row.close)) {
      fxByDate[row.priceDate] = row;
      fxDates.push(row.priceDate);
    }
  });
  fxDates.sort();

  return goldRows.map(function (goldRow) {
    var fxRow = findFxRowForGoldDate(fxByDate, fxDates, goldRow.priceDate);
    if (!isFinite(goldRow.close)) {
      return null;
    }
    if (!fxRow || !isFinite(fxRow.close)) {
      return {
        symbol: asset.symbol,
        assetType: asset.assetType,
        priceDate: goldRow.priceDate,
        currency: 'JPY',
        open: null,
        high: null,
        low: null,
        close: null,
        volume: isFinite(goldRow.volume) ? goldRow.volume : null,
        source: 'YAHOO_GOLD_HISTORY',
        fetchedAt: new Date(),
        status: 'ERROR',
        error: 'USDJPY daily FX rate missing for ' + goldRow.priceDate
      };
    }

    var fxClose = fxRow.close;
    return {
      symbol: asset.symbol,
      assetType: asset.assetType,
      priceDate: goldRow.priceDate,
      currency: 'JPY',
      open: isFinite(goldRow.open) ? calculateGoldPricePerGramJpy(goldRow.open, fxClose) : null,
      high: isFinite(goldRow.high) ? calculateGoldPricePerGramJpy(goldRow.high, fxClose) : null,
      low: isFinite(goldRow.low) ? calculateGoldPricePerGramJpy(goldRow.low, fxClose) : null,
      close: calculateGoldPricePerGramJpy(goldRow.close, fxClose),
      volume: isFinite(goldRow.volume) ? goldRow.volume : null,
      source: 'YAHOO_GOLD_HISTORY',
      fxRate: fxClose,
      fxRateDate: fxRow.priceDate,
      fetchedAt: new Date(),
      status: fxRow.priceDate == goldRow.priceDate ? 'OK' : 'FX_FALLBACK',
      error: fxRow.priceDate == goldRow.priceDate ? '' : 'USDJPY missing for ' + goldRow.priceDate + '; used ' + fxRow.priceDate
    };
  }).filter(Boolean);
}

function findFxRowForGoldDate(fxByDate, fxDates, goldDate) {
  if (fxByDate[goldDate]) {
    return fxByDate[goldDate];
  }

  for (var i = fxDates.length - 1; i >= 0; i--) {
    if (fxDates[i] <= goldDate) {
      return fxByDate[fxDates[i]];
    }
  }

  return null;
}

function fetchGoldDailyPriceHistory(asset, startDate, endDate, callback) {
  fetchYahooChartDailyPriceHistory({ symbol: 'GC=F', assetType: 'US_STOCK' }, startDate, endDate, function (goldErr, goldRows) {
    if (goldErr) {
      callback(goldErr);
      return;
    }

    fetchYahooChartDailyPriceHistory({ symbol: 'JPY=X', assetType: 'US_STOCK' }, addDays(startDate, -7), endDate, function (fxErr, fxRows) {
      if (fxErr) {
        callback(fxErr);
        return;
      }

      var rows = buildGoldPriceHistoryRows(goldRows, fxRows, asset);
      rows.fxRows = fxRows;
      if (rows.length === 0) {
        callback(new Error('Gold daily price history not found'));
        return;
      }
      callback(null, rows);
    });
  });
}

function addDays(dateText, days) {
  var date = new Date(dateText + 'T00:00:00Z');
  if (isNaN(date.getTime())) {
    return '';
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isValidDateText(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    return false;
  }
  return !isNaN(new Date(value + 'T00:00:00Z').getTime());
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

function findPriceHistoryBounds(db, symbol, asset, callback) {
  if (typeof asset == 'function') {
    callback = asset;
    asset = null;
  }

  db.collection('priceHistory').find({ symbol: symbol }).toArray(function (err, rows) {
    if (err) {
      callback(err);
      return;
    }

    var dates = rows.filter(function (row) {
      return isPriceHistoryBoundsRow(row, asset);
    }).map(function (row) { return row.priceDate; })
      .filter(isValidDateText)
      .sort();

    callback(null, {
      count: dates.length,
      firstDate: dates[0] || '',
      lastDate: dates[dates.length - 1] || '',
      dates: dates
    });
  });
}

function isPriceHistoryBoundsRow(row, asset) {
  if (asset && asset.assetType == 'FUND') {
    return row.source == 'YAHOO_FUND_HISTORY' &&
      Object.prototype.hasOwnProperty.call(row, 'netAssetsBalance');
  }
  if (row && (row.source == 'YAHOO_CHART_SNAPSHOT' || row.source == 'YAHOO_GOLD_SNAPSHOT' || row.source == 'YAHOO_FUND_SNAPSHOT')) {
    return false;
  }
  return true;
}

function getHistoryEndLimitDate(asset, today) {
  if (asset && asset.assetType == 'GOLD') {
    return addDays(today, -1);
  }
  return today;
}

function findMissingHistoryDate(dates, startDate, endDate) {
  var saved = {};
  dates.forEach(function (date) {
    saved[date] = true;
  });

  for (var date = endDate; date >= startDate; date = addDays(date, -1)) {
    if (!saved[date]) {
      return date;
    }
    if (date == startDate) {
      break;
    }
  }

  return '';
}

function getNextPriceHistoryWindow(bounds, targetStartDate, historyEndLimit) {
  var dates = (bounds.dates || []).filter(function (date) {
    return date >= targetStartDate && date <= historyEndLimit;
  }).sort();
  var firstDate = dates[0] || '';
  var lastDate = dates[dates.length - 1] || '';
  var missingDate;
  var startDate;
  var endDate;

  if (!firstDate) {
    startDate = targetStartDate;
    endDate = minDateText(historyEndLimit, addDays(startDate, 29));
    return { startDate: startDate, endDate: endDate, reason: 'EMPTY' };
  }

  if (lastDate < historyEndLimit) {
    startDate = addDays(lastDate, 1);
    endDate = minDateText(historyEndLimit, addDays(startDate, 29));
    return { startDate: startDate, endDate: endDate, reason: 'FORWARD' };
  }

  missingDate = findMissingHistoryDate(dates, firstDate, historyEndLimit);
  if (missingDate) {
    endDate = minDateText(historyEndLimit, addDays(missingDate, 7));
    startDate = maxDateText(targetStartDate, addDays(endDate, -29));
    return { startDate: startDate, endDate: endDate, reason: 'GAP' };
  }

  if (firstDate > targetStartDate) {
    endDate = addDays(firstDate, -1);
    startDate = maxDateText(targetStartDate, addDays(endDate, -29));
    return { startDate: startDate, endDate: endDate, reason: 'BACKFILL' };
  }

  return { startDate: '', endDate: '', reason: 'UP_TO_DATE' };
}

function upsertPriceHistoryRows(db, rows, callback) {
  var pending = rows.length;
  if (pending === 0) {
    callback(null, { inserted: 0, updated: 0, total: 0 });
    return;
  }

  var inserted = 0;
  var updated = 0;
  var index = 0;

  function next(err) {
    if (err) {
      callback(err);
      callback = function () { };
      return;
    }
    if (index >= rows.length) {
      callback(null, { inserted: inserted, updated: updated, total: rows.length });
      return;
    }

    var row = rows[index];
    index++;
    db.collection('priceHistory').updateOne(
      { symbol: row.symbol, priceDate: row.priceDate, source: row.source },
      { $set: row },
      { upsert: true },
      function (err, result) {
        if (err) {
          next(err);
          return;
        }
        inserted += result.upsertedCount || 0;
        updated += result.modifiedCount || 0;
        deleteSnapshotPriceHistoryRowsForRealRow(db, row, next);
      }
    );
  }

  next();
}

function deleteSnapshotPriceHistoryRowsForRealRow(db, row, callback) {
  var snapshotSource = getSnapshotSourceForRealPriceHistoryRow(row);
  if (!snapshotSource) {
    callback();
    return;
  }

  db.collection('priceHistory').deleteMany({
    symbol: row.symbol,
    priceDate: row.priceDate,
    source: snapshotSource
  }, function (err) {
    callback(err);
  });
}

function getSnapshotSourceForRealPriceHistoryRow(row) {
  if (row.source == 'YAHOO_CHART') {
    return 'YAHOO_CHART_SNAPSHOT';
  }
  if (row.source == 'YAHOO_FUND_HISTORY') {
    return 'YAHOO_FUND_SNAPSHOT';
  }
  if (row.source == 'YAHOO_GOLD_HISTORY') {
    return 'YAHOO_GOLD_SNAPSHOT';
  }
  return '';
}

function formatYahooBffDate(dateText) {
  return String(dateText || '').replace(/-/g, '');
}

function parseJapaneseDateText(value) {
  var match = String(value || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) {
    return '';
  }
  return match[1] + '-' + ('0' + match[2]).slice(-2) + '-' + ('0' + match[3]).slice(-2);
}

function parseFundHistoryNumber(value) {
  value = cleanCsvValue(value).replace(/,/g, '');
  if (!value || value == '-') {
    return null;
  }
  var parsed = Number(value);
  return isFinite(parsed) ? parsed : null;
}

function parseYahooFundPriceHistory(json, asset) {
  var histories = json && json.histories;
  if (!Array.isArray(histories)) {
    return [];
  }

  return histories.map(function (row) {
    var priceDate = parseJapaneseDateText(row.date);
    var price = parseFundHistoryNumber(row.price);
    if (!priceDate || !isFinite(price)) {
      return null;
    }
    return {
      symbol: asset.symbol,
      assetType: asset.assetType,
      priceDate: priceDate,
      currency: 'JPY',
      open: price,
      high: price,
      low: price,
      close: price,
      volume: null,
      netAssetsBalance: parseFundHistoryNumber(row.netAssetsBalance),
      source: 'YAHOO_FUND_HISTORY',
      fetchedAt: new Date(),
      status: 'OK',
      error: ''
    };
  }).filter(Boolean);
}

function getFundCodeFromSourceUrl(sourceUrl) {
  var match = String(sourceUrl || '').match(/quote\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function fetchYahooFundJwtToken(fundCode, callback) {
  var url = 'https://finance.yahoo.co.jp/quote/' + encodeURIComponent(fundCode) + '/chart';
  fetchText(url, function (err, html) {
    if (err) {
      callback(err);
      return;
    }

    var match = html.match(/"jwtToken":"([^"]+)"/);
    if (!match) {
      callback(new Error('Yahoo fund token not found'));
      return;
    }
    callback(null, match[1]);
  });
}

function fetchYahooFundPriceHistory(asset, startDate, endDate, callback) {
  var fundCode = getFundCodeFromSourceUrl(asset.priceSourceUrl);
  if (!fundCode) {
    callback(new Error('Mapping required'));
    return;
  }

  fetchYahooFundJwtToken(fundCode, function (tokenErr, token) {
    if (tokenErr) {
      callback(tokenErr);
      return;
    }

    var path = '/bff-pc/v1/main/fund/price/history/' + encodeURIComponent(fundCode) +
      '?fromDate=' + formatYahooBffDate(startDate) +
      '&toDate=' + formatYahooBffDate(endDate) +
      '&timeFrame=daily&page=1&size=100&displayedMaxPage=5';
    var url = 'https://finance.yahoo.co.jp' + path;

    fetchTextWithHeaders(url, {
      'User-Agent': 'Mozilla/5.0 iriyano-price-fetcher',
      'Accept': 'application/json',
      'Referer': 'https://finance.yahoo.co.jp/quote/' + encodeURIComponent(fundCode) + '/chart',
      'jwt-token': token
    }, function (fetchErr, data) {
      if (fetchErr) {
        callback(fetchErr);
        return;
      }

      try {
        var rows = parseYahooFundPriceHistory(JSON.parse(data), asset);
        if (rows.length === 0) {
          callback(new Error('Fund price history not found'));
          return;
        }
        callback(null, rows);
      } catch (parseErr) {
        callback(parseErr);
      }
    });
  });
}

function updateAssetPriceHistoryStatus(db, asset, fields, callback) {
  db.collection('assets').updateOne({ symbol: asset.symbol }, { $set: fields }, callback);
}

function refreshAssetPriceHistory(db, asset, callback) {
  var isStock = asset.assetType == 'STOCK' || asset.assetType == 'US_STOCK';
  var isFund = asset.assetType == 'FUND';
  var isGold = asset.assetType == 'GOLD';
  if (!isStock && !isFund && !isGold) {
    callback(null, { ok: true, symbol: asset.symbol, skipped: true, reason: 'NO_HISTORY_SOURCE' });
    return;
  }

  findPriceHistoryBounds(db, asset.symbol, asset, function (findErr, bounds) {
    if (findErr) {
      callback(findErr);
      return;
    }

    var today = todayText();
    var historyEndLimit = getHistoryEndLimitDate(asset, today);
    var targetStartDate = isValidDateText(asset.priceHistoryStartDate) ? asset.priceHistoryStartDate : addDays(today, -30);
    var fetchWindow = getNextPriceHistoryWindow(bounds, targetStartDate, historyEndLimit);
    var startDate = fetchWindow.startDate;
    var endDate = fetchWindow.endDate;

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

    var historyFetcher = isGold ? fetchGoldDailyPriceHistory : isFund ? fetchYahooFundPriceHistory : fetchYahooChartDailyPriceHistory;
    historyFetcher(asset, startDate, endDate, function (fetchErr, rows) {
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

      upsertFetchedFxRows(db, rows.fxRows, function (fxUpsertErr) {
        if (fxUpsertErr) {
          callback(fxUpsertErr);
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
  });
}

function upsertFetchedFxRows(db, fxRows, callback) {
  if (!fxRows || fxRows.length === 0) {
    callback();
    return;
  }
  upsertFxRates(db, fxRows.map(function (row) {
    return {
      pair: 'USDJPY',
      rateDate: row.priceDate,
      rateType: 'DAILY_CLOSE',
      rate: row.close,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      source: row.source,
      fetchedAt: row.fetchedAt,
      status: row.status,
      error: row.error
    };
  }).filter(function (row) {
    return row.rateDate && isFinite(row.rate);
  }), callback);
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
  signJwt: signJwt,
  verifyJwt: verifyJwt,
  normalizeNextPath: normalizeNextPath,
  parseSbiCsv: parseSbiCsv,
  parseFxCsv: parseFxCsv,
  parseGoldCsv: parseGoldCsv,
  buildCombinedSummaryTotals: buildCombinedSummaryTotals,
  calculateGoldPricePerGramJpy: calculateGoldPricePerGramJpy,
  buildGoldPriceHistoryRows: buildGoldPriceHistoryRows,
  getGoldHoldingStartDate: getGoldHoldingStartDate,
  findLatestBuyDatesBySymbol: findLatestBuyDatesBySymbol,
  findOldestBuyDatesBySymbol: findOldestBuyDatesBySymbol,
  findActiveQuantitySymbols: findActiveQuantitySymbols,
  findRemainingLotStartDatesBySymbol: findRemainingLotStartDatesBySymbol,
  isPriceHistoryBoundsRow: isPriceHistoryBoundsRow,
  getHistoryEndLimitDate: getHistoryEndLimitDate,
  getNextPriceHistoryWindow: getNextPriceHistoryWindow,
  upsertPriceHistoryRows: upsertPriceHistoryRows,
  makeLatestPriceHistoryRow: makeLatestPriceHistoryRow,
  makeFundPriceHistoryRow: makeFundPriceHistoryRow,
  parseYahooFundPriceHistory: parseYahooFundPriceHistory,
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

function makeLatestPriceHistoryRow(asset, result) {
  if (!isFinite(result.price) || !isValidDateText(result.priceDate)) {
    return null;
  }

  var isFund = asset.assetType == 'FUND';
  var isStock = asset.assetType == 'STOCK' || asset.assetType == 'US_STOCK';
  var isGold = asset.assetType == 'GOLD';
  if (!isFund && !isStock && !isGold) {
    return null;
  }

  var price = isFund ? Math.round(result.price * 10000 * 10000) / 10000 : result.price;
  return {
    symbol: asset.symbol,
    assetType: asset.assetType,
    priceDate: result.priceDate,
    currency: asset.assetType == 'US_STOCK' ? 'USD' : 'JPY',
    open: price,
    high: price,
    low: price,
    close: price,
    volume: null,
    source: isFund ? 'YAHOO_FUND_SNAPSHOT' : isGold ? 'YAHOO_GOLD_SNAPSHOT' : 'YAHOO_CHART_SNAPSHOT',
    fetchedAt: new Date(),
    status: 'OK',
    error: ''
  };
}

function makeFundPriceHistoryRow(asset, result) {
  if (asset.assetType != 'FUND') {
    return null;
  }
  return makeLatestPriceHistoryRow(asset, result);
}

function shouldSaveLatestPriceHistoryRow(asset) {
  return asset.assetType != 'FUND';
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
      if (updateErr || err) {
        callback(updateErr, err ? { ok: false, symbol: asset.symbol, error: err.message } : null);
        return;
      }

      if (!shouldSaveLatestPriceHistoryRow(asset)) {
        callback(null, { ok: true, symbol: asset.symbol });
        return;
      }

      var latestHistoryRow = makeLatestPriceHistoryRow(asset, result);
      if (!latestHistoryRow) {
        callback(null, { ok: true, symbol: asset.symbol });
        return;
      }

      upsertPriceHistoryRows(db, [latestHistoryRow], function (historyErr) {
        callback(historyErr, historyErr
          ? { ok: false, symbol: asset.symbol, error: historyErr.message }
          : { ok: true, symbol: asset.symbol, latestHistoryRows: 1 });
      });
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

function getPriceRefreshStatus() {
  return {
    status: priceRefreshJob.status,
    startedAt: priceRefreshJob.startedAt,
    finishedAt: priceRefreshJob.finishedAt,
    ok: priceRefreshJob.ok,
    failed: priceRefreshJob.failed,
    error: priceRefreshJob.error
  };
}

function finishPriceRefreshJob(fields) {
  Object.assign(priceRefreshJob, fields, {
    finishedAt: new Date().toISOString()
  });
}

function startPriceRefreshJob() {
  if (priceRefreshJob.status == 'RUNNING') {
    return false;
  }

  priceRefreshJob = {
    status: 'RUNNING',
    startedAt: new Date().toISOString(),
    finishedAt: '',
    ok: 0,
    failed: 0,
    error: ''
  };

  setTimeout(function () {
    withDb(function (err, db, close) {
      function fail(error) {
        if (close) {
          close();
          close = null;
        }
        finishPriceRefreshJob({
          status: 'ERROR',
          ok: 0,
          failed: 0,
          error: error && error.message ? error.message : String(error || 'Unknown price refresh error')
        });
      }

      if (err) {
        fail(err);
        return;
      }

      findAllTransactions(db, function (findErr, transactionDocs) {
        if (findErr) {
          fail(findErr);
          return;
        }

        findGoldHolding(db, function (goldErr, goldHolding) {
          if (goldErr) {
            fail(goldErr);
            return;
          }

          var docs = addGoldTransaction(transactionDocs, goldHolding);
          var summaryRows = buildPortfolioSummary(docs);
          syncAssetsFromSummary(db, summaryRows, function (syncErr) {
            if (syncErr) {
              fail(syncErr);
              return;
            }

            findAssetsBySymbols(db, summaryRows.map(function (row) { return row.symbol; }), function (assetErr, assetsBySymbol) {
              if (assetErr) {
                fail(assetErr);
                return;
              }

              var activeSymbols = findActiveQuantitySymbols(docs);
              summaryRows.forEach(function (row) {
                if (isFinite(row.netQty) && Math.abs(row.netQty) > 0.0000001) {
                  activeSymbols[row.symbol] = true;
                }
              });
              var historyStartDatesBySymbol = findOldestBuyDatesBySymbol(docs);

              var assets = Object.keys(assetsBySymbol)
                .filter(function (symbol) { return activeSymbols[symbol]; })
                .map(function (symbol) {
                  return Object.assign({}, assetsBySymbol[symbol], {
                    priceHistoryStartDate: historyStartDatesBySymbol[symbol] || ''
                  });
                });

              refreshAssetPrices(db, assets, function (refreshErr, results) {
                if (close) {
                  close();
                  close = null;
                }
                if (refreshErr) {
                  finishPriceRefreshJob({
                    status: 'ERROR',
                    ok: 0,
                    failed: assets.length,
                    error: refreshErr.message
                  });
                  return;
                }

                var ok = results.filter(function (result) { return result.ok; }).length;
                var failed = results.length - ok;
                finishPriceRefreshJob({
                  status: 'COMPLETED',
                  ok: ok,
                  failed: failed,
                  error: ''
                });
              });
            });
          });
        });
      });
    });
  }, 0);

  return true;
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
          if (importErr) {
            close();
            res.status(500).render('import.ejs', { result: null, error: importErr.message });
            return;
          }

          importTransactions(db, holding.transactions || [], function (txErr, txResult) {
            close();
            if (txErr) {
              res.status(500).render('import.ejs', { result: null, error: txErr.message });
              return;
            }

            result.label = 'Gold CSV';
            result.link = '/transactions';
            result.linkText = 'View imported gold transactions';
            result.extra = 'Gold grams: ' + holding.grams + ', buy amount JPY: ' + holding.buyAmount +
              ', transaction rows: ' + txResult.total;
            result.transactionInserted = txResult.inserted;
            result.transactionUpdated = txResult.updated;
            res.render('import.ejs', { result: result, error: null });
          });
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

      findGoldHolding(db, function (goldErr, goldHolding) {
        if (goldErr) {
          close();
          res.status(500).send(goldErr.message);
          return;
        }

        var docsWithGold = addGoldTransaction(docs, goldHolding);
        var assets = buildTradeChartData(docsWithGold);
        var symbols = assets.map(function (asset) { return asset.symbol; });

        if (symbols.length === 0) {
          close();
          res.render('trade-chart.ejs', {
            assets: assets,
            chartDataJson: JSON.stringify(assets).replace(/</g, '\\u003c')
          });
          return;
        }

        var summaryRows = buildPortfolioSummary(docsWithGold);
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

            db.collection('priceHistory').find({ symbol: { $in: symbols } }).toArray(function (historyErr, historyRows) {
              close();
              if (historyErr) {
                res.status(500).send(historyErr.message);
                return;
              }

              var summaryReport = buildPortfolioSummaryReport(docsWithGold, assetsBySymbol, mapPriceHistoryBySymbol(historyRows));
              sortTradeChartAssetsBySummaryRows(assets, summaryReport.rows);
              attachPriceHistoryToTradeChartData(assets, historyRows);
              res.render('trade-chart.ejs', {
                assets: assets,
                chartDataJson: JSON.stringify(assets).replace(/</g, '\\u003c')
              });
            });
          });
        });
      });
    });
  });
});

function getDailyReportDate(value) {
  value = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 10);
}

function findLatestDailyReport(db, callback) {
  db.collection('dailyReports').find().sort({ reportDate: -1 }).limit(1).toArray(function (err, docs) {
    if (err) {
      callback(err);
      return;
    }
    callback(null, docs[0] || null);
  });
}

function findDailyReportForRequest(db, reportDate, callback) {
  if (reportDate) {
    db.collection('dailyReports').findOne({ reportDate: reportDate }, callback);
    return;
  }
  findLatestDailyReport(db, callback);
}

function saveDailyReport(db, report, callback) {
  db.collection('dailyReports').updateOne(
    { reportDate: report.reportDate },
    { $set: report },
    { upsert: true },
    callback
  );
}

function renderDailyReportPage(req, res, options) {
  options = options || {};
  withDb(function (err, db, close) {
    if (err) {
      res.status(500).send(err.message);
      return;
    }

    var requestedDate = req.query.date && getDailyReportDate(req.query.date);
    findDailyReportForRequest(db, requestedDate, function (reportErr, report) {
      if (reportErr) {
        close();
        res.status(500).send(reportErr.message);
        return;
      }

      buildDailyReportSnapshot(db, requestedDate || getDailyReportDate(), function (snapshotErr, snapshot) {
        close();
        if (snapshotErr) {
          res.status(500).send(snapshotErr.message);
          return;
        }

        res.render('daily-report.ejs', {
          report: options.report || report,
          snapshot: options.snapshot || snapshot,
          chatGptPrompt: buildChatGptReportPrompt(options.snapshot || snapshot),
          chatGptPromptCn: buildChineseChatGptReportPrompt(options.snapshot || snapshot),
          chatGptPromptJa: buildJapaneseChatGptReportPrompt(options.snapshot || snapshot),
          error: options.error || req.query.error || '',
          message: options.message || req.query.message || '',
          hasOpenAiKey: !!process.env.OPENAI_API_KEY
        });
      });
    });
  });
}

app.get('/daily-report', function (req, res) {
  renderDailyReportPage(req, res);
});

app.post('/daily-report/generate', function (req, res) {
  var reportDate = getDailyReportDate(req.body.reportDate);
  withDb(function (err, db, close) {
    if (err) {
      res.status(500).send(err.message);
      return;
    }

    buildDailyReportSnapshot(db, reportDate, function (snapshotErr, snapshot) {
      close();
      if (snapshotErr) {
        res.status(500).send(snapshotErr.message);
        return;
      }

      generateDailyReport(snapshot, function (generateErr, generated) {
        if (generateErr) {
          renderDailyReportPage(req, res, { snapshot: snapshot, error: generateErr.message });
          return;
        }

        var doc = {
          reportDate: reportDate,
          createdAt: new Date().toISOString(),
          model: generated.model,
          responseId: generated.responseId,
          markdown: generated.markdown,
          sources: generated.sources,
          snapshot: snapshot,
          disclaimer: 'For personal analysis only. Not tax, legal, or investment advice.'
        };

        withDb(function (saveOpenErr, saveDb, saveClose) {
          if (saveOpenErr) {
            res.status(500).send(saveOpenErr.message);
            return;
          }

          saveDailyReport(saveDb, doc, function (saveErr) {
            saveClose();
            if (saveErr) {
              res.status(500).send(saveErr.message);
              return;
            }
            res.redirect('/daily-report?date=' + encodeURIComponent(reportDate) + '&message=' + encodeURIComponent('Daily report generated.'));
          });
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

            var symbols = summaryRows.map(function (row) { return row.symbol; });
            db.collection('priceHistory').find({ symbol: { $in: symbols } }).toArray(function (historyErr, priceHistoryRows) {
              if (historyErr) {
                close();
                res.status(500).send(historyErr.message);
                return;
              }

              var report = buildPortfolioSummaryReport(docs, assetsBySymbol, mapPriceHistoryBySymbol(priceHistoryRows));
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
                  refreshStatus: getPriceRefreshStatus(),
                  message: req.query.message || ''
                });
              });
            });
          });
        });
      });
    });
  });
});

app.get('/history', function (req, res) {
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

            var symbols = summaryRows.map(function (row) { return row.symbol; });
            db.collection('priceHistory').find({ symbol: { $in: symbols } }).toArray(function (historyErr, priceHistoryRows) {
              if (historyErr) {
                close();
                res.status(500).send(historyErr.message);
                return;
              }

              findAllFxTrades(db, function (fxErr, fxTrades) {
                close();
                if (fxErr) {
                  res.status(500).send(fxErr.message);
                  return;
                }

                var today = new Date().toISOString().slice(0, 10);
                var currentReport = buildPortfolioSummaryReport(docs, assetsBySymbol, mapPriceHistoryBySymbol(priceHistoryRows));
                var currentFxSummary = buildFxSummary(fxTrades);
                res.render('history.ejs', {
                  history: buildCombinedSummaryHistory({
                    transactions: docs,
                    fxTrades: fxTrades,
                    assetsBySymbol: assetsBySymbol,
                    priceHistoryBySymbol: mapPriceHistoryBySymbol(priceHistoryRows),
                    today: today
                  }),
                  currentCombinedTotals: buildCombinedSummaryTotals(currentReport.totals, currentFxSummary.totals),
                  today: today
                });
              });
            });
          });
        });
      });
    });
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

app.get('/prices/refresh', function (req, res) {
  res.redirect('/summary?message=' + encodeURIComponent('Use the Update Prices button to start price refresh.'));
});

app.post('/prices/refresh', function (req, res) {
  var started = startPriceRefreshJob();
  res.redirect('/summary?message=' + encodeURIComponent(started
    ? 'Price refresh started. This page will stay available while it runs.'
    : 'Price refresh is already running.'));
});

var https = require('https');

if (require.main === module) {
  app.listen(PORT, function () {
    console.log('Server is running on PORT:', PORT);
  });
}
