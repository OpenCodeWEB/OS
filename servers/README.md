# OpenCodeWEB Servers

Central backend infrastructure for the OpenCodeWEB ecosystem.

- **Gateway worker:** `src/index.ts` → deployed at `https://opencodewebservers.xup.workers.dev`
- **Routes:**
  - `GET /api/sandbox/preview` — Owner-only sandbox preview stage (`Authorization: Bearer <OWNER_SECRET_TOKEN>`)
  - `GET /api/public/list` — Public auto-index registry for `pocwu.pages.dev/S`
  - `GET /health` — Gateway health probe
- **Deployment:** Cloudflare Workers (`wrangler deploy`); CI in `.github/workflows/`

## Required secrets

| Secret               | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `WEBHOOK_SECRET`     | GitHub webhook HMAC verification secret         |
| `OWNER_SECRET_TOKEN` | Owner (ABsUP) token for private sandbox preview |

## Local development

```sh
npm i -g wrangler
wrangler dev
```

## Deploy

```sh
wrangler deploy
```

> Authoring standard: automated git mutations append the OpenCodeWEB[bot] +
> ABsUP dual-authorship commit trailer defined in the PRD.