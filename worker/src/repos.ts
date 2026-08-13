/**
 * POST /repos — Create a GitHub repository on behalf of an installation.
 *
 * GitHub platform rule: GitHub Apps CANNOT create repositories in USER
 * accounts. They CAN create repositories in ORGANIZATIONS where the app
 * is installed and has `administration: write`.
 *
 * Request body (JSON):
 *   {
 *     "owner": "OpenCodeWEB",          // organization login (required)
 *     "name": "my-new-repo",           // repo name (required)
 *     "description": "…",              // optional
 *     "private": false,                // optional, default false
 *     "autoInit": true,                // optional, default true
 *   }
 *
 * The installation ID is ALWAYS resolved server-side from KV for `owner` —
 * a client-supplied installationId is never trusted (prevents cross-tenant
 * repo creation once the app is public).
 *
 * Response 201:
 *   { ok, fullName, htmlUrl, defaultBranch, private, createdAt, installation }
 *
 * Errors:
 *   400 — missing owner/name
 *   403 — app not installed on owner / account not authorized
 *   404 — installation not found
 *   409 — repo already exists
 *   502 — GitHub API failure
 */

import type { Env, InstallRecord } from "./_shared.js";
import { json } from "./_shared.js";
import { isAccountAllowed } from "./_shared.js";
import { generateAppJwt, getInstallationToken } from "../../src/auth/github.js";
import type { GitHubAppConfig } from "../../src/auth/github.js";
import { githubFetch } from "../../src/github-api.js";

const GITHUB_API = "https://api.github.com";
const KV_PREFIX = "ag_install:";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Build the GitHubAppConfig from env vars + installation ID. */
function buildAppConfig(env: Env, installationId: string): GitHubAppConfig {
  return {
    appId: env.APP_ID!,
    privateKey: env.PRIVATE_KEY!,
    installationId,
  };
}

/** Resolve the installation ID for an account from KV (never client-supplied). */
async function resolveInstallationId(
  env: Env,
  owner: string,
): Promise<string | null> {
  if (!env.AG_TOKENS_KV) return null;

  try {
    const listed = await env.AG_TOKENS_KV.list({ prefix: KV_PREFIX });
    for (const key of listed.keys) {
      const raw = await env.AG_TOKENS_KV.get(key.name);
      if (!raw) continue;
      try {
        const rec = JSON.parse(raw) as InstallRecord;
        if (rec.account.toLowerCase() === owner.toLowerCase()) {
          return rec.installationId;
        }
      } catch {
        // skip malformed entries
      }
    }
  } catch {
    // KV list may not be available
  }

  return null;
}

/** Fetch the installation record for contextual metadata. */
async function getInstallationRecord(
  env: Env,
  installationId: string,
): Promise<InstallRecord | null> {
  if (!env.AG_TOKENS_KV) return null;
  try {
    const raw = await env.AG_TOKENS_KV.get(`${KV_PREFIX}${installationId}`);
    return raw ? (JSON.parse(raw) as InstallRecord) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Handler                                                            */
/* ------------------------------------------------------------------ */

export async function handleCreateRepo(
  env: Env,
  request: Request,
): Promise<Response> {
  if (!env.APP_ID || !env.PRIVATE_KEY) {
    return json(
      { error: "GitHub App not configured (APP_ID or PRIVATE_KEY missing)" },
      503,
    );
  }

  // ── Parse + validate body ──────────────────────────────────────── //
  let body: {
    owner?: string;
    name?: string;
    description?: string;
    private?: boolean;
    autoInit?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const owner = body.owner?.trim() ?? "";
  const name = body.name?.trim() ?? "";
  if (!owner) return json({ error: "Missing required field: owner" }, 400);
  if (!name) return json({ error: "Missing required field: name" }, 400);

  // Validate repo name characters (GitHub rules)
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    return json(
      { error: "Invalid repo name — use letters, numbers, '.', '_', '-'" },
      400,
    );
  }

  const isPrivate = body.private ?? false;
  const autoInit = body.autoInit ?? true;

  // ── Tenant gate (public app → only our accounts may create repos) ── //
  if (!isAccountAllowed(env, owner)) {
    return json(
      {
        error: `Account "${owner}" is not authorized to create repositories through this app.`,
      },
      403,
    );
  }

  // ── Resolve installation (server-side only) ──────────────────────── //
  const installationId = await resolveInstallationId(env, owner);
  if (!installationId) {
    return json(
      {
        error: `No installation found for "${owner}". Install the OpenCodeWEB GitHub App on this account first.`,
      },
      404,
    );
  }

  const installRecord = await getInstallationRecord(env, installationId);

  // ── Reject user accounts (GitHub platform limitation) ──────────── //
  if (installRecord && installRecord.accountType === "User") {
    return json(
      {
        error: `GitHub Apps cannot create repositories in user accounts ("${owner}"). Install the app on an Organization to create repos.`,
        hint: "Available orgs: OpenCodeWEB, ABsUPs",
      },
      403,
    );
  }

  // ── Get installation token ─────────────────────────────────────── //
  let token: string;
  try {
    const jwt = await generateAppJwt(buildAppConfig(env, installationId));
    const instToken = await getInstallationToken(jwt, installationId);
    token = instToken.token;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "Installation token failed", message }, 502);
  }

  // ── Create the repository ──────────────────────────────────────── //
  const url = `${GITHUB_API}/orgs/${owner}/repos`;
  let resp: Response;
  try {
    resp = await githubFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "OpenCodeWEB/1.0",
      },
      body: JSON.stringify({
        name,
        description: body.description ?? `Created by OpenCodeWEB`,
        private: isPrivate,
        auto_init: autoInit,
      }),
    });  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "GitHub API request failed", message }, 502);
  }

  const respBody = (await resp.text()) as string;
  if (!resp.ok) {
    let message = `GitHub API error ${resp.status}`;
    try {
      const parsed = JSON.parse(respBody) as {
        message?: string;
        errors?: Array<{ message?: string }>;
      };
      message = parsed.message ?? message;
      if (parsed.errors?.length) {
        message += ` — ${parsed.errors.map((e) => e.message).join("; ")}`;
      }
    } catch {
      // keep generic message
    }

    return json({ error: "Repository creation failed", message }, resp.status);
  }

  const repo = JSON.parse(respBody) as {
    full_name?: string;
    html_url?: string;
    default_branch?: string;
    private?: boolean;
    created_at?: string;
  };

  return json(
    {
      ok: true,
      fullName: repo.full_name ?? `${owner}/${name}`,
      htmlUrl: repo.html_url ?? `${GITHUB_API.replace("api.", "")}/${owner}/${name}`,
      defaultBranch: repo.default_branch ?? "main",
      private: repo.private ?? isPrivate,
      createdAt: repo.created_at ?? new Date().toISOString(),
      installation: {
        id: installationId,
        account: installRecord?.account ?? owner,
        accountType: installRecord?.accountType ?? "Organization",
      },
    },
    201,
  );
}
