/**
 * GET /api/ag/auth/login — redirect to GitHub App install URL
 *
 * The GitHub App's install URL is:
 *   https://github.com/apps/<app-slug>/installations/new
 *
 * The app slug is configured via the GITHUB_APP_SLUG environment variable
 * (set in Cloudflare Pages dashboard). If not set, a helpful message is
 * returned instead of a broken redirect.
 */

import { Env, json } from "../_shared";

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const url = new URL(request.url);

  // GitHub App slug — must be set in Pages dashboard env vars
  const appSlug = env.GITHUB_APP_SLUG;

  if (!appSlug) {
    return json(
      {
        error: "GitHub App not configured",
        message:
          "The GITHUB_APP_SLUG environment variable is not set. " +
          "Create a GitHub App at https://github.com/settings/apps/new and " +
          "set its slug in the Cloudflare Pages dashboard (Settings → Environment variables).",
        docs: "https://docs.github.com/en/apps/creating-github-apps",
      },
      503,
    );
  }

  // Install URL for the GitHub App
  const installUrl = new URL(
    `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new`,
  );

  // Point redirect_uri to our callback so GitHub sends the user back here
  installUrl.searchParams.set(
    "redirect_uri",
    `${url.origin}/api/ag/auth/callback`,
  );

  return Response.redirect(installUrl.toString(), 302);
};
