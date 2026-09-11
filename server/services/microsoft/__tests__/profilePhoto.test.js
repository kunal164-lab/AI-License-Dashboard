// fetchOwnProfilePhoto (Part 1 of the profile-photo spec) — verifies the
// Graph call shape (User.Read-covered /me/photos endpoint, this user's own
// token only) and, critically, that every failure mode (no photo, Graph
// error, network failure) resolves to null rather than throwing — a photo
// problem must never be able to break login. global.fetch is stubbed for
// the duration of each test and restored immediately after.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchOwnProfilePhoto } from '../profilePhoto.js'

const realFetch = global.fetch

function stubFetch(impl) { global.fetch = impl }
function restoreFetch() { global.fetch = realFetch }

test('returns the photo bytes/content-type on a successful Graph response, using the caller-supplied token as a Bearer header', async () => {
  let capturedUrl, capturedAuth
  stubFetch(async (url, opts) => {
    capturedUrl = url
    capturedAuth = opts.headers.Authorization
    return {
      ok: true,
      headers: { get: (h) => (h === 'content-type' ? 'image/jpeg' : null) },
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
    }
  })
  try {
    const photo = await fetchOwnProfilePhoto('the-users-own-delegated-token')
    assert.ok(photo)
    assert.equal(photo.contentType, 'image/jpeg')
    assert.equal(Buffer.from(photo.base64, 'base64').length, 4)
    assert.match(capturedUrl, /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/photos\/\d+x\d+\/\$value$/, 'must call the /me/photos endpoint — the signed-in user\'s OWN photo, never another user\'s id')
    assert.equal(capturedAuth, 'Bearer the-users-own-delegated-token')
  } finally {
    restoreFetch()
  }
})

test('a 404 (no photo configured — a normal, common outcome) resolves to null, not an error', async () => {
  stubFetch(async () => ({ ok: false, status: 404 }))
  try {
    assert.equal(await fetchOwnProfilePhoto('token'), null)
  } finally {
    restoreFetch()
  }
})

test('any other Graph error status also resolves to null — a photo problem must never break login', async () => {
  stubFetch(async () => ({ ok: false, status: 403 }))
  try {
    assert.equal(await fetchOwnProfilePhoto('token'), null)
  } finally {
    restoreFetch()
  }
})

test('a network failure reaching Graph resolves to null rather than throwing', async () => {
  stubFetch(async () => { throw new Error('ENOTFOUND graph.microsoft.com') })
  try {
    const result = await fetchOwnProfilePhoto('token')
    assert.equal(result, null)
  } finally {
    restoreFetch()
  }
})

test('an empty (zero-byte) response body is treated as no photo, not a broken image', async () => {
  stubFetch(async () => ({
    ok: true,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => new ArrayBuffer(0)
  }))
  try {
    assert.equal(await fetchOwnProfilePhoto('token'), null)
  } finally {
    restoreFetch()
  }
})
