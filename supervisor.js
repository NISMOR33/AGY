const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOME = os.homedir();
const CONF_DIR = path.join(HOME, '.agy-console');
const LOG_FILE = path.join(CONF_DIR, 'server.log');
const SERVER_JS = path.join(__dirname, 'server.js');

try { fs.mkdirSync(CONF_DIR, { recursive: true }); } catch {}

function log(msg) {
  const line = `[${new Date().toISOString()}] [supervisor] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}

log('Supervisor démarré (PID=' + process.pid + ')');

let restarting = false;
function runServer() {
  log('Lancement de node server.js...');
  const outFd = fs.openSync(LOG_FILE, 'a');
  const errFd = fs.openSync(LOG_FILE, 'a');

  const child = spawn(process.execPath, [SERVER_JS], {
    cwd: __dirname,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', outFd, errFd],
    windowsHide: true
  });

  log('server.js lancé avec PID=' + child.pid);

  child.on('exit', (code, signal) => {
    try { fs.closeSync(outFd); } catch {}
    try { fs.closeSync(errFd); } catch {}
    log(`server.js s'est arrêté (code=${code}, signal=${signal}). Redémarrage automatique dans 1 seconde...`);
    if (!restarting) {
      restarting = true;
      setTimeout(() => {
        restarting = false;
        runServer();
      }, 1000);
    }
  });

  child.on('error', err => {
    log('Erreur de spawn server.js: ' + err.message);
  });
}

runServer();

// Garder le superviseur actif en continu
setInterval(() => {}, 60000);

