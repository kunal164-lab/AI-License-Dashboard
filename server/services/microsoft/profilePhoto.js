// Fetches the SIGNED-IN user's own Microsoft Entra profile photo, using
// their own delegated access token from the sign-in flow (server/auth/
// routes.js's MSAL callback) — never the application's own client-
// credentials token, and never any other user's id. `User.Read` (already
// requested at login — see server/auth/msalClient.js's LOGIN_SCOPES) is
// sufficient: it covers GET /me/photo(s) with no additional Graph
// permission or admin consent.
//
// Called once, right after login, and the resulting bytes are cached on
// the session (server/auth/routes.js) — this module itself never touches
// the session or holds onto the access token; it's a pure "give me bytes
// or null" fetch.
const SIZE = '64x64' // small, header-avatar-sized — keeps the cached payload tiny

export async function fetchOwnProfilePhoto(accessToken) {
  let res
  try {
    res = await fetch(`https://graph.microsoft.com/v1.0/me/photos/${SIZE}/$value`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
  } catch (e) {
    // Network failure reaching Graph must never break login — no photo is
    // a completely normal, expected outcome the UI already falls back for.
    return null
  }
  // 404 = this account genuinely has no photo set (very common) — not an
  // error. Any other non-OK status (403/5xx/etc.) is treated the same way:
  // login must never be blocked or degraded by a photo-fetch problem.
  if (!res.ok) return null
  const contentType = res.headers.get('content-type') || 'image/jpeg'
  const buffer = Buffer.from(await res.arrayBuffer())
  if (!buffer.length) return null
  return { contentType, base64: buffer.toString('base64') }
}
