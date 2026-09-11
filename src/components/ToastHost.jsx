import React, { useEffect, useState } from 'react'
import toast from '../utils/toast'

export default function ToastHost() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    return toast.subscribe((evt) => {
      if (evt.type === 'add') setToasts((t) => [...t, evt.toast])
      else setToasts((t) => t.filter((x) => x.id !== evt.id))
    })
  }, [])

  if (!toasts.length) return null

  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
      ))}
    </div>
  )
}
