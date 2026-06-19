function isNumber(value) {
  return typeof value == 'number' && !isNaN(value);
}

function isPositiveNumber(value) {
  return isNumber(value) && value > 0;
}

function normalizeDate(value) {
  value = String(value || '');
  return value.slice(0, 10);
}

function addDays(dateText, days) {
  var date = new Date(dateText + 'T00:00:00Z');
  if (isNaN(date.getTime())) {
    return dateText;
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getMarketDate(tx, date) {
  if (tx.assetType == 'US_STOCK') {
    return addDays(date, -1);
  }
  return date;
}

function getDisplaySymbol(tx) {
  if (tx.assetType == 'STOCK' && tx.code) {
    return 'TSE:' + String(tx.code).replace(/\.T$/, '');
  }
  return tx.symbol || tx.code || '';
}

function getChartPrice(tx) {
  if (isNumber(tx.price)) {
    return tx.price;
  }
  if (isNumber(tx.unitPrice)) {
    return tx.assetType == 'FUND' ? tx.unitPrice * 10000 : tx.unitPrice;
  }
  return null;
}

function getPriceUnit(tx) {
  if (tx.assetType == 'US_STOCK') {
    return 'USD/share';
  }
  if (tx.assetType == 'FUND') {
    return 'JPY/10,000 units';
  }
  if (tx.assetType == 'GOLD') {
    return 'JPY/gram';
  }
  return 'JPY/share';
}

function buildTradeChartData(transactions) {
  var assetsBySymbol = {};

  transactions.forEach(function (tx) {
    if (['STOCK', 'US_STOCK', 'FUND', 'GOLD'].indexOf(tx.assetType) < 0) {
      return;
    }
    if (tx.side != 'BUY' && tx.side != 'SELL') {
      return;
    }

    var price = getChartPrice(tx);
    var date = normalizeDate(tx.tradeDateTime || tx.tradeDate);
    if (!date || !isNumber(price)) {
      return;
    }

    var symbol = tx.symbol || tx.code || tx.assetName || 'UNKNOWN';
    if (!assetsBySymbol[symbol]) {
      assetsBySymbol[symbol] = {
        symbol: symbol,
        displaySymbol: getDisplaySymbol(tx),
        name: tx.assetName || symbol,
        assetType: tx.assetType,
        priceUnit: getPriceUnit(tx),
        points: []
      };
    }

    assetsBySymbol[symbol].points.push({
      date: date,
      marketDate: getMarketDate(tx, date),
      side: tx.side,
      price: price,
      quantity: isNumber(tx.quantity) ? tx.quantity : null,
      amount: isNumber(tx.settlementAmount) ? tx.settlementAmount : null,
      account: tx.account || ''
    });
  });

  return Object.keys(assetsBySymbol).map(function (symbol) {
    var asset = assetsBySymbol[symbol];
    asset.points.sort(function (a, b) {
      if (a.date < b.date) {
        return -1;
      }
      if (a.date > b.date) {
        return 1;
      }
      if (a.side < b.side) {
        return -1;
      }
      if (a.side > b.side) {
        return 1;
      }
      return 0;
    });
    asset.buyCount = asset.points.filter(function (point) { return point.side == 'BUY'; }).length;
    asset.sellCount = asset.points.filter(function (point) { return point.side == 'SELL'; }).length;
    asset.firstDate = asset.points[0] ? asset.points[0].date : '';
    asset.lastDate = asset.points[asset.points.length - 1] ? asset.points[asset.points.length - 1].date : '';
    return asset;
  }).sort(function (a, b) {
    return a.name.localeCompare(b.name) || a.displaySymbol.localeCompare(b.displaySymbol);
  });
}

function attachPriceHistoryToTradeChartData(assets, priceHistoryRows) {
  var rowsBySymbol = {};

  priceHistoryRows.forEach(function (row) {
    if (isLegacyFundLatestSnapshotRow(row)) {
      return;
    }
    if (!rowsBySymbol[row.symbol]) {
      rowsBySymbol[row.symbol] = {};
    }
    var normalized = {
      date: normalizeDate(row.priceDate),
      open: isPositiveNumber(row.open) ? row.open : null,
      high: isPositiveNumber(row.high) ? row.high : null,
      low: isPositiveNumber(row.low) ? row.low : null,
      close: isPositiveNumber(row.close) ? row.close : null,
      volume: isNumber(row.volume) ? row.volume : null,
      currency: row.currency || '',
      source: row.source || '',
      status: row.status || '',
      error: row.error || '',
      fxRateDate: row.fxRateDate || '',
      fetchedAt: row.fetchedAt || '',
      sourcePriority: priceHistorySourcePriority(row.source || '')
    };
    if (!normalized.date || (!isNumber(normalized.close) && normalized.status != 'ERROR')) {
      return;
    }

    var existing = rowsBySymbol[row.symbol][normalized.date];
    if (shouldReplacePriceHistoryRow(existing, normalized)) {
      rowsBySymbol[row.symbol][normalized.date] = normalized;
    }
  });

  assets.forEach(function (asset) {
    var rowsByDate = rowsBySymbol[asset.symbol] || {};
    asset.priceHistory = Object.keys(rowsByDate).map(function (date) {
      var row = rowsByDate[date];
      delete row.sourcePriority;
      delete row.fetchedAt;
      return row;
    }).sort(function (a, b) {
      if (a.date < b.date) {
        return -1;
      }
      if (a.date > b.date) {
        return 1;
      }
      return 0;
    });
    asset.historyCount = asset.priceHistory.length;
    asset.historyFirstDate = asset.priceHistory[0] ? asset.priceHistory[0].date : '';
    asset.historyLastDate = asset.priceHistory[asset.priceHistory.length - 1] ? asset.priceHistory[asset.priceHistory.length - 1].date : '';
  });

  return assets;
}

function sortTradeChartAssetsBySummaryRows(assets, summaryRows) {
  var orderBySymbol = {};
  (summaryRows || []).forEach(function (row, index) {
    orderBySymbol[row.symbol] = index;
  });

  return assets.sort(function (a, b) {
    var aOrder = Object.prototype.hasOwnProperty.call(orderBySymbol, a.symbol) ? orderBySymbol[a.symbol] : Number.MAX_SAFE_INTEGER;
    var bOrder = Object.prototype.hasOwnProperty.call(orderBySymbol, b.symbol) ? orderBySymbol[b.symbol] : Number.MAX_SAFE_INTEGER;
    if (aOrder != bOrder) {
      return aOrder - bOrder;
    }
    return (a.displaySymbol || '').localeCompare(b.displaySymbol || '');
  });
}

function isLegacyFundLatestSnapshotRow(row) {
  return row && row.assetType == 'FUND' && row.source == 'YAHOO_FUND_HISTORY' &&
    !Object.prototype.hasOwnProperty.call(row, 'netAssetsBalance');
}

function shouldReplacePriceHistoryRow(existing, candidate) {
  if (!existing) {
    return true;
  }
  if (candidate.sourcePriority > existing.sourcePriority) {
    return true;
  }
  if (candidate.sourcePriority < existing.sourcePriority) {
    return false;
  }
  if (candidate.fetchedAt && existing.fetchedAt) {
    return normalizeDateTime(candidate.fetchedAt) > normalizeDateTime(existing.fetchedAt);
  }
  return false;
}

function normalizeDateTime(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value || '');
}

function priceHistorySourcePriority(source) {
  if (source == 'YAHOO_CHART' || source == 'YAHOO_FUND_HISTORY' || source == 'YAHOO_GOLD_HISTORY') {
    return 3;
  }
  if (source == 'YAHOO_CHART_SNAPSHOT' || source == 'YAHOO_FUND_SNAPSHOT' || source == 'YAHOO_GOLD_SNAPSHOT' || source == 'FUND_MAPPING') {
    return 1;
  }
  return 0;
}

module.exports = {
  buildTradeChartData: buildTradeChartData,
  attachPriceHistoryToTradeChartData: attachPriceHistoryToTradeChartData,
  sortTradeChartAssetsBySummaryRows: sortTradeChartAssetsBySummaryRows
};
