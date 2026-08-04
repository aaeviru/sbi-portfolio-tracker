var assert = require('assert');
var dates = require('../lib/dateDomains');

assert.strictEqual(dates.getReportDate(new Date('2026-08-03T15:30:00.000Z')), '2026-08-04');
assert.strictEqual(dates.getReportDate(new Date('2026-08-04T00:30:00.000Z')), '2026-08-04');

var jpStock = { assetType: 'STOCK' };
assert.strictEqual(dates.getLatestCompletedMarketDate(jpStock, new Date('2026-08-04T05:59:00.000Z')), '2026-08-03');
assert.strictEqual(dates.getLatestCompletedMarketDate(jpStock, new Date('2026-08-04T06:30:00.000Z')), '2026-08-04');
assert.strictEqual(dates.getLatestCompletedMarketDate(jpStock, new Date('2026-08-03T02:00:00.000Z')), '2026-07-31');

var usStock = { assetType: 'US_STOCK' };
assert.strictEqual(dates.getLatestCompletedMarketDate(usStock, new Date('2026-07-15T19:59:00.000Z')), '2026-07-14');
assert.strictEqual(dates.getLatestCompletedMarketDate(usStock, new Date('2026-07-15T20:01:00.000Z')), '2026-07-15');
assert.strictEqual(dates.getLatestCompletedMarketDate(usStock, new Date('2026-01-15T20:59:00.000Z')), '2026-01-14');
assert.strictEqual(dates.getLatestCompletedMarketDate(usStock, new Date('2026-01-15T21:01:00.000Z')), '2026-01-15');

var yahooMeta = {
  exchangeTimezoneName: 'America/New_York',
  currentTradingPeriod: { regular: { end: Date.parse('2026-07-15T20:00:00.000Z') / 1000 } }
};
assert.strictEqual(dates.getLatestCompletedMarketDate(usStock, new Date('2026-07-15T19:59:00.000Z'), yahooMeta), '2026-07-14');
assert.strictEqual(dates.getLatestCompletedMarketDate(usStock, new Date('2026-07-15T20:01:00.000Z'), yahooMeta), '2026-07-15');

assert.strictEqual(dates.getProviderDate(Date.parse('2026-07-16T00:30:00.000Z') / 1000, 'America/New_York'), '2026-07-15');
assert.strictEqual(dates.getProviderDate(Date.parse('2026-07-15T15:30:00.000Z') / 1000, 'Asia/Tokyo'), '2026-07-16');
assert.strictEqual(dates.getAssetTimeZone({ assetType: 'US_STOCK' }, { exchangeTimezoneName: 'Not/A_Timezone' }), 'America/New_York');
assert.strictEqual(dates.getLatestCompletedMarketDate({ assetType: 'FUND' }, new Date('2026-08-03T15:30:00.000Z')), '2026-08-04');
assert.strictEqual(dates.getLatestCompletedMarketDate({ assetType: 'FUND', latestPriceDate: '2026-08-01' }, new Date('2026-08-03T15:30:00.000Z')), '2026-08-01');

console.log('dateDomains tests passed');
