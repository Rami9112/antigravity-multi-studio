#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } from './constants.js';
import { ProfileStore } from './core/profile-store.js';
import { InstanceManager } from './launcher/instance-manager.js';
import { AppServer } from './server/app-server.js';
import { renderDashboardHtml } from './ui/dashboard.js';

function parseCliArgs(argv: string[]) {
  let port = Number(process.env.PORT) || DEFAULT_SERVER_PORT;
  let host = process.env.HOST || DEFAULT_SERVER_HOST;
  let dataDir = process.env.ANTI_MULTI_DATA_DIR || path.resolve(process.cwd(), 'data');
  let autoOpen = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--port' && argv[i + 1]) {
      port = Number(argv[i + 1]) || port;
      i += 1;
    } else if (arg.startsWith('--port=')) {
      port = Number(arg.split('=')[1]) || port;
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

  return { port, host, dataDir, autoOpen };
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
  const { port, host, dataDir, autoOpen } = parseCliArgs(process.argv.slice(2));

  const store = new ProfileStore(dataDir);
  const instanceManager = new InstanceManager(store);
  const server = new AppServer({
    store,
    instanceManager,
    host,
    port,
    renderDashboardHtml,
  });

  const url = await server.start();
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
