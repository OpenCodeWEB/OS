/**
 * Shared types and utilities for the OpenCodeWEB webhook Worker.
 */

export interface Env {
  AG_TOKENS_KV: KVNamespace;
  AG_METRICS: KVNamespace;
  AG_DB?: D1Database;
  WEBHOOK_SECRET?: string;
  METRICS_WEBHOOK_SECRET?: string;
  APP_ID?: string;
  PRIVATE_KEY?: string;
  INSTALLATION_ID?: string;
  INTERNAL_GATEWAY_TOKEN?: string;
  /**
   * Comma-separated GitHub account logins that may drive the bot
   * (webhook processing, repo creation, installation listing).
   * Tenant isolation: once the GitHub App is public, all other
   * installers are ignored. Defaults to the OpenCodeWEB ecosystem.
   */
  ALLOWED_ACCOUNTS?: string;
}

/** Default tenants: the OpenCodeWEB org + the ABsUP accounts. */
export const DEFAULT_ALLOWED_ACCOUNTS = ["opencodeweb", "absup", "absups"];

/** Parse the ALLOWED_ACCOUNTS env var into lowercase logins. */
export function parseAllowedAccounts(env: Env): string[] {
  const raw = env.ALLOWED_ACCOUNTS?.trim();
  if (!raw) return DEFAULT_ALLOWED_ACCOUNTS;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Tenant gate: is this GitHub account permitted to drive the bot? */
export function isAccountAllowed(
  env: Env,
  account: string | null | undefined,
): boolean {
  if (!account) return false;
  return parseAllowedAccounts(env).includes(account.toLowerCase());
}

/** Installation record stored in KV under ag_install:<id> */
export interface InstallRecord {
  installationId: string;
  account: string;
  accountType: string;
  setupAction: string;
  installedAt: string;
  suspendedAt: string | null;
  updatedAt: string;
}

/** JSON-serialised token store saved in AG_TOKENS_KV keyed by installation ID */
export interface TokenStore {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;        // ISO‑8601
  installationId: string;
  login: string;
}

/** GitHub webhook event payload envelope */
export interface WebhookEvent {
  event: string;      // e.g. "push", "pull_request"
  delivery: string;   // unique delivery GUID
  payload: Record<string, unknown>;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
