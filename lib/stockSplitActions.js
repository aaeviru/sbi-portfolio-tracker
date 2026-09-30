var crypto = require('crypto');
var stockSplits = require('./stockSplits');

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

function save(collection, doc) {
  return new Promise(function (resolve, reject) {
    collection.updateOne({ id: doc.id }, { $set: doc }, { upsert: true }, function (err) {
      err ? reject(err) : resolve(doc);
    });
  });
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  var date = new Date(value + 'T00:00:00Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) == value;
}

function validateManual(input) {
  var symbol = String(input.symbol || '').trim().toUpperCase();
  var exDate = String(input.exDate || '').trim();
  var operation = String(input.operation || 'ADD').trim().toUpperCase();
  var beforeShares = Number(input.beforeShares);
  var afterShares = Number(input.afterShares);
  var replacesId = String(input.replacesId || '').trim();
  if (!/^(?:\d{4}|\d{3}[A-Z])\.T$/.test(symbol)) throw new Error('Enter a Japanese stock symbol such as 8316.T.');
  if (['ADD', 'REPLACE', 'REMOVE'].indexOf(operation) < 0) throw new Error('Invalid correction action.');
  if (operation != 'REMOVE' && !validDate(exDate)) throw new Error('Enter a valid ex-rights date (YYYY-MM-DD).');
  if (operation != 'ADD' && !replacesId) throw new Error('Choose the confirmed split to correct.');
  if (operation == 'ADD' && replacesId) throw new Error('Use Correct or Remove for an existing confirmed split.');
  if (operation != 'REMOVE' && (!(beforeShares > 0 && afterShares > 0) || beforeShares == afterShares)) {
    throw new Error('Enter different positive share counts before and after the split.');
  }
  return { symbol: symbol, exDate: exDate, operation: operation,
    beforeShares: operation == 'REMOVE' ? null : beforeShares,
    afterShares: operation == 'REMOVE' ? null : afterShares,
    ratio: operation == 'REMOVE' ? null : afterShares / beforeShares,
    replacesId: replacesId };
}

async function addManualCandidate(db, input) {
  var fields = validateManual(input);
  var collection = db.collection('stockSplits');
  if (fields.replacesId) {
    var replaced = await findOne(collection, { id: fields.replacesId });
    if (!replaced || replaced.status != 'CONFIRMED' || replaced.symbol != fields.symbol) {
      throw new Error('Confirmed split to correct was not found for this symbol.');
    }
    if (fields.operation == 'REMOVE') fields.exDate = replaced.exDate;
  }
  var now = new Date().toISOString();
  return save(collection, Object.assign(fields, {
    id: 'MANUAL:' + crypto.randomUUID(),
    status: 'PENDING', source: 'MANUAL', sourceUrl: '', observedAt: now
  }));
}

async function changeStatus(db, id, action) {
  var collection = db.collection('stockSplits');
  var candidate = await findOne(collection, { id: id });
  if (!candidate || candidate.status != 'PENDING') throw new Error('Pending split was not found.');
  if (action == 'DISMISSED') {
    return save(collection, Object.assign({}, candidate, { status: 'DISMISSED', decidedAt: new Date().toISOString() }));
  }
  if (action != 'CONFIRMED') throw new Error('Invalid split action.');
  var all = await findAll(collection, { symbol: candidate.symbol });
  var replaced = null;
  if (candidate.replacesId) {
    replaced = all.find(function (row) { return row.id == candidate.replacesId; });
    if (!replaced || replaced.status != 'CONFIRMED') throw new Error('Split being corrected is no longer confirmed.');
  }
  if (candidate.operation != 'REMOVE') {
    var conflict = all.find(function (row) {
      return row.status == 'CONFIRMED' && row.operation != 'REMOVE' &&
        row.exDate == candidate.exDate && (!replaced || row.id != replaced.id);
    });
    if (conflict) throw new Error('A split is already confirmed on this date. Correct that event instead.');
  }
  var now = new Date().toISOString();
  if (replaced) await save(collection, Object.assign({}, replaced, { status: 'DISMISSED', decidedAt: now, replacedBy: candidate.id }));
  return save(collection, Object.assign({}, candidate, { status: 'CONFIRMED', decidedAt: now }));
}

function previewCandidate(transactions, asset, candidate, asOfDate, historyRows) {
  var buildPortfolioSummary = require('./portfolioSummary').buildPortfolioSummary;
  var symbol = candidate.symbol;
  var baseEvents = (asset && asset.stockSplits || []).filter(function (row) { return row.id != candidate.replacesId; });
  var afterEvents = candidate.operation == 'REMOVE' ? baseEvents : baseEvents.concat([Object.assign({}, candidate, { status: 'CONFIRMED' })]);
  var symbolTransactions = transactions.filter(function (tx) { return (tx.symbol || tx.code) == symbol; });
  var beforeAsset = Object.assign({}, asset || {}, { stockSplits: asset && asset.stockSplits || [] });
  var afterAsset = Object.assign({}, asset || {}, { stockSplits: afterEvents });
  var firstTradeDate = symbolTransactions.map(function (tx) {
    return tx.tradeDate || String(tx.tradeDateTime || '').slice(0, 10);
  }).filter(Boolean).sort()[0] || '';
  var priorPrice = (historyRows || []).filter(function (row) {
    return row.symbol == symbol && row.priceDate < candidate.exDate &&
      typeof row.close == 'number' && isFinite(row.close) && row.close > 0;
  }).sort(function (a, b) { return a.priceDate < b.priceDate ? 1 : a.priceDate > b.priceDate ? -1 : 0; })[0];
  return {
    before: buildPortfolioSummary(symbolTransactions, { [symbol]: beforeAsset }, asOfDate)[0] || null,
    after: buildPortfolioSummary(symbolTransactions, { [symbol]: afterAsset }, asOfDate)[0] || null,
    precedesTrades: !!firstTradeDate && candidate.exDate <= firstTradeDate,
    chartPrice: priorPrice ? {
      date: priorPrice.priceDate,
      before: stockSplits.adjustPrice(beforeAsset.stockSplits, priorPrice.close, priorPrice.priceDate, asOfDate),
      after: stockSplits.adjustPrice(afterAsset.stockSplits, priorPrice.close, priorPrice.priceDate, asOfDate)
    } : null
  };
}

module.exports = { addManualCandidate: addManualCandidate, changeStatus: changeStatus,
  previewCandidate: previewCandidate, validateManual: validateManual };
