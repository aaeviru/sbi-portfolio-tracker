var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var sqlite3 = require('sqlite3').verbose();

function verifySqlite(databasePath) {
  return new Promise(function (resolve, reject) {
    var db = new sqlite3.Database(databasePath, function (openErr) {
      if (openErr) {
        reject(openErr);
        return;
      }
      db.serialize(function () {
        db.run('CREATE TABLE runtime_check (value TEXT NOT NULL)');
        db.run('INSERT INTO runtime_check (value) VALUES (?)', ['linux-ok']);
        db.get('SELECT value FROM runtime_check LIMIT 1', function (readErr, row) {
          db.close(function (closeErr) {
            if (readErr || closeErr) {
              reject(readErr || closeErr);
              return;
            }
            resolve(row.value);
          });
        });
      });
    });
  });
}

function verifyApplicationStarts(databasePath) {
  return new Promise(function (resolve, reject) {
    var output = '';
    var settled = false;
    var child = childProcess.spawn(process.execPath, ['app.js'], {
      cwd: path.join(__dirname, '..'),
      env: Object.assign({}, process.env, { PORT: '0', SBI_PORTFOLIO_DB_PATH: databasePath }),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    function finish(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode == null) child.kill('SIGTERM');
      if (err) reject(err);
      else resolve(true);
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

async function verifyLinuxRuntime() {
  if (process.platform != 'linux') {
    throw new Error('Linux runtime verification must run on Linux.');
  }

  var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbi-linux-runtime-'));
  var databasePath = path.join(tempDir, 'runtime.sqlite');
  try {
    var sqliteValue = await verifySqlite(databasePath);
    var applicationStarted = await verifyApplicationStarts(databasePath);
    return { sqliteValue: sqliteValue, applicationStarted: applicationStarted };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  verifyLinuxRuntime().then(function (result) {
    console.log('Linux runtime verification passed:', JSON.stringify(result));
  }).catch(function (err) {
    console.error(err.stack || err);
    process.exitCode = 1;
  });
}

module.exports = {
  verifyLinuxRuntime: verifyLinuxRuntime
};
