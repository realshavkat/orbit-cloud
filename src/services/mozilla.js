import { ApiError } from "../lib/validate.js";

export function createMozillaVerifier(cfg, fetchImpl = fetch) {
  const { oauthUrl, profileUrl, clientIds } = cfg.mozilla;
  const call = async (url, init) => {
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(8000) });
    } catch {
      throw new ApiError(502, "mozilla_unreachable");
    }
    if (res.status >= 500) throw new ApiError(502, "mozilla_unreachable");
    if (!res.ok) throw new ApiError(401, "mozilla_token_invalid");
    return res.json();
  };
  return async function verify(token) {
    const info = await call(`${oauthUrl}/v1/verify`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }),
    });
    const scopes = Array.isArray(info.scope) ? info.scope : String(info.scope ?? "").split(/\s+/);
    if (!clientIds.includes(info.client_id) || !scopes.some(s => s == "profile" || s.startsWith("profile:"))) {
      throw new ApiError(401, "mozilla_token_invalid");
    }
    const profile = await call(`${profileUrl}/v1/profile`, { headers: { authorization: `Bearer ${token}` } });
    if (!profile.uid || profile.uid != info.user || !profile.email) throw new ApiError(401, "mozilla_token_invalid");
    return { uid: String(profile.uid), email: String(profile.email) };
  };
}
