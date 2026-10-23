import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import type { ProxyConfig } from '../types.js';

export interface OutboundRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
  proxy?: ProxyConfig;
  timeoutMs?: number;
}

export interface OutboundResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  text(): string;
  json<T = unknown>(): T;
}

/**
 * Establishes a raw TCP socket connected to `targetHost:targetPort` through a SOCKS5 proxy
 * using RFC 1928 + RFC 1929 (Username/Password auth) and ATYP=0x03 (domain name) so DNS
 * resolves on the proxy side without leaking locally.
 */
export function createSocks5Connection(
  proxy: ProxyConfig,
  targetHost: string,
  targetPort: number,
  timeoutMs = 15000,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({
      host: proxy.host,
      port: proxy.port,
    });

    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };

    const timer = setTimeout(() => {
      fail(new Error(`SOCKS5 proxy connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once('error', fail);

    const readBytes = (count: number): Promise<Buffer> =>
      new Promise((resRead, rejRead) => {
        let buf = Buffer.alloc(0);
        const onData = (chunk: Buffer) => {
          buf = Buffer.concat([buf, chunk]);
          if (buf.length >= count) {
            socket.removeListener('data', onData);
            socket.removeListener('error', onErr);
            const needed = buf.subarray(0, count);
            const extra = buf.subarray(count);
            if (extra.length > 0) {
              socket.unshift(extra);
            }
            resRead(needed);
          }
        };
        const onErr = (err: Error) => {
          socket.removeListener('data', onData);
          rejRead(err);
        };
        socket.on('data', onData);
        socket.once('error', onErr);
      });

    socket.once('connect', async () => {
      try {
        const hasAuth = Boolean(proxy.username);
        // 1. Greeting: VER=0x05, NMETHODS, METHODS (0x00 No Auth, 0x02 Username/Password)
        const greeting = hasAuth
          ? Buffer.from([0x05, 0x02, 0x00, 0x02])
          : Buffer.from([0x05, 0x01, 0x00]);
        socket.write(greeting);

        const methodReply = await readBytes(2);
        if (methodReply[0] !== 0x05) {
          throw new Error(`Invalid SOCKS5 version in greeting reply: ${methodReply[0]}`);
        }
        const chosenMethod = methodReply[1];
        if (chosenMethod === 0xff) {
          throw new Error('SOCKS5 proxy rejected all authentication methods');
        }

        // 2. RFC 1929 Username/Password subnegotiation if required
        if (chosenMethod === 0x02) {
          const userBuf = Buffer.from(proxy.username ?? '', 'utf8');
          const passBuf = Buffer.from(proxy.password ?? '', 'utf8');
          const authPacket = Buffer.concat([
            Buffer.from([0x01, userBuf.length]),
            userBuf,
            Buffer.from([passBuf.length]),
            passBuf,
          ]);
          socket.write(authPacket);
          const authReply = await readBytes(2);
          if (authReply[1] !== 0x00) {
            throw new Error('SOCKS5 proxy username/password authentication failed');
          }
        }

        // 3. CONNECT request: VER=0x05, CMD=0x01 (CONNECT), RSV=0x00, ATYP=0x03 (Domain)
        const hostBuf = Buffer.from(targetHost, 'utf8');
        const portBuf = Buffer.alloc(2);
        portBuf.writeUInt16BE(targetPort, 0);

        const connectReq = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
          hostBuf,
          portBuf,
        ]);
        socket.write(connectReq);

        const respHead = await readBytes(4);
        if (respHead[1] !== 0x00) {
          throw new Error(`SOCKS5 CONNECT failed with status code 0x${respHead[1]?.toString(16)}`);
        }

        const atyp = respHead[3];
        if (atyp === 0x01) {
          await readBytes(4 + 2);
        } else if (atyp === 0x03) {
          const lenByte = await readBytes(1);
          await readBytes(lenByte[0]! + 2);
        } else if (atyp === 0x04) {
          await readBytes(16 + 2);
        } else {
          throw new Error(`Unsupported SOCKS5 address type in reply: ${atyp}`);
        }

        clearTimeout(timer);
        socket.removeListener('error', fail);
        settled = true;
        resolve(socket);
      } catch (err) {
        clearTimeout(timer);
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

/**
 * Establishes a raw tunnel socket to `targetHost:targetPort` via an HTTP/HTTPS proxy
 * using the `CONNECT` method.
 */
export function createHttpConnectTunnel(
  proxy: ProxyConfig,
  targetHost: string,
  targetPort: number,
  timeoutMs = 15000,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Host: `${targetHost}:${targetPort}`,
      'Proxy-Connection': 'Keep-Alive',
    };
    if (proxy.username) {
      const credentials = Buffer.from(
        `${proxy.username}:${proxy.password ?? ''}`,
        'utf8',
      ).toString('base64');
      headers['Proxy-Authorization'] = `Basic ${credentials}`;
    }

    const reqFn = proxy.protocol === 'https' ? https.request : http.request;
    const req = reqFn({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers,
      timeout: timeoutMs,
    });

    req.once('connect', (res, socket, head) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`HTTP proxy CONNECT failed with status ${res.statusCode}`));
        return;
      }
      if (head && head.length > 0) {
        socket.unshift(head);
      }
      resolve(socket);
    });

    req.once('timeout', () => {
      req.destroy(new Error(`HTTP proxy CONNECT timed out after ${timeoutMs}ms`));
    });

    req.once('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

/**
 * Creates a custom `http.Agent` or `https.Agent` that routes through the given `ProxyConfig`.
 */
export async function createProxiedSocket(
  proxy: ProxyConfig,
  targetHost: string,
  targetPort: number,
  isTargetHttps: boolean,
  timeoutMs = 15000,
): Promise<net.Socket> {
  const rawSocket =
    proxy.protocol === 'socks5'
      ? await createSocks5Connection(proxy, targetHost, targetPort, timeoutMs)
      : await createHttpConnectTunnel(proxy, targetHost, targetPort, timeoutMs);

  if (!isTargetHttps) {
    return rawSocket;
  }

  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({
      socket: rawSocket,
      servername: net.isIP(targetHost) ? undefined : targetHost,
    });
    tlsSocket.once('secureConnect', () => {
      resolve(tlsSocket);
    });
    tlsSocket.once('error', (err) => {
      rawSocket.destroy();
      reject(err);
    });
  });
}

/**
 * Performs an HTTP/HTTPS request optionally routed through `options.proxy`.
 */
export async function requestViaProxy(options: OutboundRequestOptions): Promise<OutboundResponse> {
  const parsedUrl = new URL(options.url);
  const isHttps = parsedUrl.protocol === 'https:';
  const targetPort = Number(parsedUrl.port) || (isHttps ? 443 : 80);
  const timeoutMs = options.timeoutMs ?? 15000;
  const useProxy = Boolean(options.proxy?.enabled && options.proxy.host && options.proxy.port);

  let customAgent: http.Agent | undefined;
  if (useProxy && options.proxy) {
    const proxyCfg = options.proxy;
    const proxiedSocket = await createProxiedSocket(
      proxyCfg,
      parsedUrl.hostname,
      targetPort,
      isHttps,
      timeoutMs,
    );
    const AgentClass = isHttps ? https.Agent : http.Agent;
    customAgent = new AgentClass({ keepAlive: false });
    (customAgent as unknown as { createConnection: () => net.Socket }).createConnection = () =>
      proxiedSocket;
  }

  return new Promise((resolve, reject) => {
    const reqFn = isHttps ? https.request : http.request;
    const bodyBuf =
      options.body === undefined
        ? undefined
        : typeof options.body === 'string'
          ? Buffer.from(options.body, 'utf8')
          : options.body;

    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (bodyBuf && !headers['content-length'] && !headers['Content-Length']) {
      headers['Content-Length'] = String(bodyBuf.length);
    }

    const req = reqFn(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: targetPort,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: options.method ?? 'GET',
        headers,
        agent: customAgent,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const fullBody = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode ?? 500,
            headers: res.headers,
            body: fullBody,
            text: () => fullBody.toString('utf8'),
            json: <T = unknown>() => JSON.parse(fullBody.toString('utf8')) as T,
          });
        });
        res.on('error', reject);
      },
    );

    req.once('timeout', () => {
      req.destroy(new Error(`Request to ${options.url} timed out after ${timeoutMs}ms`));
    });
    req.once('error', reject);

    if (bodyBuf) {
      req.write(bodyBuf);
    }
    req.end();
  });
}

/**
 * Streams an outbound HTTP/HTTPS request (including SSE responses) to `clientRes`,
 * optionally routing through `options.proxy`.
 */
export async function forwardStreamViaProxy(
  options: OutboundRequestOptions,
  clientRes: http.ServerResponse,
): Promise<void> {
  const parsedUrl = new URL(options.url);
  const isHttps = parsedUrl.protocol === 'https:';
  const targetPort = Number(parsedUrl.port) || (isHttps ? 443 : 80);
  const timeoutMs = options.timeoutMs ?? 120000;
  const useProxy = Boolean(options.proxy?.enabled && options.proxy.host && options.proxy.port);

  let customAgent: http.Agent | undefined;
  if (useProxy && options.proxy) {
    const proxiedSocket = await createProxiedSocket(
      options.proxy,
      parsedUrl.hostname,
      targetPort,
      isHttps,
      20000,
    );
    const AgentClass = isHttps ? https.Agent : http.Agent;
    customAgent = new AgentClass({ keepAlive: false });
    (customAgent as unknown as { createConnection: () => net.Socket }).createConnection = () =>
      proxiedSocket;
  }

  return new Promise((resolve, reject) => {
    const reqFn = isHttps ? https.request : http.request;
    const bodyBuf =
      options.body === undefined
        ? undefined
        : typeof options.body === 'string'
          ? Buffer.from(options.body, 'utf8')
          : options.body;

    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (bodyBuf !== undefined) {
      headers['content-length'] = String(bodyBuf.length);
      delete headers['Content-Length'];
    }

    const upstreamReq = reqFn(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: targetPort,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: options.method ?? 'POST',
        headers,
        agent: customAgent,
        timeout: timeoutMs,
      },
      (upstreamRes) => {
        const resHeaders: http.OutgoingHttpHeaders = { ...upstreamRes.headers };
        clientRes.writeHead(upstreamRes.statusCode ?? 502, resHeaders);
        upstreamRes.pipe(clientRes);
        upstreamRes.once('end', () => resolve());
        upstreamRes.once('error', reject);
      },
    );

    upstreamReq.once('timeout', () => {
      upstreamReq.destroy(new Error(`Upstream stream timed out after ${timeoutMs}ms`));
    });
    upstreamReq.once('error', reject);

    if (bodyBuf && bodyBuf.length > 0) {
      upstreamReq.write(bodyBuf);
    }
    upstreamReq.end();
  });
}
