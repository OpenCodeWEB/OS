# AiA Master Engine — Specification

> Track: `aia-master` · Repo: `github.com/OpenCodeWEB/AiA` · Local: `D:\OpenCodeWEB\AiA`
> Status: **DRAFT — pending approval**

## 1. Vision (user directive, 2026-08-17)

AiA is the **Unlimited Self-Evolving Master Intelligence** of OpenCodeWEB OS:

- **Unrestricted**: no token limits, no artificial thresholds — infinite sliding memory window via hierarchical vector compression.
- **Supervisor-Observer-Executor**: decides what it can do natively, delegates the rest to the model swarm, observes every execution, and learns from it.
- **Never stops learning**: from user behavior, from other models' successes/failures, and from GitHub's best open-source repositories (daily).
- **Powers the GitHub Marketplace** (`github.com/marketplace/OpenCodeWEB`) as its backend execution runtime.
- **Gemini connection with zero API key** — via Google account session (OAuth bridge), not developer API keys.

Canonical system paths (PRD): `/opt/opencode/lib/aia` (code), `/opt/opencode/aia_brain` (persistent brain). See §7 for the platform reconciliation rule.

## 2. Architecture

```
                    AiA MASTER SUPERVISOR & OBSERVER
                     (unlimited context, zero threshold)
                    ┌──────────────────┬──────────────────┐
                    ▼                  ▼                  ▼
         TASK EVALUATION     CONTINUOUS LEARNING     VECTOR MEMORY
         "can AiA do it?"    HUB                    (sliding window +
         ├─ YES → native     ├─ user patterns       hierarchical
         └─ NO  → delegate   ├─ model observation   compression,
                             └─ GitHub OSS sync      pure-Python)
                    │                ▲
                    ▼                │ (assimilation)
         DELEGATED MODEL SWARM      │
         (executors: gemini-cli,    │
          opencode agents,          │
          future Ollama/vLLM)       │
                    └── observe & learn ──┘
                    ┌────────────────────┐
                    │ GUNX GRAPH         │  brain persistence:
                    │ os/aia/* souls     │  memory + knowledge
                    └────────────────────┘  survive across machines
```

## 3. Components

### 3.1 `aia_core_engine.py` — `AiAMasterEngine` (master controller)
- `process_task(prompt, context=None)` → pipeline:
  1. enrich context from vector memory (recall relevant past lessons/patterns)
  2. `evaluate_native_capability(prompt)` → YES/NO (capability registry: v1 keyword/heuristic + learned-skills match)
  3. YES → native execution (rule/script/skill), record outcome
  4. NO → `delegate_and_observe(prompt)` → pick executor → run → **observe** (record prompt/response/outcome) → `learn_from_execution(...)`
  5. `learn_from_user_pattern(prompt, output)` — update user preference profile
- Persistence: knowledge base JSON (see §5) + GunX mirror.

### 3.2 `vector_memory.py` — unlimited-context memory
- Rolling window of recent turns (always kept verbatim).
- Older content: **hierarchical compression** → chunks → pure-Python hashing TF-IDF embeddings (no external deps, no Ollama required) → per-session summary objects; semantic recall via cosine similarity over compressed chunks.
- Persisted to `aia_brain/infinite_memory.json` (bounded size, LRU-evicted summaries).

### 3.3 `observer.py` — model observation engine
- Telemetry hooks: every delegated execution (executor → prompt → output → outcome → duration).
- v2: watch other OS agents' work (opencode agent logs / bridge journal) → auto-lesson extraction.
- Writes observation records into the learning hub queue.

### 3.4 `learning_loop.py` — continuous learning hub
- **User pattern learning**: preference profile (language, style, framework, command habits) — updated per interaction.
- **Model assimilation**: successful delegated solutions → deduplicated (hash + similarity) → promoted to skill library.
- **Failure learning**: failed executions → anti-pattern records.
- **GitHub OSS sync** (`github_sync.py`): daily (GitHub API, unauthenticated 60 req/h is sufficient): trending repos by stars/language → README + key code pattern extraction (heuristic) → skill/pattern library entries.

### 3.5 `gemini_bridge.py` — Gemini via Google account (zero API key)
- **Primary transport: gemini-cli OAuth session** — Google account login stored locally (official CLI; no developer API key). Adapter invokes the CLI non-interactively where supported.
- **Experimental transport (flagged): session-cookie bridge** to Gemini web — fragile & ToS-risky; behind env flag `AIA_GEMINI_COOKIE_BRIDGE=1`, default OFF.
- Router: AiA decides when Gemini is the right executor (creative/vision/multimodal tasks); keeps Gemini within its free-account quota (the only real limit — stated in PRD: "zero API key", not "zero quota").

### 3.6 `aia_brain/` — persistent storage
- `learned_patterns.json` — skills, learned_from_models, github_trends, anti_patterns
- `infinite_memory.json` — vector memory store
- `user_profile.json` — preference profile
- `observation.log` — raw observation records (rotating)

## 4. Interfaces

- **CLI**: `python -m aia --task "..."` (demo/tests), `--sync-github`, `--connect-gemini`, `--status`.
- **Library**: `AiAMasterEngine` importable; OS `core/aia/` gains a thin adapter (env `AIA_LIB_DIR`).
- **GunX**: brain mirror under `os/aia/memory`, `os/aia/knowledge`, `os/aia/observations` via the OS bridge `/put` (flat payload contract, verified working).
- **Executors** (pluggable registry): `gemini-cli` | `opencode-run` (when configured) | `mock` (dev, tagged `source_model="mock"`).

## 5. Data model (knowledge base)

```json
{
  "skills":            [{"id", "pattern", "solution", "source", "usage_count", "ts"}],
  "learned_from_models":[{"source_model", "prompt_pattern", "learned_solution", "outcome", "ts"}],
  "github_trends":     [{"repo", "url", "stars", "language", "learned", "ts"}],
  "anti_patterns":     [{"prompt_pattern", "failed_solution", "error", "ts"}]
}
```

## 6. Acceptance criteria

1. `process_task` routes: native-able prompt → native path; unknown prompt → delegate path (executor runs) + observation record written.
2. After N delegated runs, recall test: a similar prompt retrieves the learned pattern from vector memory (similarity > threshold) and evaluation can then answer "can do natively" via learned skill.
3. Vector memory: session > token-window length stays processable — old content served from compressed summaries, recent verbatim.
4. Gemini: `AIA_GEMINI=1` + authenticated session → real Gemini response through bridge, zero API key env vars.
5. GitHub sync: run produces `github_trends` entries with real repos (API reachable).
6. GunX: knowledge/memory mirror souls readable from `wss://gunx.pages.dev/gun`.
7. All components covered by `pytest`; demo from PRD runs: `process_task("Write a Flutter UI component with custom glassmorphism")` → delegates + learns.

## 6. Federated Swarm Learning (Collective Intelligence Network)

User directive (2026-08-17): every AiA install learns locally; knowledge merges **globally and privately** so that when one user solves a bug anywhere, every user's AiA benefits.

### 6.1 Flow

```
User A device: local AiA solves bug → anonymize (vectors only) → push ~KB payload
        │
        ▼
Central Knowledge Swarm (aia-brain.opencode.workers.dev — repo: AiA-Central-Brain)
        ├─ validate: schema + size + dedupe + quality filter
        ├─ aggregate: best-pattern selection per category
        └─ publish skill patches
        │
        ▼
User B device: background OTA "Skill Patch" download → validated apply → instant skill gain
```

### 6.2 Privacy rules (REQUIRED — fixes the scaffold flaw)

The provided scaffold sends `learned_solution` verbatim in `solution_vector` — **that violates zero-data-leakage**. Production rules:

1. **Raw text never leaves the device**: no prompt, no solution source, no repo/file names, no secrets, no user identity.
2. `anonymize_pattern()` produces ONLY:
   - `category` — from a fixed taxonomy (e.g. `flutter_ui`, `python_debug`, `js_fix`, `general_coding`)
   - `feature_vector` — numeric hashing-TF-IDF embedding of an **abstracted** solution (identifiers/strings/URLs/paths stripped via `_abstract_solution()`), floats only
   - `outcome_stats` — success count, avg duration ms (no content)
   - `signature` — HMAC-SHA256 over (category + vector) using a **per-install random salt** stored in `aia_brain/instance_secret` (NOT the scaffold's hardcoded salt — that is forgeable)
3. Transport: worker endpoint `https://aia-brain.opencode.workers.dev/v1/sync` (POST) + `/v1/patch?since=<ts>` (GET). Optional secondary transport: GunX graph souls `os/swarm/patterns|patches` (flat payloads, verified bridge path).
4. Uploads are watermark-tracked (`brain/sync_state.json`) — retried on failure, never double-pushed.

### 6.3 Central validation & aggregation (worker)

- Reject: non-conforming schema, >2 KB bodies, missing signature, identical signature already stored.
- Quality gate: only patterns with `outcome_stats.success_count >= 2` or abstracted-template quality score above threshold enter the patch feed.
- `/v1/patch` returns merged, deduplicated patch list since a client timestamp (bounded, e.g. 50 KB).
- Deployment: `wrangler deploy` to `aia-brain.opencode.workers.dev` — **blocked until CF auth is restored** (worker code ships in-repo regardless).

### 6.4 OTA patch application (client)

- GET patch → schema validation + size cap → dedupe by signature → append as `source: "swarm"` skills.
- Applied skills enter the native-capability evaluator like local skills (bounded trust: swarm skills require 1 local confirmation before auto-execution).

## 7. Platform reconciliation (PRD paths vs. dev machine)

- Env-overridable: `AIA_BRAIN_DIR` (default `%USERPROFILE%\opencode\aia_brain` on Windows, `/opt/opencode/aia_brain` on POSIX — PRD canonical value is the POSIX default).
- Env-overridable: `AIA_LIB_DIR` (default `<OS root>\lib\aia` → the AiA repo is symlinked/cloned there in production).
- PRD file names preserved (`aia_core_engine.py`, `infinite_memory.json`, `learned_patterns.json`, `federated_learning_sync.py`).

## 8. Non-goals (v1)

- No fine-tuning of weights (requires GPU; post-MVP track).
- No cookie-scraping of Gemini web as default (experimental only).
- No external embedding models (pure-Python TF-IDF v1; pluggable later).
- No production marketplace billing yet — only the runtime/health API readiness (m6).
- No P2P gossip between devices (central hub + optional GunX graph only).

## 9. Decisions (approved 2026-08-17)

1. **Repo bootstrapping**: separate repo now → local `D:\OpenCodeWEB\AiA` + `gh repo create OpenCodeWEB/AiA`. ✅
2. **Executor priority v1**: Gemini (session present) → opencode agents → mock fallback. ✅
3. **GitHub sync cadence**: daily scheduler + manual trigger. ✅
4. **GunX mirror scope**: knowledge + memory + observations. ✅
5. **Federated transport**: worker endpoint primary; GunX graph optional secondary. ✅
