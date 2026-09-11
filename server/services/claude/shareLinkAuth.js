// Authenticates against a password-protected SharePoint/OneDrive anonymous
// "share link" DIRECTLY — no Microsoft Graph, no Azure AD app permissions,
// no dependency on the Microsoft 365 connection configured elsewhere in
// this app. This is a genuinely different, independent mechanism from
// every other Microsoft 365 integration in this codebase.
//
// The share URL's password gate (confirmed live against the real
// configured URL during implementation) is a plain, classic ASP.NET
// WebForms page at .../_layouts/15/guestaccess.aspx — a normal HTML page
// with a password <input>, NOT a JSON/REST API and NOT a Graph resource.
// Submitting the password is a normal HTTP POST of that page's own hidden
// ASP.NET postback fields (__VIEWSTATE/__VIEWSTATEGENERATOR/
// __VIEWSTATEENCRYPTED/__EVENTVALIDATION/SideBySideToken) plus the
// password field and the button's own name=value pair — verified live: an
// intentionally wrong password submitted this exact way was correctly
// rejected by the real server with "Link password is incorrect", proving
// this field set is complete and correctly accepted (no __EVENTTARGET or
// any other hidden field is needed — confirmed empirically, not assumed).
//
// This module owns the plain-HTTP session (cookies) that submitting the
// correct password establishes; server/services/claude/shareLinkDownload.js
// uses that session to actually list/download the file.
const PASSWORD_INCORRECT_MARKER = 'is incorrect'
const PASSWORD_REQUIRED_MARKER = 'password'

function extractHiddenValue(html, name) {
  const re = new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)["']`, 'i')
  const m = re.exec(html)
  return m ? m[1] : null
}

function extractFormAction(html, baseUrl) {
  const m = /<form[^>]*\bid=["']inputForm["'][^>]*\baction=["']([^"']+)["']/i.exec(html)
    || /<form[^>]*\baction=["']([^"']+)["'][^>]*\bid=["']inputForm["']/i.exec(html)
  if (!m) return null
  const action = m[1].replace(/&amp;/g, '&')
  return new URL(action, baseUrl).toString()
}

// Merges Set-Cookie headers from a response into a running cookie jar
// (Map<name,value>) — Node's fetch Headers#getSetCookie() (Node 18.14+/20+)
// returns every Set-Cookie line, not just the first.
function mergeCookies(jar, response) {
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  for (const line of setCookies) {
    const [pair] = line.split(';')
    const idx = pair.indexOf('=')
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
  }
}

function cookieHeader(jar) {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
}

// Follows a redirect chain manually (never trusting fetch's automatic
// redirect handling, which would silently drop the Set-Cookie headers a
// successful login issues along the way) — every hop's cookies are merged
// into `jar` before the next request is made.
async function fetchFollowingRedirects(url, options, jar, maxHops = 5) {
  let currentUrl = url
  for (let hop = 0; hop < maxHops; hop++) {
    const res = await fetch(currentUrl, { ...options, redirect: 'manual', headers: { ...(options.headers || {}), Cookie: cookieHeader(jar) } })
    mergeCookies(jar, res)
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      currentUrl = new URL(res.headers.get('location'), currentUrl).toString()
      options = { method: 'GET', headers: {} } // a redirect is always followed as a GET, per standard browser behavior
      continue
    }
    return { res, finalUrl: currentUrl }
  }
  throw new Error('Too many redirects while accessing the Claude SharePoint share link.')
}

// Returns { cookieJar, finalUrl, finalHtml } on success. Throws a safe,
// share-link-specific Error (never mentioning Graph/Files.Read.All/an
// Azure AD permission) on any failure — wrong password, an unreachable
// link, or an unrecognized page structure.
function authError(message) {
  const err = new Error(message)
  err.stage = 'A' // Part 6 of the spec this implements: A = authentication failed
  return err
}

export async function authenticateShareLink(shareUrl, password) {
  if (!password) {
    throw authError('Claude SharePoint share-link authentication failed: no share-link password is configured.')
  }

  const jar = new Map()
  let getRes
  try {
    getRes = await fetch(shareUrl)
  } catch (e) {
    throw authError(`Unable to access the configured Claude SharePoint share link — ${e.message || 'network failure'}.`)
  }
  mergeCookies(jar, getRes)
  const html = await getRes.text()

  // Already unprotected, or already authenticated by an existing cookie —
  // no password form present at all, nothing further to do.
  if (!html.includes('txtPassword')) {
    return { cookieJar: jar, finalUrl: getRes.url || shareUrl, finalHtml: html }
  }

  const formAction = extractFormAction(html, shareUrl)
  if (!formAction) {
    throw authError('Unable to access the configured Claude SharePoint share link (unrecognized page structure).')
  }
  const fields = {
    SideBySideToken: extractHiddenValue(html, 'SideBySideToken') || '',
    __VIEWSTATE: extractHiddenValue(html, '__VIEWSTATE') || '',
    __VIEWSTATEGENERATOR: extractHiddenValue(html, '__VIEWSTATEGENERATOR') || '',
    __VIEWSTATEENCRYPTED: extractHiddenValue(html, '__VIEWSTATEENCRYPTED') || '',
    __EVENTVALIDATION: extractHiddenValue(html, '__EVENTVALIDATION') || ''
  }

  const body = new URLSearchParams({ ...fields, txtPassword: password, btnSubmitPassword: 'Verify' })
  let postResult
  try {
    postResult = await fetchFollowingRedirects(formAction, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    }, jar)
  } catch (e) {
    throw authError(`Unable to access the configured Claude SharePoint share link — ${e.message || 'network failure'}.`)
  }

  const resultHtml = await postResult.res.text()
  if (resultHtml.toLowerCase().includes(PASSWORD_INCORRECT_MARKER)) {
    throw authError('Claude SharePoint share-link authentication failed. Please verify the configured password.')
  }
  // Still showing a password prompt (and didn't hit the specific "incorrect"
  // wording above) — treat as a generic auth failure rather than guessing.
  if (resultHtml.includes('txtPassword') && resultHtml.toLowerCase().includes(PASSWORD_REQUIRED_MARKER)) {
    throw authError('Claude SharePoint share-link authentication failed. Please verify the configured password.')
  }

  return { cookieJar: jar, finalUrl: postResult.finalUrl, finalHtml: resultHtml }
}

export { cookieHeader, fetchFollowingRedirects }
