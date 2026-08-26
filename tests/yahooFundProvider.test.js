var assert = require('assert');
var createYahooFundProvider = require('../app').createYahooFundProvider;

function fetchPriceHistory(provider, asset, startDate, endDate) {
  return new Promise(function (resolve, reject) {
    provider.fetchPriceHistory(asset, startDate, endDate, function (err, rows) {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function fetchPagePrice(provider, asset, reportDate) {
  return new Promise(function (resolve, reject) {
    provider.fetchPagePrice(asset, reportDate, function (err, result) {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

var escapedFundPage = [
  '<div>投資信託</div><div>TEST1234</div><div>123,456</div><div>前日比 +100</div>',
  '<script>self.__next_f.push([1,"{\\"priceBoard\\":{\\"value\\":\\"123,456\\",\\"updateDate\\":\\"8/25\\"},\\"jwtToken\\":\\"synthetic.header.signature\\"}"])</script>'
].join('');
var historyPayload = JSON.stringify({
  histories: [{
    date: '2026年8月25日',
    price: '123,456',
    priceChange: '100',
    netAssetsBalance: '999,999'
  }],
  paging: { hasNext: false, totalPage: 1 }
});
var chartHistoryPayload = JSON.stringify({
  priceHistories: [{
    baseDatetime: '2026-08-26T00:00:00+09:00',
    baseDate: '2026-08-26',
    openPrice: 124000,
    highPrice: 125000,
    lowPrice: 123000,
    closePrice: 124500,
    netAssetsBalance: 999999,
    returnRate: 1.25
  }]
});

var adapter = {
  fetchFundPage: function (fundCode, callback) {
    if (fundCode != 'TEST1234') {
      callback(new Error('Unexpected fund code'));
      return;
    }
    callback(null, escapedFundPage);
  },
  fetchFundHistoryPage: function (request, callback) {
    if (request.token != 'synthetic.header.signature') {
      callback(new Error('Rejected synthetic token'));
      return;
    }
    callback(null, historyPayload);
  }
};

async function main() {
  var asset = {
    symbol: 'FUND:synthetic',
    assetType: 'FUND',
    priceSourceUrl: 'https://finance.yahoo.co.jp/quote/TEST1234'
  };
  var provider = createYahooFundProvider(adapter);
  var rows = await fetchPriceHistory(provider, asset, '2026-08-25', '2026-08-25');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].priceDate, '2026-08-25');
  assert.strictEqual(rows[0].close, 123456);
  assert.strictEqual(JSON.stringify(rows).indexOf('synthetic.header.signature'), -1);

  var result = await fetchPagePrice(provider, asset, '2026-08-26');
  assert.deepStrictEqual(result, {
    price: 12.3456,
    priceDate: '2026-08-25',
    sourceTimestamp: '',
    sourceTimezone: 'Asia/Tokyo',
    dateBasis: 'PROVIDER_DATE'
  });
  assert.strictEqual(JSON.stringify(result).indexOf('synthetic.header.signature'), -1);

  var chartHistoryProvider = createYahooFundProvider({
    fetchFundPage: function (fundCode, callback) {
      callback(null, escapedFundPage, { cookieHeader: 'synthetic-session=cookie' });
    },
    fetchFundHistoryPage: function (request, callback) {
      assert.strictEqual(request.cookieHeader, 'synthetic-session=cookie');
      callback(null, chartHistoryPayload);
    }
  });
  rows = await fetchPriceHistory(chartHistoryProvider, asset, '2026-08-26', '2026-08-26');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].priceDate, '2026-08-26');
  assert.strictEqual(rows[0].open, 124000);
  assert.strictEqual(rows[0].high, 125000);
  assert.strictEqual(rows[0].low, 123000);
  assert.strictEqual(rows[0].close, 124500);
  assert.strictEqual(rows[0].netAssetsBalance, 999999);

  var ordinaryTokenProvider = createYahooFundProvider({
    fetchFundPage: function (fundCode, callback) {
      callback(null, [
        '<div>投資信託</div><div>TEST1234</div><div>123,456</div><div>前日比 +100</div>',
        '<script>{"priceBoard":{"value":"123,456","updateDate":"8/25"},"jwtToken":"synthetic.ordinary.signature"}</script>'
      ].join(''));
    },
    fetchFundHistoryPage: function (request, callback) {
      if (request.token != 'synthetic.ordinary.signature') {
        callback(new Error('Rejected ordinary synthetic token'));
        return;
      }
      callback(null, historyPayload);
    }
  });
  rows = await fetchPriceHistory(ordinaryTokenProvider, asset, '2026-08-25', '2026-08-25');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].priceDate, '2026-08-25');

  var authPageCalls = 0;
  var authHistoryCalls = 0;
  var refreshedTokenProvider = createYahooFundProvider({
    fetchFundPage: function (fundCode, callback) {
      authPageCalls++;
      var token = authPageCalls == 1 ? 'synthetic.stale.signature' : 'synthetic.fresh.signature';
      callback(null, [
        '<div>投資信託</div><div>TEST1234</div><div>123,456</div><div>前日比 +100</div>',
        '<script>{"priceBoard":{"value":"123,456","updateDate":"8/25"},"jwtToken":"' + token + '"}</script>'
      ].join(''));
    },
    fetchFundHistoryPage: function (request, callback) {
      authHistoryCalls++;
      if (request.token == 'synthetic.stale.signature') {
        callback(new Error('HTTP 401'));
        return;
      }
      if (request.token != 'synthetic.fresh.signature') {
        callback(new Error('Unexpected refreshed token'));
        return;
      }
      callback(null, historyPayload);
    }
  });
  rows = await fetchPriceHistory(refreshedTokenProvider, asset, '2026-08-25', '2026-08-25');
  assert.strictEqual(authPageCalls, 2);
  assert.strictEqual(authHistoryCalls, 2);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].priceDate, '2026-08-25');

  var malformedTokenProvider = createYahooFundProvider({
    fetchFundPage: function (fundCode, callback) {
      callback(null, [
        '<div>投資信託</div><div>TEST1234</div><div>123,456</div><div>前日比 +100</div>',
        '<script>{"jwtToken":"not a jwt"}</script>'
      ].join(''));
    },
    fetchFundHistoryPage: function (request, callback) {
      callback(new Error('History request must not be sent'));
    }
  });
  var malformedError;
  try {
    await fetchPriceHistory(malformedTokenProvider, asset, '2026-08-25', '2026-08-25');
  } catch (err) {
    malformedError = err;
  }
  assert.ok(malformedError);
  assert.strictEqual(malformedError.message, 'Yahoo fund token not found');
  assert.strictEqual(malformedError.message.indexOf('not a jwt'), -1);

  var invalidPayloadProvider = createYahooFundProvider({
    fetchFundPage: function (fundCode, callback) {
      callback(null, escapedFundPage);
    },
    fetchFundHistoryPage: function (request, callback) {
      callback(null, JSON.stringify({ unexpected: [] }));
    }
  });
  var invalidPayloadError;
  try {
    await fetchPriceHistory(invalidPayloadProvider, asset, '2026-08-25', '2026-08-25');
  } catch (err) {
    invalidPayloadError = err;
  }
  assert.ok(invalidPayloadError);
  assert.strictEqual(invalidPayloadError.message, 'Invalid Yahoo fund history response');
  assert.strictEqual(invalidPayloadError.message.indexOf('synthetic.header.signature'), -1);

  var invalidRowProvider = createYahooFundProvider({
    fetchFundPage: function (fundCode, callback) {
      callback(null, escapedFundPage);
    },
    fetchFundHistoryPage: function (request, callback) {
      callback(null, JSON.stringify({
        histories: [{
          date: '2026年8月25日',
          price: '-',
          netAssetsBalance: '999,999'
        }]
      }));
    }
  });
  var invalidRowError;
  try {
    await fetchPriceHistory(invalidRowProvider, asset, '2026-08-25', '2026-08-25');
  } catch (err) {
    invalidRowError = err;
  }
  assert.ok(invalidRowError);
  assert.strictEqual(invalidRowError.message, 'Invalid Yahoo fund history response');
  assert.strictEqual(invalidRowError.message.indexOf('synthetic.header.signature'), -1);

  console.log('yahooFundProvider tests passed');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
