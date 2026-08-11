var assert = require('assert');
var childProcess = require('child_process');
var path = require('path');

var app = require('../app');
var applicationCwd = path.join(__dirname, '..');
var applicationArgs = ['app.js'];

function applicationEnvironment(env) {
  var childEnv = Object.assign({}, process.env);
  delete childEnv.SBI_LOCAL_ONLY;
  delete childEnv.SBI_AUTH_PASSWORD;
  delete childEnv.SBI_JWT_SECRET;
  Object.assign(childEnv, env || {});
  childEnv.PORT = '0';
  return childEnv;
}

function productionStartup(env) {
  var childEnv = applicationEnvironment(env);
  childEnv.NODE_ENV = childEnv.NODE_ENV || 'production';

  return childProcess.spawnSync(process.execPath, applicationArgs, {
    cwd: applicationCwd,
    env: childEnv,
    encoding: 'utf8',
    timeout: 10000
  });
}

function acceptedStartup(env) {
  return new Promise(function (resolve, reject) {
    var output = '';
    var settled = false;
    var childEnv = applicationEnvironment(env);
    var child = childProcess.spawn(process.execPath, applicationArgs, {
      cwd: applicationCwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    function finish(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode == null) child.kill('SIGTERM');
      if (err) reject(err);
      else resolve(output);
    }

    child.stdout.on('data', function (chunk) {
      output += chunk;
      if (output.indexOf('Server is running') >= 0) finish();
    });
    child.stderr.on('data', function (chunk) { output += chunk; });
    child.on('error', finish);
    child.on('exit', function (code) {
      if (!settled) finish(new Error('Application exited before startup (' + code + '): ' + output));
    });

    var timer = setTimeout(function () {
      finish(new Error('Application startup timed out: ' + output));
    }, 10000);
  });
}

var missingCredentials = productionStartup();
assert.notStrictEqual(missingCredentials.status, 0);
assert.match(missingCredentials.stderr, /SBI_AUTH_PASSWORD is required/);

var credentialFreeImport = childProcess.spawnSync(process.execPath, ['-e', "require('./app'); process.stdout.write('imported')"], {
  cwd: applicationCwd,
  env: applicationEnvironment(),
  encoding: 'utf8',
  timeout: 10000
});
assert.strictEqual(credentialFreeImport.status, 0);
assert.strictEqual(credentialFreeImport.stdout, 'imported');

var implicitDevelopment = productionStartup({ NODE_ENV: 'development' });
assert.notStrictEqual(implicitDevelopment.status, 0);
assert.match(implicitDevelopment.stderr, /SBI_AUTH_PASSWORD is required/);

var weakPassword = productionStartup({
  SBI_AUTH_PASSWORD: 'admin',
  SBI_JWT_SECRET: 'production-jwt-secret-that-is-long-enough'
});
assert.notStrictEqual(weakPassword.status, 0);
assert.match(weakPassword.stderr, /SBI_AUTH_PASSWORD is insecure/);
assert.doesNotMatch(weakPassword.stderr, /production-jwt-secret-that-is-long-enough/);

var missingJwtSecret = productionStartup({
  SBI_AUTH_PASSWORD: 'production-password'
});
assert.notStrictEqual(missingJwtSecret.status, 0);
assert.match(missingJwtSecret.stderr, /SBI_JWT_SECRET is required/);
assert.doesNotMatch(missingJwtSecret.stderr, /production-password/);

var weakJwtSecret = productionStartup({
  SBI_AUTH_PASSWORD: 'production-password',
  SBI_JWT_SECRET: 'secret'
});
assert.notStrictEqual(weakJwtSecret.status, 0);
assert.match(weakJwtSecret.stderr, /SBI_JWT_SECRET is insecure/);
assert.doesNotMatch(weakJwtSecret.stderr, /production-password/);

var sharedCredential = 'one-long-credential-must-not-be-reused';
var equalSecrets = productionStartup({
  SBI_AUTH_PASSWORD: sharedCredential,
  SBI_JWT_SECRET: sharedCredential
});
assert.notStrictEqual(equalSecrets.status, 0);
assert.match(equalSecrets.stderr, /SBI_JWT_SECRET must differ/);
assert.doesNotMatch(equalSecrets.stderr, new RegExp(sharedCredential));

assert.strictEqual(app.appVersion, require('../package.json').version);

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

Promise.all([
  acceptedStartup({
    NODE_ENV: 'development',
    SBI_LOCAL_ONLY: 'true',
    SBI_AUTH_PASSWORD: '',
    SBI_JWT_SECRET: ''
  }).then(function (output) {
    assert.match(output, /Server is running on 127\.0\.0\.1/);
  }),
  acceptedStartup({
    NODE_ENV: 'production',
    SBI_LOCAL_ONLY: 'false',
    SBI_AUTH_PASSWORD: 'production-password',
    SBI_JWT_SECRET: 'production-jwt-secret-that-is-long-enough'
  }).then(function (output) {
    assert.match(output, /Server is running on 0\.0\.0\.0/);
  })
]).then(function () {
  console.log('auth tests passed');
}).catch(function (err) {
  console.error(err.stack || err);
  process.exitCode = 1;
});
