export const BOARD_NAMESPACE = "local-preview";

export function siteViewerId(request: Request): string | null {
  const forwardedIdentity =
    request.headers.get("oai-authenticated-user-id")?.trim() ||
    request.headers.get("oai-authenticated-user-email")?.trim() ||
    request.headers.get("cf-access-authenticated-user-email")?.trim() ||
    null;
  if (forwardedIdentity) return forwardedIdentity;

  // Local development is intentionally passwordless. A public deployment must
  // sit behind Cloudflare Access (or another trusted proxy that injects one of
  // the identity headers above).
  try {
    const hostname = new URL(request.url).hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
      return "local-user";
    }
  } catch {
    return null;
  }
  return null;
}

export function requireSiteViewer(request: Request): Response | null {
  if (siteViewerId(request)) return null;
  return Response.json({ error: "需要通过 Threadline 登录后操作" }, { status: 401 });
}
