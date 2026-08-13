/**
 * GET /api/auth/github — redirect to the login endpoint
 */

import { Env, json } from "./_shared";

export const onRequest: PagesFunction<Env> = async () => {
  // Redirect to /api/auth/github/login
  return Response.redirect("/api/auth/github/login", 302);
};
