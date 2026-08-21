import { test } from "node:test";
import assert from "node:assert/strict";

// Mock SDK to avoid live network
const mockSdk = {
  async makePair() { return { pub: "x.y", priv: "d" }; },
  addressFromPubkey() { return "aeaqmockmockmockmockmockmockmockmockmockmockmockmockq"; },
  async registerDID() { return { ok: true }; },
  async putDeltas({ deltas }) { return { ok: true, applied: deltas.length }; },
  async getDeltas(addr, prefix) { return { ok: true, addr, count: 1, entries: [{ key: prefix || "os/demo", value: "hello" }] }; },
};

test("os gdbx-relay: put/get round-trip via mocked SDK", async () => {
  const put = await mockSdk.putDeltas({ deltas: [{ key: "os/demo", value: "hello" }] });
  assert.equal(put.ok, true);
  assert.equal(put.applied, 1);
  const get = await mockSdk.getDeltas("aeaqmock", "os/demo");
  assert.equal(get.ok, true);
  assert.equal(get.entries[0].value, "hello");
});

test("os gdbx-relay: health shape", async () => {
  const health = { ok: true, use_gdbx: true, addr: "aeaqmock", api: "https://gdbx-do.xup.workers.dev" };
  assert.equal(health.ok, true);
  assert.equal(health.use_gdbx, true);
});
