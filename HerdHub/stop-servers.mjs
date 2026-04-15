#!/usr/bin/env node

/**
 * HerdHub Server Stopper - Cross Platform
 *
 * Stops all HerdHub servers (backend and frontend)
 * Kills processes on ports 5175 and 5176
 * Works on Windows, Linux, and macOS
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

// Configuration
const PORTS = [5176, 5175];

// Platform detection
const PLATFORM = {
  isWindows: os.platform() === 'win32',
  isLinux: os.platform() === 'linux',
  isMac: os.platform() === 'darwin'
};

// Colors for console output
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function colorize(text, color) {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

async function killProcessesOnPort(port) {
  console.log(colorize(`🔍 Checking port ${port}...`, 'cyan'));

  let killedCount = 0;

  try {
    if (PLATFORM.isWindows) {
      // Windows: use netstat and taskkill
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      const lines = stdout.trim().split('\n').filter(line => line.includes('LISTENING'));

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const pid = parts[parts.length - 1];
          if (pid && pid !== '0') {
            console.log(colorize(`   Killing PID ${pid}...`, 'yellow'));
            try {
              await execAsync(`taskkill /F /PID ${pid}`);
              console.log(colorize(`   ✓ Killed PID ${pid}`, 'green'));
              killedCount++;
            } catch (killError) {
              console.log(colorize(`   ⚠ Could not kill PID ${pid}`, 'yellow'));
            }
          }
        }
      }
    } else {
      // Unix/Linux/Mac: use lsof or fuser
      try {
        // Try lsof first
        const { stdout } = await execAsync(`lsof -ti:${port}`);
        const pids = stdout.trim().split('\n').filter(pid => pid.trim());

        for (const pid of pids) {
          if (pid) {
            console.log(colorize(`   Killing PID ${pid}...`, 'yellow'));
            try {
              await execAsync(`kill -9 ${pid}`);
              console.log(colorize(`   ✓ Killed PID ${pid}`, 'green'));
              killedCount++;
            } catch (killError) {
              console.log(colorize(`   ⚠ Could not kill PID ${pid}`, 'yellow'));
            }
          }
        }
      } catch (lsofError) {
        // Try fuser if lsof fails
        try {
          const { stdout } = await execAsync(`fuser ${port}/tcp 2>/dev/null || echo ''`);
          const pids = stdout.trim().split(/\s+/).filter(pid => pid.trim());

          for (const pid of pids) {
            if (pid) {
              console.log(colorize(`   Killing PID ${pid}...`, 'yellow'));
              try {
                await execAsync(`kill -9 ${pid}`);
                console.log(colorize(`   ✓ Killed PID ${pid}`, 'green'));
                killedCount++;
              } catch (killError) {
                console.log(colorize(`   ⚠ Could not kill PID ${pid}`, 'yellow'));
              }
            }
          }
        } catch (fuserError) {
          // Both commands failed, just continue
        }
      }
    }

    if (killedCount === 0) {
      console.log(colorize(`   ✓ No processes found on port ${port}`, 'green'));
    }

    return killedCount;
  } catch (error) {
    // No processes found on this port
    console.log(colorize(`   ✓ No processes found on port ${port}`, 'green'));
    return 0;
  }
}

async function killNodeServers() {
  console.log(colorize('🔍 Checking for HerdHub node.js servers...', 'cyan'));
  let killedCount = 0;

  try {
    if (PLATFORM.isWindows) {
      // Windows: get all node processes and check command line
      const { stdout } = await execAsync('tasklist | findstr node.exe');
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const pid = parts[1];
          try {
            const { stdout: wmicStdout } = await execAsync(`wmic process where "ProcessId=${pid}" get CommandLine`);
            const cmdLine = wmicStdout.toLowerCase();
            if (cmdLine.includes('server.js') || cmdLine.includes('vite') || cmdLine.includes('herdhub')) {
              console.log(colorize(`   Killing node server PID ${pid}...`, 'yellow'));
              await execAsync(`taskkill /F /PID ${pid}`);
              console.log(colorize(`   ✓ Killed node server`, 'green'));
              killedCount++;
            }
          } catch (e) {
            // Skip if we can't check command line
          }
        }
      }
    } else {
      // Unix/Linux/Mac: use ps and grep
      const { stdout } = await execAsync('ps aux | grep -E "(node|npm)" | grep -v grep || echo ""');
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        if (line.includes('server.js') || line.includes('vite') || line.includes('herdhub')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[1];
          if (pid) {
            console.log(colorize(`   Killing node server PID ${pid}...`, 'yellow'));
            try {
              await execAsync(`kill -9 ${pid}`);
              console.log(colorize(`   ✓ Killed node server`, 'green'));
              killedCount++;
            } catch (killError) {
              console.log(colorize(`   ⚠ Could not kill PID ${pid}`, 'yellow'));
            }
          }
        }
      }
    }

    if (killedCount === 0) {
      console.log(colorize('   ✓ No HerdHub node servers found', 'green'));
    }
  } catch (error) {
    // No node processes found
    console.log(colorize('   ✓ No node processes found', 'green'));
  }

  return killedCount;
}

async function checkPortFree(port) {
  try {
    if (PLATFORM.isWindows) {
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      return stdout.trim().length > 0;
    } else {
      try {
        const { stdout } = await execAsync(`lsof -ti:${port} 2>/dev/null || echo ''`);
        return stdout.trim().length > 0;
      } catch (error) {
        return false;
      }
    }
  } catch (error) {
    return false; // Port is free if command fails
  }
}

async function main() {
  console.log(colorize('\n════════════════════════════════════════', 'cyan'));
  console.log(colorize('    HERDHUB SERVER STOPPER', 'cyan'));
  console.log(colorize(`    Platform: ${os.platform()}`, 'cyan'));
  console.log(colorize('════════════════════════════════════════\n', 'cyan'));

  let totalKilled = 0;

  try {
    // Step 1: Kill processes on our ports
    console.log(colorize('Step 1: Killing processes on HerdHub ports...', 'blue'));
    for (const port of PORTS) {
      totalKilled += await killProcessesOnPort(port);
    }
    console.log();

    // Step 2: Kill node.js servers
    console.log(colorize('Step 2: Killing HerdHub node.js servers...', 'blue'));
    totalKilled += await killNodeServers();
    console.log();

    // Step 3: Verify ports are free
    console.log(colorize('Step 3: Verifying ports are free...', 'blue'));
    let allClear = true;

    for (const port of PORTS) {
      const stillInUse = await checkPortFree(port);
      if (stillInUse) {
        console.log(colorize(`   ❌ Port ${port} is still in use!`, 'red'));
        allClear = false;
      } else {
        console.log(colorize(`   ✓ Port ${port} is free`, 'green'));
      }
    }
    console.log();

    // Summary
    console.log(colorize('════════════════════════════════════════', 'cyan'));
    if (allClear) {
      console.log(colorize(`✅ ALL HERDHUB SERVERS STOPPED!`, 'green'));
      console.log(colorize(`   Stopped ${totalKilled} processes`, 'green'));
    } else {
      console.log(colorize(`⚠ SOME PROCESSES MAY STILL BE RUNNING`, 'yellow'));
      console.log(colorize('\nIf ports are still in use, try:', 'yellow'));
      if (PLATFORM.isWindows) {
        console.log(colorize('   1. Run this script as Administrator', 'yellow'));
        console.log(colorize('   2. Check: netstat -ano | findstr ":5176 :5175"', 'yellow'));
        console.log(colorize('   3. Use Task Manager to kill node.exe processes', 'yellow'));
      } else {
        console.log(colorize('   1. Run with sudo: sudo node stop-servers.mjs', 'yellow'));
        console.log(colorize('   2. Check: lsof -i :5176 -i :5175', 'yellow'));
        console.log(colorize('   3. Use system monitor to kill node processes', 'yellow'));
      }
    }
    console.log(colorize('════════════════════════════════════════\n', 'cyan'));

  } catch (error) {
    console.log(colorize(`\n❌ Error stopping servers: ${error.message}`, 'red'));
    process.exit(1);
  }
}

// Run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
