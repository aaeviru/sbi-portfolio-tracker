var assert = require('assert');

async function main() {
  var verifyLinuxRuntime = require('../scripts/verify-linux-runtime').verifyLinuxRuntime;
  var result = await verifyLinuxRuntime();

  assert.strictEqual(result.sqliteValue, 'linux-ok');
  assert.strictEqual(result.applicationStarted, true);
}

main().then(function () {
  console.log('linux runtime tests passed');
}).catch(function (err) {
  console.error(err.stack || err);
  process.exitCode = 1;
});
