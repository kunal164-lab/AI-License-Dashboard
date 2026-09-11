// Basic SSRF guard for admin/OAuth-supplied connector URLs — Kiro's
// authorizationUrl/tokenUrl/apiBaseUrl and GitHub's reportUrl are all
// legitimate, intentional "fetch from wherever the caller points us"
// features (see server/index.js's connector setup routes), but with zero
// validation they let that URL be used to make the server issue outbound
// requests (often carrying a live bearer token) to internal-only services
// or cloud metadata endpoints. Applied once, at the point each URL is
// first accepted (OAuth start / connection creation), not on every
// subsequent sync — proportionate for an internal tool where these fields
// are already gated behind requireWrite.
import net from 'net'
import dns from 'dns'

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number)
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function inCidr(intIp, base, maskBits) {
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0
  return (intIp & mask) === (ipv4ToInt(base) & mask)
}

// RFC1918 private ranges, loopback, link-local (which is also where cloud
// metadata endpoints like 169.254.169.254 live), CGNAT, and the various
// IETF-reserved/documentation/benchmarking ranges.
const PRIVATE_IPV4_CIDRS = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
]

function isPrivateOrReservedIp(ip) {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip)
    return PRIVATE_IPV4_CIDRS.some(([base, bits]) => inCidr(n, base, bits))
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase()
    if (v === '::1' || v === '::') return true
    if (v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd')) return true // link-local / unique-local
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — the WHATWG URL parser (and some
    // platforms' getaddrinfo) instead canonicalize this to two hex groups
    // (::ffff:HHHH:HHHH), so check both textual forms rather than only the
    // dotted-decimal one.
    const dotted = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (dotted) return isPrivateOrReservedIp(dotted[1])
    const hexMapped = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16)
      const lo = parseInt(hexMapped[2], 16)
      const a = (hi >> 8) & 0xff, b = hi & 0xff, c = (lo >> 8) & 0xff, d = lo & 0xff
      return isPrivateOrReservedIp(`${a}.${b}.${c}.${d}`)
    }
    return false
  }
  return false
}

// Throws with a human-readable message if `rawUrl` isn't a safe external
// http(s) destination — bad scheme, or (after resolving the hostname, so a
// DNS name pointed at an internal address is caught too, not just IP
// literals) an address in a private/loopback/link-local/reserved range.
export async function assertSafeExternalUrl(rawUrl, label = 'URL') {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`${label} is not a valid URL.`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must be an http:// or https:// URL.`)
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  if (hostname.toLowerCase() === 'localhost') {
    throw new Error(`${label} may not point at localhost or an internal address.`)
  }

  let addresses
  if (net.isIP(hostname)) {
    addresses = [hostname]
  } else {
    try {
      addresses = (await dns.promises.lookup(hostname, { all: true })).map((a) => a.address)
    } catch {
      throw new Error(`${label}'s hostname could not be resolved.`)
    }
  }
  if (addresses.some(isPrivateOrReservedIp)) {
    throw new Error(`${label} may not point at localhost or an internal/private network address.`)
  }
}
