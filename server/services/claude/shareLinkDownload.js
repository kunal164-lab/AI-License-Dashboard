// Locates and downloads Claude_Spend_MTD.csv using ONLY the cookie session
// shareLinkAuth.js#authenticateShareLink already establishes — no
// Microsoft Graph, no Azure AD app permission, no Microsoft 365 connection
// anywhere in this file. This reproduces exactly what a browser does after
// passing the password gate:
//
//   password accepted -> redirected to .../onedrive.aspx?id={folder path}
//     -> the modern OneDrive web UI, which lists/downloads files via
//        SharePoint's own native REST API (_api/web/...), cookie-authed —
//        the SAME REST surface server/services/freshservice/sharepoint.js
//        already uses for Freshservice, just reached with a FedAuth cookie
//        (from the password gate) instead of an app-only OAuth token.
//
// VERIFIED LIVE during implementation, using the real password already
// configured through the Claude data source page: authenticateShareLink()
// against the real share URL redirected to
//   .../personal/kunal_tyagi_ssp-worldwide_com/_layouts/15/onedrive.aspx
//     ?id=%2Fpersonal%2Fkunal_tyagi_ssp-worldwide_com%2FDocuments%2FClaude%20reports
// — the folder's real server-relative path is the redirect's own `id` query
// parameter, no guessing involved. Calling
//   {origin}/personal/{user}/_api/web/GetFolderByServerRelativeUrl('{folder}')/Files
// with that session's cookies returned real JSON listing the real file
// (Name: "Claude_Spend_MTD.csv", 85270 bytes), and downloading it via
//   {origin}/personal/{user}/_api/web/GetFileByServerRelativeUrl('{path}')/$value
// (same cookies) returned the real CSV bytes, headers matching this
// integration's expected column list exactly. This is not a guess — it is
// the actual, tested mechanism.
import { cookieHeader } from './shareLinkAuth.js'

function looksLikeHtml(text) {
  const head = text.slice(0, 1000).toLowerCase()
  return head.includes('<html') || head.includes('<!doctype') || head.includes('guestaccess') || head.includes('sign in')
}

function looksLikeCsvText(text) {
  if (typeof text !== 'string' || !text.trim()) return false
  if (text.slice(0, 2) === 'PK') return false
  if (looksLikeHtml(text)) return false
  return text.includes(',') || text.includes('\n')
}

// A light, fast sanity check distinguishing "downloaded something CSV-
// shaped but clearly the wrong file" from the real Claude export, without
// duplicating the full structural validation src/utils/claudeNormalizer.js
// (and server/index.js's /api/claude/import-csv route) already do right
// after this — this only guards this module's own success/failure signal.
function looksLikeClaudeCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0].toLowerCase()
  return firstLine.includes('user_email') && firstLine.includes('total_requests')
}

function encodeODataPathArg(path) {
  return encodeURIComponent(`'${path.replace(/'/g, "''")}'`)
}

// The redirect a successful password submission lands on is the modern
// OneDrive web UI, .../onedrive.aspx?id={server-relative folder path}&... —
// `id` IS that path (browser-decoded by URLSearchParams), not something
// this code invents or reverse-engineers from the share token.
function extractFolderPath(finalUrl) {
  const u = new URL(finalUrl)
  return u.searchParams.get('id')
}

// The SharePoint "web" (site) base every _api/web/... call is relative to
// — for a personal OneDrive this is exactly the /personal/{user} segment
// of the authenticated URL itself, not a value this code has to guess or
// resolve through any directory/API lookup.
function extractWebUrl(finalUrl) {
  const u = new URL(finalUrl)
  const m = u.pathname.match(/^(\/personal\/[^/]+)\//)
  if (!m) return null
  return u.origin + m[1]
}

class StageError extends Error {
  constructor(stage, message) {
    super(message)
    this.stage = stage
  }
}

// Returns the raw CSV text, or throws a StageError tagged with exactly
// which step failed (Part 6 of the spec this implements) — never mentions
// Graph/Files.Read.All/Sites.Read.All/an Azure AD permission, and never
// includes a cookie/password/session id in any message.
export async function downloadFileFromShareLink({ shareUrl, fileName, cookieJar, finalUrl }) {
  const webUrl = extractWebUrl(finalUrl)
  const folderPath = extractFolderPath(finalUrl)
  if (!webUrl || !folderPath) {
    throw new StageError('B', `Authentication succeeded but the resulting folder page could not be recognized (unexpected URL: ${finalUrl}).`)
  }

  const cookies = cookieHeader(cookieJar)
  let listRes
  try {
    listRes = await fetch(`${webUrl}/_api/web/GetFolderByServerRelativeUrl(${encodeODataPathArg(folderPath)})/Files`, {
      headers: { Cookie: cookies, Accept: 'application/json;odata=verbose' }
    })
  } catch (e) {
    throw new StageError('B', `Authentication succeeded but the folder could not be reached — ${e.message || 'network failure'}.`)
  }
  if (!listRes.ok) {
    throw new StageError('B', `Authentication succeeded but the configured SharePoint folder could not be listed (HTTP ${listRes.status}).`)
  }
  let listJson
  try {
    listJson = JSON.parse(await listRes.text())
  } catch (e) {
    throw new StageError('B', 'Authentication succeeded but the folder listing response was not valid JSON (the folder page may not be the expected SharePoint document library view).')
  }

  const files = listJson?.d?.results || []
  const match = files.find((f) => f.Name === fileName)
  if (!match) {
    throw new StageError('C', `The configured SharePoint folder was opened successfully, but "${fileName}" was not found in it.`)
  }
  const fileServerRelativeUrl = match.ServerRelativeUrl
  if (!fileServerRelativeUrl) {
    throw new StageError('D', `"${fileName}" was found, but no downloadable location was returned for it.`)
  }

  let fileRes
  try {
    fileRes = await fetch(`${webUrl}/_api/web/GetFileByServerRelativeUrl(${encodeODataPathArg(fileServerRelativeUrl)})/$value`, {
      headers: { Cookie: cookies, Accept: 'text/csv,application/octet-stream' }
    })
  } catch (e) {
    throw new StageError('D', `"${fileName}" was found, but downloading it failed — ${e.message || 'network failure'}.`)
  }
  if (!fileRes.ok) {
    throw new StageError('D', `"${fileName}" was found, but the download request failed (HTTP ${fileRes.status}).`)
  }
  const text = await fileRes.text()
  if (!looksLikeCsvText(text)) {
    throw new StageError('E', 'The download request succeeded, but the response was not valid CSV data (it may have been an HTML page instead of the file).')
  }
  if (!looksLikeClaudeCsv(text)) {
    throw new StageError('G', 'The downloaded file does not look like a Claude MTD spend export (expected headers were not found).')
  }
  return text
}

export { StageError }
