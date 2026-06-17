var assert = require('assert');
var app = require('../app');

var now = Math.floor(Date.now() / 1000);
var token = app.signJwt({ sub: 'tester', exp: now + 60 }, 'secret');
var payload = app.verifyJwt(token, 'secret');
assert(payload);
assert.strictEqual(payload.sub, 'tester');

assert.strictEqual(app.verifyJwt(token, 'wrong-secret'), null);

var expired = app.signJwt({ sub: 'tester', exp: now - 1 }, 'secret');
assert.strictEqual(app.verifyJwt(expired, 'secret'), null);

assert.strictEqual(app.normalizeNextPath('/summary'), '/summary');
assert.strictEqual(app.normalizeNextPath('https://example.com'), '/summary');
assert.strictEqual(app.normalizeNextPath('//example.com'), '/summary');

console.log('auth tests passed');
