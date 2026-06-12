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
  return 'JPY/share';
}

function buildTradeChartData(transactions) {
  var assetsBySymbol = {};

  transactions.forEach(function (tx) {
    if (['STOCK', 'US_STOCK', 'FUND'].indexOf(tx.assetType) < 0) {
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
    if (!rowsBySymbol[row.symbol]) {
      rowsBySymbol[row.symbol] = [];
    }
    rowsBySymbol[row.symbol].push({
      date: normalizeDate(row.priceDate),
      open: isPositiveNumber(row.open) ? row.open : null,
      high: isPositiveNumber(row.high) ? row.high : null,
      low: isPositiveNumber(row.low) ? row.low : null,
      close: isPositiveNumber(row.close) ? row.close : null,
      volume: isNumber(row.volume) ? row.volume : null,
      currency: row.currency || '',
      source: row.source || ''
    });
  });

  assets.forEach(function (asset) {
    asset.priceHistory = (rowsBySymbol[asset.symbol] || []).filter(function (row) {
      return row.date && isNumber(row.close);
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

module.exports = {
  buildTradeChartData: buildTradeChartData,
  attachPriceHistoryToTradeChartData: attachPriceHistoryToTradeChartData
};
