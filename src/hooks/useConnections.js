import { useCallback, useEffect, useState } from 'react'

export default function useConnections(source) {
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/connections?source=${encodeURIComponent(source)}`)
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const j = await r.json()
      setConnections(j.connections || [])
      setError(null)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [source])

  useEffect(() => { refresh() }, [refresh])

  return { connections, loading, error, refresh }
}
