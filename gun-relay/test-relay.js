/**
 * GunDB relay smoke test — connects two in-process gun peers through
 * the relay and verifies real-time sync of a value.
 *
 *   node test-relay.js [relay-url]
 *   default: wss://absup:8765/gun
 */
const Gun = require("gun");
require("gun/sea");

const relayUrl = process.argv[2] || "wss://absup:8765/gun";

const gunA = Gun({ peers: [relayUrl], localStorage: false, file: false });
const gunB = Gun({ peers: [relayUrl], localStorage: false, file: false });

const KEY = "smoke/" + Date.now();
const VALUE = "hello-from-A-" + Date.now();
let received = false;

const timeout = setTimeout(() => {
  console.log("FAIL: no sync received within 12s");
  process.exit(1);
}, 12000);

gunB.get(KEY).on((data) => {
  if (data && data.msg === VALUE && !received) {
    received = true;
    clearTimeout(timeout);
    console.log("PASS: real-time sync through relay works");
    console.log("  relay:", relayUrl);
    console.log("  value:", data.msg);
    process.exit(0);
  }
});

setTimeout(() => {
  console.log("writing value…");
  gunA.get(KEY).put({ msg: VALUE });
}, 1500);