import { useEffect, useState } from 'react'

// Small shared fetch hook every Cost Analytics view uses — one GET, no
// client-side recalculation of anything it returns (every figure already
// comes from the server's costAnalytics.js, which itself only ever reads
// costEngine.js's already-resolved cost fields).
export function useCostJson(url) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!url) return
    setLoading(true); setError(null); setData(null)
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error('Failed to load cost data'); return r.json() })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [url])

  return { data, loading, error }
}
