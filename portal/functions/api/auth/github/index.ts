/**
 * GET /api/auth/github — redirect to the login endpoint
 *
 * NOTE: in Cloudflare Pages Functions the directory `index.ts` also runs as
 * middleware for sibling routes (`/login`, `/callback`, `/session`, ...), so
 * this handler MUST pass through every other path with `context.next()`.
 * It also MUST use an absolute URL — `Response.redirect()` throws
 * `TypeError: Unable to parse URL` for relative paths (this was the cause of
 * the 500 on every /api/auth/github/* route).
 */

import { Env } from "./_shared";

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);

  // Directory index: only redirect the bare mount path; let siblings handle
  // themselves (login, callback, session, logout).
  if (url.pathname !== "/api/auth/github") {
    return context.next();
  }

  const loginUrl = new URL("/api/auth/github/login", url);
  return Response.redirect(loginUrl.toString(), 302);
};