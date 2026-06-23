var buildPortfolioSummary = require('./portfolioSummary').buildPortfolioSummary;
var buildPortfolioSummaryReport = require('./portfolioSummary').buildPortfolioSummaryReport;

function isNumber(value) {
  return typeof value == 'number' && !isNaN(value);
}

function roundMoney(value) {
  return Math.round((value || 0) * 100) / 100;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function findAllTransactions(db, callback) {
  db.collection('transactions').find().sort({ tradeDateTime: 1, symbol: 1 }).toArray(callback);
}

function findAllFxTrades(db, callback) {
  db.collection('fxTrades').find().sort({ tradeDateTime: 1 }).toArray(callback);
}

function findGoldHolding(db, callback) {
  db.collection('goldHoldings').findOne({ _id: 'gold' }, callback);
}

function hasDetailedGoldTransaction(transactions) {
  return transactions.some(function (tx) {
    return tx.assetType == 'GOLD' && tx.symbol == 'GOLD_JPY';
  });
}

function getGoldHoldingStartDate(holding) {
  var candidates = [
    holding && holding.startDate,
    holding && holding.firstTradeDate,
    holding && holding.importedAt,
    holding && holding.updatedAt
  ];

  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i]) {
      return String(candidates[i]).slice(0, 10);
    }
  }
  return todayIsoDate();
}

function addSyntheticGoldTransaction(transactions, holding) {
  if (!holding || !isNumber(holding.grams) || holding.grams <= 0 || hasDetailedGoldTransaction(transactions)) {
    return transactions;
  }

  return transactions.concat([{
    source: 'GOLD_HOLDING',
    sourceHash: 'gold-holding',
    assetType: 'GOLD',
    assetName: 'Gold',
    symbol: 'GOLD_JPY',
    side: 'BUY',
    tradeDate: getGoldHoldingStartDate(holding),
    tradeDateTime: getGoldHoldingStartDate(holding),
    quantity: holding.grams,
    settlementAmount: isNumber(holding.buyAmount) ? holding.buyAmount : null
  }]);
}

function mapPriceHistoryBySymbol(rows) {
  var grouped = {};
  (rows || []).forEach(function (row) {
    if (row && row.assetType == 'FUND' && row.source == 'YAHOO_FUND_HISTORY' &&
      !Object.prototype.hasOwnProperty.call(row, 'netAssetsBalance')) {
      return;
    }
    if (!grouped[row.symbol]) {
      grouped[row.symbol] = [];
    }
    grouped[row.symbol].push(row);
  });
  return grouped;
}

function findAssetsBySymbols(db, symbols, callback) {
  symbols = (symbols || []).filter(Boolean);
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

function findPriceHistoryBySymbols(db, symbols, callback) {
  symbols = (symbols || []).filter(Boolean);
  if (symbols.length === 0) {
    callback(null, []);
    return;
  }
  db.collection('priceHistory').find({ symbol: { $in: symbols } }).toArray(callback);
}

function summarizeFxTrades(trades) {
  var byPair = {};
  (trades || []).forEach(function (trade) {
    var pair = trade.pair || 'UNKNOWN';
    if (!byPair[pair]) {
      byPair[pair] = {
        pair: pair,
        txCount: 0,
        realizedSwap: 0,
        realizedPl: 0,
        totalPl: 0
      };
    }
    byPair[pair].txCount++;
    byPair[pair].realizedSwap += trade.realizedSwap || 0;
    byPair[pair].realizedPl += trade.realizedPl || 0;
    byPair[pair].totalPl += trade.totalPl || 0;
  });

  var rows = Object.keys(byPair).map(function (pair) {
    var row = byPair[pair];
    row.realizedSwap = roundMoney(row.realizedSwap);
    row.realizedPl = roundMoney(row.realizedPl);
    row.totalPl = roundMoney(row.totalPl);
    return row;
  }).sort(function (a, b) {
    return Math.abs(b.totalPl) - Math.abs(a.totalPl);
  });

  return {
    rows: rows,
    totals: rows.reduce(function (total, row) {
      total.realizedSwap += row.realizedSwap;
      total.realizedPl += row.realizedPl;
      total.totalPl += row.totalPl;
      return total;
    }, { realizedSwap: 0, realizedPl: 0, totalPl: 0 })
  };
}

function allocationByAssetClass(rows) {
  var total = rows.reduce(function (sum, row) {
    return sum + (isNumber(row.marketValue) ? row.marketValue : 0);
  }, 0);
  var byClass = {};

  rows.forEach(function (row) {
    var key = row.assetClass || row.assetType || 'UNKNOWN';
    if (!byClass[key]) {
      byClass[key] = { assetClass: key, marketValue: 0, marketValuePercent: null };
    }
    byClass[key].marketValue += isNumber(row.marketValue) ? row.marketValue : 0;
  });

  return Object.keys(byClass).map(function (key) {
    var row = byClass[key];
    row.marketValue = roundMoney(row.marketValue);
    row.marketValuePercent = total > 0 ? roundMoney(row.marketValue / total * 100) : null;
    return row;
  }).sort(function (a, b) {
    return b.marketValue - a.marketValue;
  });
}

function compactHolding(row) {
  return {
    symbol: row.symbol,
    displaySymbol: row.displaySymbol,
    name: row.name,
    assetType: row.assetType,
    assetClass: row.assetClass,
    netQty: row.netQty,
    marketValue: row.marketValue,
    marketValuePercent: row.marketValuePercent,
    remainingCost: row.remainingCost,
    latestPrice: row.latestPrice,
    latestPriceDate: row.latestPriceDate,
    dayPl: row.dayPl,
    dayPlPercent: row.dayPlPercent,
    unrealizedPl: row.unrealizedPl,
    unrealizedPlPercent: row.unrealizedPlPercent,
    realizedPl: row.fifoRealizedPl,
    totalPl: row.totalPl,
    priceSourceUrl: row.priceSourceUrl,
    warning: row.warning || ''
  };
}

function byAbsField(field) {
  return function (a, b) {
    return Math.abs(b[field] || 0) - Math.abs(a[field] || 0);
  };
}

function buildWatchTopics(rows, fxSummary) {
  var topics = [];
  rows.slice(0, 8).forEach(function (row) {
    var label = [row.symbol, row.name].filter(Boolean).join(' ');
    if (label) {
      topics.push(label);
    }
  });

  if ((fxSummary.rows || []).some(function (row) {
    return (row.pair && row.pair.indexOf('USD') >= 0) || row.pair == '米ドル-円';
  })) {
    topics.push('USD JPY exchange rate');
  }

  topics.push('Japan stock market');
  topics.push('Japanese investment trusts');
  topics.push('US stock market');

  return topics.filter(function (topic, index) {
    return topics.indexOf(topic) == index;
  });
}

function buildSnapshotFromData(reportDate, transactions, goldHolding, assetsBySymbol, priceHistoryRows, fxTrades) {
  var docs = addSyntheticGoldTransaction(transactions || [], goldHolding);
  var report = buildPortfolioSummaryReport(docs, assetsBySymbol || {}, mapPriceHistoryBySymbol(priceHistoryRows || []));
  var activeRows = report.rows.filter(function (row) {
    return isNumber(row.netQty) && Math.abs(row.netQty) > 0.0000001;
  });
  var fxSummary = summarizeFxTrades(fxTrades || []);
  var topHoldings = activeRows.slice(0, 12).map(compactHolding);
  var movers = activeRows.filter(function (row) {
    return isNumber(row.dayPl);
  }).sort(byAbsField('dayPl')).slice(0, 8).map(compactHolding);
  var winnersLosers = activeRows.filter(function (row) {
    return isNumber(row.totalPl);
  }).sort(byAbsField('totalPl')).slice(0, 8).map(compactHolding);

  return {
    reportDate: reportDate,
    generatedAt: new Date().toISOString(),
    totals: report.totals,
    rowCount: report.rows.length,
    activeHoldingCount: activeRows.length,
    allocation: allocationByAssetClass(activeRows),
    topHoldings: topHoldings,
    notableDayMovers: movers,
    notableTotalPl: winnersLosers,
    warnings: report.rows.filter(function (row) { return row.hasWarning; }).map(function (row) {
      return { symbol: row.symbol, name: row.name, warning: row.warning };
    }),
    fxSummary: fxSummary,
    watchTopics: buildWatchTopics(topHoldings, fxSummary),
    dataNotes: [
      'Portfolio calculations are produced by the local SBI portfolio tracker using imported SQLite data.',
      'The generated narrative is for personal analysis only and is not tax, legal, or investment advice.'
    ]
  };
}

function buildDailyReportSnapshot(db, reportDate, callback) {
  reportDate = reportDate || todayIsoDate();
  findAllTransactions(db, function (txErr, transactions) {
    if (txErr) {
      callback(txErr);
      return;
    }

    findGoldHolding(db, function (goldErr, goldHolding) {
      if (goldErr) {
        callback(goldErr);
        return;
      }

      var docs = addSyntheticGoldTransaction(transactions || [], goldHolding);
      var summaryRows = buildPortfolioSummary(docs);
      var symbols = summaryRows.map(function (row) { return row.symbol; }).filter(Boolean);

      findAssetsBySymbols(db, symbols, function (assetErr, assetsBySymbol) {
        if (assetErr) {
          callback(assetErr);
          return;
        }

        findPriceHistoryBySymbols(db, symbols, function (historyErr, historyRows) {
          if (historyErr) {
            callback(historyErr);
            return;
          }

          findAllFxTrades(db, function (fxErr, fxTrades) {
            if (fxErr) {
              callback(fxErr);
              return;
            }

            callback(null, buildSnapshotFromData(reportDate, transactions, goldHolding, assetsBySymbol, historyRows, fxTrades));
          });
        });
      });
    });
  });
}

module.exports = {
  buildDailyReportSnapshot: buildDailyReportSnapshot,
  buildSnapshotFromData: buildSnapshotFromData,
  mapPriceHistoryBySymbol: mapPriceHistoryBySymbol,
  summarizeFxTrades: summarizeFxTrades
};