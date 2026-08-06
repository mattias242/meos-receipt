import test from 'node:test';
import assert from 'node:assert/strict';
import { lanUrls } from '../lib/lan.js';

// KRAV-12: vid start ska tjänsten visa adresser som löpare når via arenans wifi
test('lanUrls listar externa IPv4-adresser som http-URL:er', () => {
  const interfaces = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    'Wi-Fi': [
      { address: '192.168.1.42', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
    Ethernet: [{ address: '10.0.0.5', family: 'IPv4', internal: false }],
  };
  assert.deepEqual(lanUrls(3000, interfaces), [
    'http://192.168.1.42:3000',
    'http://10.0.0.5:3000',
  ]);
});

test('lanUrls hanterar Node-versioner där family är siffran 4', () => {
  const interfaces = {
    eth0: [{ address: '172.16.0.9', family: 4, internal: false }],
  };
  assert.deepEqual(lanUrls(8080, interfaces), ['http://172.16.0.9:8080']);
});

test('lanUrls utan externa gränssnitt ger tom lista', () => {
  const interfaces = { lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] };
  assert.deepEqual(lanUrls(3000, interfaces), []);
});
