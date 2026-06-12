function isNumber(value) {
  return typeof value == 'number' && !isNaN(value);
}

function normalizeDate(value) {
  value = String(value || '');
  return value.slice(0, 10);
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

module.exports = {
  buildTradeChartData: buildTradeChartData
};
