// Loads the existing application logo (public/ssp-logo.png — the same file
// the Sidebar already renders) as a base64 data URL so jsPDF's addImage can
// embed it in every generated report's header. Fetched once and cached —
// every report generated in a session reuses the same in-memory data URL
// instead of re-fetching. Never fabricates a logo: if the fetch fails for
// any reason, callers get null and simply skip drawing an image (never
// break PDF generation over a missing/unavailable asset).
let cachedLogoDataUrl = null
let cachedLogoPromise = null

export function getLogoDataUrl() {
  if (cachedLogoDataUrl !== null) return Promise.resolve(cachedLogoDataUrl)
  if (cachedLogoPromise) return cachedLogoPromise

  cachedLogoPromise = fetch('/ssp-logo.png')
    .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('logo fetch failed: ' + res.status))))
    .then((blob) => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    }))
    .then((dataUrl) => { cachedLogoDataUrl = dataUrl; return dataUrl })
    .catch((e) => {
      console.warn('Report logo unavailable, generating report without it:', e.message)
      cachedLogoDataUrl = false // cache the failure too, so we don't retry every report
      return false
    })

  return cachedLogoPromise
}

// The source PNG is 330x210px (see public/ssp-logo.png) — used to keep the
// embedded image's aspect ratio correct wherever it's drawn.
export const LOGO_ASPECT_RATIO = 330 / 210
