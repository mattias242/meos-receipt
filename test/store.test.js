import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.js';

// KRAV-8: konfigurerbar sparfördröjning så att data snabbt når disken
test('store persists to disk within saveDelayMs', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const store = createStore({ dataDir: dir, saveDelayMs: 10 });
  store.getCompetition(1).info.name = 'Test';
  store.touch(1);

  const file = path.join(dir, 'competitions.json');
  const deadline = Date.now() + 500;
  while (!fs.existsSync(file) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(fs.existsSync(file), 'competitions.json skrevs inte inom 500 ms');

  const reloaded = createStore({ dataDir: dir });
  assert.equal(reloaded.getCompetition(1).info.name, 'Test');
});
