/**
 * GET /installations — Sync & list all GitHub App installations from the API.
 *
 * 1. Generate a JWT signed with the GitHub App's RSA private key (RS256).
 * 2. Call GET /app/installations on the GitHub REST API.
 * 3. Store / update each installation record in AG_TOKENS_KV.
 * 4. Remove stale entries no longer returned by GitHub.
 * 5. Return the fresh list.
 *
 * WEBHOOK TEST — trigger push event 002
 */

import type { Env, InstallRecord } from "./_shared.js";
import { json } from "./_shared.js";
import { isAccountAllowed } from "./_shared.js";
import { generateAppJwt } from "../../src/auth/github.js";
import type { GitHubAppConfig } from "../../src/auth/github.js";
import { githubFetch } from "../../src/github-api.js";

const KV_PREFIX = "ag_install:";

/* ------------------------------------------------------------------ */
/*  GitHub REST API helpers                                            */
/* ------------------------------------------------------------------ */

interface GitHubInstallation {
  id: number;
  account: {
    login: string;
    type: "User" | "Organization";
  } | null;
  created_at: string;
  updated_at: string;
  suspended_at: string | null;
  [key: string]: unknown;
}

async function fetchInstallationsFromGitHub(jwt: string): Promise<GitHubInstallation[]> {
  const url = "https://api.github.com/app/installations?per_page=100";
  const response = await githubFetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "User-Agent": "opencodeweb-worker",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${body}`);
  }

  return (await response.json()) as GitHubInstallation[];
}

/* ------------------------------------------------------------------ */
/*  KV sync helpers                                                    */
/* ------------------------------------------------------------------ */

function toRecord(inst: GitHubInstallation): InstallRecord {
  return {
    installationId: String(inst.id),
    account: inst.account?.login ?? "unknown",
    accountType: inst.account?.type ?? "Unknown",
    setupAction: "install",
    installedAt: inst.created_at,
    suspendedAt: inst.suspended_at,
    updatedAt: inst.updated_at,
  };
}

async function syncToKv(
  kv: KVNamespace,
  installations: GitHubInstallation[],
): Promise<InstallRecord[]> {
  const fresh = new Set<string>();

  for (const inst of installations) {
    const id = String(inst.id);
    fresh.add(id);
    const key = `${KV_PREFIX}${id}`;
    const record = toRecord(inst);
    await kv.put(key, JSON.stringify(record), { expirationTtl: 86400 * 90 });
  }

  // Remove stale entries
  const listed = await kv.list({ prefix: KV_PREFIX });
  for (const key of listed.keys) {
    const existingId = key.name.replace(KV_PREFIX, "");
    if (!fresh.has(existingId)) {
      console.log(`[installations] removing stale installation ${existingId}`);
      await kv.delete(key.name);
    }
  }

  return installations.map(toRecord);
}

/* ------------------------------------------------------------------ */
/*  Handler                                                           */
/* ------------------------------------------------------------------ */

export async function handleListInstallations(env: Env): Promise<Response> {
  if (!env.APP_ID || !env.PRIVATE_KEY) {
    return json(
      { error: "GitHub App not configured (APP_ID or PRIVATE_KEY missing)" },
      503,
    );
  }

  if (!env.AG_TOKENS_KV) {
    return json({ error: "AG_TOKENS_KV not bound" }, 503);
  }

  try {
    // Use core library's generateAppJwt
    const config: GitHubAppConfig = {
      appId: env.APP_ID,
      privateKey: env.PRIVATE_KEY,
      installationId: env.INSTALLATION_ID ?? "0",
    };
    const jwt = await generateAppJwt(config);

    const installations = await fetchInstallationsFromGitHub(jwt);

    // Tenant isolation: with a public app, installations from third-party
    // accounts are ignored — only the allowed ecosystem is tracked/listed.
    const allowed = installations.filter((i) =>
      isAccountAllowed(env, i.account?.login),
    );
    const records = await syncToKv(env.AG_TOKENS_KV, allowed);

    return json({
      ok: true,
      count: records.length,
      installations: records,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[installations] sync failed: ${message}`);
    return json({ error: "Sync failed", message }, 500);
  }
}
