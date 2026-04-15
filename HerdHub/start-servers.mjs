#!/usr/bin/env node

/**
 * HerdHub Server Manager - Cross Platform
 *
 * Starts both backend (Express API) and frontend (Vite dev server)
 * Kills existing processes on ports 5175 and 5176 first
 * Runs servers in background with proper logging
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

// Configuration
const CONFIG = {
  ports: {
    backend: 5176,
    frontend: 5175
  },
  logs: {
    backend: path.join(__dirname, 'server.log'),
    frontend: path.join(__dirname, 'vite.log'),
    combined: path.join(__dirname, 'servers.log')
  },
  timeout: {
    portCheck: 30000,
    startup: 10000
  }
};

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

class ServerManager {
  constructor() {
    this.backendProcess = null;
    this.frontendProcess = null;
    this.isShuttingDown = false;
  }

  async killExistingServers() {
    console.log(colorize('🔍 Checking for existing servers...', 'cyan'));

    try {
      // Kill processes using our ports
      for (const [name, port] of Object.entries(CONFIG.ports)) {
        await this.killProcessOnPort(port, name);
      }

      // Kill any node processes running our servers
      await this.killNodeServers();

      console.log(colorize('✅ Cleanup complete', 'green'));
    } catch (error) {
      console.log(colorize(`⚠ Warning during cleanup: ${error.message}`, 'yellow'));
    }
  }

  async killProcessOnPort(port, name) {
    console.log(colorize(`   Checking port ${port} (${name})...`, 'gray'));

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
              console.log(colorize(`     Killing PID ${pid}...`, 'yellow'));
              try {
                await execAsync(`taskkill /F /PID ${pid}`);
                console.log(colorize(`     ✓ Killed PID ${pid}`, 'green'));
              } catch (killError) {
                console.log(colorize(`     ⚠ Could not kill PID ${pid}`, 'yellow'));
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
              console.log(colorize(`     Killing PID ${pid}...`, 'yellow'));
              try {
                await execAsync(`kill -9 ${pid}`);
                console.log(colorize(`     ✓ Killed PID ${pid}`, 'green'));
              } catch (killError) {
                console.log(colorize(`     ⚠ Could not kill PID ${pid}`, 'yellow'));
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
                console.log(colorize(`     Killing PID ${pid}...`, 'yellow'));
                try {
                  await execAsync(`kill -9 ${pid}`);
                  console.log(colorize(`     ✓ Killed PID ${pid}`, 'green'));
                } catch (killError) {
                  console.log(colorize(`     ⚠ Could not kill PID ${pid}`, 'yellow'));
                }
              }
            }
          } catch (fuserError) {
            // Both commands failed, just continue
          }
        }
      }
    } catch (error) {
      // No process found on this port, which is fine
    }
  }

  async killNodeServers() {
    console.log(colorize('   Checking for node.js servers...', 'gray'));

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
              if (cmdLine.includes('server.js') || cmdLine.includes('vite')) {
                console.log(colorize(`     Killing node server PID ${pid}...`, 'yellow'));
                await execAsync(`taskkill /F /PID ${pid}`);
                console.log(colorize(`     ✓ Killed node server`, 'green'));
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
          if (line.includes('server.js') || line.includes('vite')) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[1];
            if (pid) {
              console.log(colorize(`     Killing node server PID ${pid}...`, 'yellow'));
              try {
                await execAsync(`kill -9 ${pid}`);
                console.log(colorize(`     ✓ Killed node server`, 'green'));
              } catch (killError) {
                console.log(colorize(`     ⚠ Could not kill PID ${pid}`, 'yellow'));
              }
            }
          }
        }
      }
    } catch (error) {
      // No node processes found, which is fine
    }
  }

  async waitForPort(port, timeout = CONFIG.timeout.portCheck) {
    const startTime = Date.now();
    const net = await import('net');

    return new Promise((resolve, reject) => {
      const checkPort = () => {
        if (Date.now() - startTime > timeout) {
          reject(new Error(`Timeout waiting for port ${port}`));
          return;
        }

        const socket = new net.Socket();
        socket.setTimeout(1000);

        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });

        socket.on('timeout', () => {
          socket.destroy();
          setTimeout(checkPort, 500);
        });

        socket.on('error', () => {
          socket.destroy();
          setTimeout(checkPort, 500);
        });

        socket.connect(port, 'localhost');
      };

      checkPort();
    });
  }

  startBackend() {
    return new Promise((resolve, reject) => {
      console.log(colorize('🚀 Starting backend server...', 'blue'));

      const backendLog = fs.createWriteStream(CONFIG.logs.backend, { flags: 'a' });
      const combinedLog = fs.createWriteStream(CONFIG.logs.combined, { flags: 'a' });

      const timestamp = new Date().toISOString();
      backendLog.write(`\n\n=== Backend started at ${timestamp} ===\n`);
      combinedLog.write(`\n\n=== Backend started at ${timestamp} ===\n`);

      this.backendProcess = spawn('node', ['server.js'], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: PLATFORM.isWindows,
        env: { ...process.env, NODE_ENV: 'development' }
      });

      // Log output
      this.backendProcess.stdout.on('data', (data) => {
        const output = data.toString();
        backendLog.write(output);
        combinedLog.write(`[BACKEND] ${output}`);

        if (output.includes('HerdHub → http://localhost:5176')) {
          console.log(colorize('   ✓ Backend server started', 'green'));
        }

        // Only show important messages in console
        if (output.includes('HerdHub →') || output.includes('Thumbnails ready') || output.includes('ERROR') || output.includes('❌')) {
          process.stdout.write(colorize('[BACKEND] ', 'magenta') + output);
        }
      });

      this.backendProcess.stderr.on('data', (data) => {
        const output = data.toString();
        backendLog.write(`[ERROR] ${output}`);
        combinedLog.write(`[BACKEND ERROR] ${output}`);
        process.stderr.write(colorize('[BACKEND ERROR] ', 'red') + output);
      });

      this.backendProcess.on('close', (code) => {
        if (!this.isShuttingDown) {
          console.log(colorize(`❌ Backend server exited with code ${code}`, 'red'));
          this.cleanup();
        }
      });

      this.backendProcess.on('error', (err) => {
        console.log(colorize(`❌ Failed to start backend: ${err.message}`, 'red'));
        reject(err);
      });

      // Wait for server to be ready
      setTimeout(() => {
        this.waitForPort(CONFIG.ports.backend, 15000)
          .then(() => resolve())
          .catch(err => {
            console.log(colorize(`⚠ Backend might not be fully ready: ${err.message}`, 'yellow'));
            resolve(); // Still resolve so frontend can start
          });
      }, 2000);
    });
  }

  startFrontend() {
    return new Promise((resolve, reject) => {
      console.log(colorize('🚀 Starting frontend server...', 'blue'));

      const frontendLog = fs.createWriteStream(CONFIG.logs.frontend, { flags: 'a' });
      const combinedLog = fs.createWriteStream(CONFIG.logs.combined, { flags: 'a' });

      const timestamp = new Date().toISOString();
      frontendLog.write(`\n\n=== Frontend started at ${timestamp} ===\n`);
      combinedLog.write(`\n\n=== Frontend started at ${timestamp} ===\n`);

      this.frontendProcess = spawn('npm', ['run', 'dev'], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: PLATFORM.isWindows,
        env: { ...process.env, FORCE_COLOR: 'true' }
      });

      // Log output
      this.frontendProcess.stdout.on('data', (data) => {
        const output = data.toString();
        frontendLog.write(output);
        combinedLog.write(`[FRONTEND] ${output}`);

        if (output.includes('Local:') && output.includes('http://localhost:5175/')) {
          console.log(colorize('   ✓ Frontend server started', 'green'));
        }

        // Only show important messages in console
        if (output.includes('Local:') || output.includes('VITE') || output.includes('ERROR') || output.includes('failed')) {
          process.stdout.write(colorize('[FRONTEND] ', 'cyan') + output);
        }
      });

      this.frontendProcess.stderr.on('data', (data) => {
        const output = data.toString();
        frontendLog.write(`[ERROR] ${output}`);
        combinedLog.write(`[FRONTEND ERROR] ${output}`);
        process.stderr.write(colorize('[FRONTEND ERROR] ', 'red') + output);
      });

      this.frontendProcess.on('close', (code) => {
        if (!this.isShuttingDown) {
          console.log(colorize(`❌ Frontend server exited with code ${code}`, 'red'));
          this.cleanup();
        }
      });

      this.frontendProcess.on('error', (err) => {
        console.log(colorize(`❌ Failed to start frontend: ${err.message}`, 'red'));
        reject(err);
      });

      // Wait for server to be ready
      setTimeout(() => {
        this.waitForPort(CONFIG.ports.frontend, 15000)
          .then(() => resolve())
          .catch(err => {
            console.log(colorize(`⚠ Frontend might not be fully ready: ${err.message}`, 'yellow'));
            resolve(); // Still resolve
          });
      }, 2000);
    });
  }

  cleanup() {
    this.isShuttingDown = true;

    if (this.backendProcess) {
      this.backendProcess.kill('SIGTERM');
    }

    if (this.frontendProcess) {
      this.frontendProcess.kill('SIGTERM');
    }
  }

  async start() {
    console.log(colorize('\n════════════════════════════════════════', 'cyan'));
    console.log(colorize('    HERDHUB SERVER MANAGER', 'cyan'));
    console.log(colorize(`    Platform: ${os.platform()}`, 'cyan'));
    console.log(colorize('════════════════════════════════════════\n', 'cyan'));

    try {
      // Step 1: Kill existing servers
      await this.killExistingServers();

      // Step 2: Start backend
      await this.startBackend();

      // Step 3: Start frontend
      await this.startFrontend();

      // Step 4: Verify servers
      console.log(colorize('\n🔍 Verifying servers...', 'cyan'));

      try {
        await this.waitForPort(CONFIG.ports.backend, 5000);
        console.log(colorize(`   ✓ Backend (port ${CONFIG.ports.backend}) is responding`, 'green'));
      } catch (err) {
        console.log(colorize(`   ⚠ Backend verification failed: ${err.message}`, 'yellow'));
      }

      try {
        await this.waitForPort(CONFIG.ports.frontend, 5000);
        console.log(colorize(`   ✓ Frontend (port ${CONFIG.ports.frontend}) is responding`, 'green'));
      } catch (err) {
        console.log(colorize(`   ⚠ Frontend verification failed: ${err.message}`, 'yellow'));
      }

      console.log(colorize('\n✅ Servers started successfully!', 'green'));
      console.log(colorize('\n📊 Server URLs:', 'cyan'));
      console.log(colorize(`   Backend API:  http://localhost:${CONFIG.ports.backend}`, 'magenta'));
      console.log(colorize(`   Frontend App: http://localhost:${CONFIG.ports.frontend}`, 'cyan'));
      console.log(colorize('\n📁 Log files:', 'cyan'));
      console.log(colorize(`   Backend:  ${CONFIG.logs.backend}`, 'magenta'));
      console.log(colorize(`   Frontend: ${CONFIG.logs.frontend}`, 'cyan'));
      console.log(colorize(`   Combined: ${CONFIG.logs.combined}`, 'blue'));
      console.log(colorize('\n🛑 Press Ctrl+C to stop all servers', 'yellow'));
      console.log(colorize('════════════════════════════════════════\n', 'cyan'));

      // Handle Ctrl+C
      process.on('SIGINT', () => {
        console.log(colorize('\n🛑 Shutting down servers...', 'yellow'));
        this.cleanup();
        console.log(colorize('✅ Servers stopped', 'green'));
        process.exit(0);
      });

      // Keep process alive
      process.stdin.resume();

    } catch (error) {
      console.log(colorize(`\n❌ Failed to start servers: ${error.message}`, 'red'));
      this.cleanup();
      process.exit(1);
    }
  }
}

// Run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const manager = new ServerManager();
  manager.start();
}

export default ServerManager;
