#!/usr/bin/env node
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } from './constants.js';
import { ProfileStore } from './core/profile-store.js';
import { InstanceManager } from './launcher/instance-manager.js';
import { AppServer } from './server/app-server.js';
import { renderDashboardHtml } from './ui/dashboard.js';

function parseCliArgs(argv: string[]) {
  let port = Number(process.env.PORT) || DEFAULT_SERVER_PORT;
  let explicitPort = Boolean(process.env.PORT);
  let host = process.env.HOST || DEFAULT_SERVER_HOST;
  let dataDir = process.env.ANTI_MULTI_DATA_DIR || path.resolve(process.cwd(), 'data');
  let autoOpen = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--port' && argv[i + 1]) {
      port = Number(argv[i + 1]) || port;
      explicitPort = true;
      i += 1;
    } else if (arg.startsWith('--port=')) {
      port = Number(arg.split('=')[1]) || port;
      explicitPort = true;
    } else if (arg === '--host' && argv[i + 1]) {
      host = argv[i + 1]!;
      i += 1;
    } else if (arg === '--data-dir' && argv[i + 1]) {
      dataDir = path.resolve(argv[i + 1]!);
      i += 1;
    } else if (arg === '--no-open') {
      autoOpen = false;
    }
  }

  return { port, explicitPort, host, dataDir, autoOpen };
}

function probeExistingServer(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: host,
        port,
        path: '/api/state',
        timeout: 1500,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              ok?: boolean;
              profiles?: unknown[];
            };
            resolve(res.statusCode === 200 && parsed.ok === true && Array.isArray(parsed.profiles));
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function openBrowserUrl(url: string): void {
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
    } else if (process.platform === 'darwin') {
      const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
    } else {
      const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
    }
  } catch {
    // ignore browser auto-open failure
  }
}

async function main(): Promise<void> {
  const { port, explicitPort, host, dataDir, autoOpen } = parseCliArgs(process.argv.slice(2));

  const store = new ProfileStore(dataDir);
  const instanceManager = new InstanceManager(store);
  let activePort = port;
  let server = new AppServer({
    store,
    instanceManager,
    host,
    port: activePort,
    renderDashboardHtml,
  });

  let url: string;
  try {
    url = await server.start();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EADDRINUSE') {
      const alreadyRunning = await probeExistingServer(host, activePort);
      if (alreadyRunning) {
        const existingUrl = `http://${host}:${activePort}`;
        console.log(`[Anti-Multi] Server is already running at ${existingUrl}`);
        if (autoOpen && process.env.NODE_ENV !== 'test') {
          openBrowserUrl(existingUrl);
        }
        return;
      }
      if (!explicitPort) {
        activePort = 0;
        server = new AppServer({
          store,
          instanceManager,
          host,
          port: activePort,
          renderDashboardHtml,
        });
        url = await server.start();
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }
  console.log('==============================================================');
  console.log('  Anti-Multi Studio — Antigravity Multi-Account & Stealth Hub');
  console.log('==============================================================');
  console.log(`  Web Dashboard : ${url}`);
  console.log(`  Data Directory: ${store.getDataDir()}`);
  console.log(
    `  Executable    : ${store.getSettings().antigravityExecutablePath ?? '(Not detected)'}`,
  );
  console.log('==============================================================');

  if (autoOpen && process.env.NODE_ENV !== 'test') {
    openBrowserUrl(url);
  }

  const shutdown = async () => {
    console.log('\n[Anti-Multi] Shutting down server and active gateways...');
    await server.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('[Anti-Multi] Fatal startup error:', err);
  process.exit(1);
});
