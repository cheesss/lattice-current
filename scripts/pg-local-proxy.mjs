#!/usr/bin/env node
/**
 * pg-local-proxy.mjs — NAS PostgreSQL을 localhost로 프록시
 *
 * Codex sandbox가 외부 IP(192.168.0.76)를 차단하므로,
 * localhost:15433 → 192.168.0.76:5433 TCP 프록시를 실행합니다.
 *
 * Usage:
 *   node scripts/pg-local-proxy.mjs &          # 백그라운드 실행
 *   PG_HOST=localhost PG_PORT=15433 codex exec  # Codex에서 접근
 */

import net from 'net';
import { loadOptionalEnvFile } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();

const REMOTE_HOST = process.env.PG_HOST || '192.168.0.76';
const REMOTE_PORT = Number(process.env.PG_PORT || 5433);
const LOCAL_PORT = Number(process.env.PG_PROXY_PORT || 15433);

const server = net.createServer(clientSocket => {
  const remoteSocket = net.createConnection({ host: REMOTE_HOST, port: REMOTE_PORT }, () => {
    clientSocket.pipe(remoteSocket);
    remoteSocket.pipe(clientSocket);
  });
  remoteSocket.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => remoteSocket.destroy());
  remoteSocket.on('close', () => clientSocket.destroy());
  clientSocket.on('close', () => remoteSocket.destroy());
});

server.listen(LOCAL_PORT, '127.0.0.1', () => {
  console.log(`PG proxy: localhost:${LOCAL_PORT} → ${REMOTE_HOST}:${REMOTE_PORT}`);
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Port ${LOCAL_PORT} already in use — proxy may already be running`);
    process.exit(0);
  }
  console.error(e);
  process.exit(1);
});
