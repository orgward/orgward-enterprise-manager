import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { waitForProviderSocketConnection } from '../../src/execution/service.mjs';

test('HTTPS handoff waits for TLS secureConnect even after TCP connecting becomes false', () => {
  const socket = new EventEmitter();
  socket.connecting = false;
  socket.encrypted = true;
  socket.secureConnecting = true;
  let connected = false;
  waitForProviderSocketConnection(socket, 'https:', () => { connected = true; });
  assert.equal(connected, false);
  socket.emit('secureConnect');
  assert.equal(connected, true);
});

test('already secure HTTPS sockets and connected HTTP sockets are accepted at their protocol boundary', () => {
  const secureSocket = new EventEmitter();
  secureSocket.encrypted = true;
  secureSocket.secureConnecting = false;
  let secure = false;
  waitForProviderSocketConnection(secureSocket, 'https:', () => { secure = true; });
  assert.equal(secure, true);

  const httpSocket = new EventEmitter();
  httpSocket.connecting = false;
  let connected = false;
  waitForProviderSocketConnection(httpSocket, 'http:', () => { connected = true; });
  assert.equal(connected, true);
});
