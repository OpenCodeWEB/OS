# Plan — Gun Core: SEA.share() Zero-Knowledge ECDH Sharing

**Track:** `gun-core` | **Repo:** `D:\OpenCodeWEB\Gun` (fork `OpenCodeWEB/Gun`)

## Steps

| # | Step | Detail | Verify |
| :--- | :--- | :--- | :--- |
| 1 | Track registration | spec.md, plan.md, metadata.json, update `conductor/tracks.md` | Files exist, registry updated |
| 2 | Tests first (TDD) | `test/sea/share.js`: round-trip, multi-recipient, negative (wrong key, tamper), zero-knowledge shape, callback parity | `npx mocha test/sea/share.js` → 2 fail (API missing) |
| 3 | Implement | `sea/share.js`: add `SEA.share` + `SEA.open` (session secret = `SEA.random(16)` → base64; wrap via `SEA.secret(recipientPub, from)` + `SEA.encrypt`; box via `SEA.encrypt(data, sec)`; `s` = `from.pub`; recipient resolution accepts string/pair/array) | Tests green |
| 4 | Rebuild bundle | `node lib/unbuild.js sea` | `sea.js` regenerated, contains share/open |
| 5 | Regression | `npm run testsea` (existing suite) | All green |
| 6 | Types | `types/sea.d.ts`: add `share`, `open` declarations | `npx tsd` style check / visual |
| 7 | Browser smoke | Local page via relay or file: verify share/open in browser path | Manual/Playwright |
| 8 | Branch + commit (on approval) | `feat/sea-share` branch, dual-author trailer, push to `OpenCodeWEB/Gun` | git log |
| 9 | Upstream prep (on approval) | Draft PR description + issue in `amark/gun` as ABsUP | PR link |

## Key Design

```
Alice:  sec = SEA.random(16)                  // session secret (never leaves client)
        box = SEA.encrypt(data, sec)          // one AES-GCM op
        k[pubB] = SEA.encrypt(sec, SEA.secret(pubB, alicePair))   // per-recipient wrap
        return { box, s: alicePair.pub, k }

Bob:    sec = SEA.decrypt(box.k[bobPub], SEA.secret(box.s, bobPair))
        data = SEA.decrypt(box.box, sec)
```

Zero-knowledge by construction: relay holds only `box`, `s`, `k` — all ciphertext.

## Risks / Mitigations

- **ECDH unavailability in odd envs** (SEA already degrades) → guard: require `epub`+`epriv`
  on `from`/`to`, reject early with clear error.
- **Backward compat** → additive `SEA.x = SEA.x ||` pattern; leave `grant/secret/trust` as-is.
- **Non-serializable data** → `SEA.encrypt` already JSON-stringifies; no extra handling.
- **Empty/invalid recipients** → throw "No recipient." early.
