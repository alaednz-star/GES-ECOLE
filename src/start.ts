import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { DESKTOP_ORIGIN, IS_DESKTOP, SERVER_ORIGIN } from "@/lib/desktop";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) =>
    ctx.handlerType === "serverFn" && ctx.request.headers.get("origin") !== DESKTOP_ORIGIN,
});

// The Windows desktop app (ADR-010) calls server functions from its own origin, which is a
// cross-site request by definition. It gets this dedicated check: only that exact origin passes
// (browsers set Origin themselves, so no website can claim it), and every function still requires
// the signed-in user's token. The rule above stays the default for every other request.
const desktopCsrfMiddleware = createCsrfMiddleware({
  filter: (ctx) =>
    ctx.handlerType === "serverFn" && ctx.request.headers.get("origin") === DESKTOP_ORIGIN,
  origin: DESKTOP_ORIGIN,
  secFetchSite: ["cross-site", "same-site"],
});

// In the desktop build the app's files are local, so relative server-function URLs go to the
// online server, which holds the secrets those functions need.
const desktopServerFnFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return fetch(url.startsWith("/") ? `${SERVER_ORIGIN}${url}` : input, init);
};

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware, desktopCsrfMiddleware],
  ...(IS_DESKTOP ? { serverFns: { fetch: desktopServerFnFetch } } : {}),
}));
