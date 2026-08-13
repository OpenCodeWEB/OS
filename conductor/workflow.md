# OpenCodeWEB OS — Development Workflow

## Principles
1. **Context → Spec & Plan → Implement.** No code before an approved track spec.
2. **Test-driven.** Every change ships with tests; CI runs ruff + pytest.
3. **Zero-Constraint.** Never introduce limits, timeouts, quotas, or throttling into the OS.
4. **Self-healing.** The CI pipeline backs up pre-mutation, scans for secrets, and opens alert issues on failure.
5. **Dual authorship.** All commits carry `Co-authored-by: opencodeweb[bot] <311941023+opencodeweb[bot]@users.noreply.github.com>`.

## Branching
- Work on feature branches; `main` is protected.
- Every push to `main` triggers a pre-mutation backup branch.

## Commit Style
```
<type>: <summary>

<optional body>

Co-authored-by: opencodeweb[bot] <311941023+opencodeweb[bot]@users.noreply.github.com>
```

## Deployment
- Portal: `portal/` → Cloudflare Pages (`pocwu.pages.dev`)
- Gateway: `gateway/` → `opencodeweb.xup.workers.dev`
- Workers: `worker/`, `servers/` → Cloudflare Workers