function attachConfirmedStockSplits(db, assetsBySymbol, callback) {
  var symbols = Object.keys(assetsBySymbol || {});
  if (symbols.length === 0) {
    callback(null, assetsBySymbol || {});
    return;
  }
  db.collection('stockSplits').find({ symbol: { $in: symbols } }).toArray(function (err, events) {
    if (err) {
      callback(err);
      return;
    }
    symbols.forEach(function (symbol) {
      assetsBySymbol[symbol] = Object.assign({}, assetsBySymbol[symbol], { stockSplits: [] });
    });
    events.forEach(function (event) {
      if (event.status == 'CONFIRMED' && event.operation != 'REMOVE' && assetsBySymbol[event.symbol]) {
        assetsBySymbol[event.symbol].stockSplits.push(event);
      }
    });
    callback(null, assetsBySymbol);
  });
}

module.exports = { attachConfirmedStockSplits: attachConfirmedStockSplits };
