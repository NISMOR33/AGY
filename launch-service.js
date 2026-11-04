const { execFileSync } = require('child_process');
const path = require('path');

const dir = __dirname;
const cmd = `node "${path.join(dir, 'supervisor.js')}"`;
const psCmd = `($r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='${cmd.replace(/'/g, "''")}'; CurrentDirectory='${dir.replace(/'/g, "''")}'}).ProcessId`;

try {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', psCmd], { encoding: 'utf8' }).trim();
  console.log('AUTONOMOUS_SUPERVISOR_PID:', out);
} catch (e) {
  console.error('FAILED:', e.message);
}
