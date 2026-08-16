# Track: Gun Core — SEA.share() Zero-Knowledge ECDH Sharing

**Track ID:** `gun-core`
**Status:** In Progress
**Repo:** `github.com/OpenCodeWEB/Gun` (fork of `amark/gun`), local at `D:\OpenCodeWEB\Gun`
**Branding:** ABsUP (author), opencodeweb[bot] co-author trailer
**Policy:** Immutable Zero-Constraint — no limits, no quotas, no throttling.

## Goal

Deliver a first-class, upstream-viable **zero-knowledge multi-user sharing API** on top of
SEA (Security, Encryption, Authorization): `SEA.share(data, to, from)` and
`SEA.open(box, from, to)`. Data is encrypted with a random session secret, and that secret
is wrapped per-recipient using ECDH-derived keys — **no third party (relay, server, or
other peers) can read the plaintext; only the intended recipient's private key can unwrap
it.**

This is the first milestone of the wider GunDB improvement program (SEA ECDH → time-locked
encryption → RBAC → Python bridge → offline/vector → Yjs), per Gemini consultation
`7f8ae3fbafd2b766` and the ABsUP 4-category feature list.

## Current State (audited)

- `SEA.secret(key, pair)` — ECDH (P-256) shared-secret derivation. **Working.**
- `SEA.pair()` — generates `{pub, priv, epub, epriv}`. **Working.**
- `SEA.encrypt/SEA.decrypt` — AES-GCM with `SEA.` prefix envelope. **Working.**
- `User.prototype.grant(to, cb)` — deprecated ("MAY BE DELETED"), console.warn, callback
  style, stores wrapped secrets in the graph (`user.get('grant').get(pub).get(path)`).
  **Unstable; not upstream-viable as-is.**
- `User.prototype.secret(data, cb)` — deprecated twin for write path. **Unstable.**
- `User.prototype.pair()` — proxy-based pair accessor. **Working.**
- Build: `sea/*.js` modules compiled into `sea.js` via `node lib/unbuild.js sea`.
- Tests: mocha + `expect` in `test/sea/sea.js` (`npm run testsea`).
- Types: `types/` (tsd).

## Deliverables (Milestone 1)

1. **`SEA.share(data, to, from, cb, opt)`** → `Promise<Box>`
   - `data`: any JSON-serializable value.
   - `to`: recipient public key (string `epub`/`pub`) **or** array of recipient keys, **or**
     pair objects (resolves `epub`/`pub` from them). At least one recipient required.
   - `from`: sender's pair (`{pub, priv, epub, epriv}`). Requires `epub` + `epriv`.
   - Returns `{ box, s, k }` where:
     - `box` — plaintext encrypted (AES-256-GCM) under a fresh random session secret.
     - `s` — sender's `pub` (for recipient-side derivation).
     - `k` — map `{ <recipient pub>: <session secret wrapped via ECDH+AES> }`.
   - Zero-knowledge: relay/peers see only `box`, `s`, `k` — all ciphertext.
2. **`SEA.open(box, from, to, cb, opt)`** → `Promise<any>`
   - `box`: value from `SEA.share`.
   - `from`: sender `pub` (string) or sender pair.
   - `to`: recipient's pair (needs `epub` + `epriv`).
   - Derives the ECDH secret from `from` + `to`, unwraps the session secret, decrypts `box`.
   - Wrong key / tampered box → rejects (AES-GCM auth failure), never returns garbage.
3. **Deterministic, documented behavior** matching existing SEA conventions
   (module in `sea/share.js`, auto-loaded into the SEA bundle, Promise + optional callback).
4. **Tests** in `test/sea/share.js` covering:
   - Round-trip Alice→Bob (string, object, nested).
   - Multi-recipient (3 recipients; each can open; sender can open too via own pub).
   - Negative: wrong recipient cannot decrypt; tampered box rejected.
   - No `SEA.` prefix leaking into stored data (zero-knowledge check on raw box).
   - Callback style parity (cb receives same result).
5. **Types**: `types/sea.d.ts` updated with `share`/`open` signatures.

## Non-Functional Requirements

- **Backward compatible**: existing `grant`/`secret`/`trust` remain untouched (still
  deprecated); new API is additive (`SEA.share ||` pattern).
- **Zero-knowledge**: no plaintext or session secret ever touches the graph or relay.
- **Performance**: single box + N wrapped keys (O(N) ECDH ops, one AES op) — no
  re-encryption of payload per recipient.
- **Cross-platform**: works in Node and browser via existing `shim`/WebCrypto path.
- **Style**: matches repo conventions (`sea/*.js` IIFE modules, `require('./root')`,
  `SEA.x = SEA.x || (async (..) => { try{..}catch(e){..} })`).

## Out of Scope (later milestones)

- Time-locked / dead-man's switch encryption (`SEA.timelock`).
- RBAC roles node.
- User-level convenience (`user.grant` modernization) — revisit after upstream feedback.
- Yjs adapter, WebRTC mesh, Python bridge, offline queue, vector indexing.

## Acceptance Criteria

1. `npx mocha test/sea/share.js` — all new tests pass.
2. `npm run testsea` — existing SEA suite still green (no regression).
3. `node lib/unbuild.js sea` rebuilds `sea.js` cleanly; bundle exports `SEA.share`/`SEA.open`.
4. Browser smoke: `SEA.share`/`SEA.open` work in a page context (relay-independent).
