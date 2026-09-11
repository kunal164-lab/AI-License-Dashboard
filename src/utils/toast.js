// Minimal pub-sub toast system — no dependency, no context provider needed.
// toast.show(...) can be called from anywhere; <ToastHost/> (mounted once in
// App.jsx) is the only subscriber that renders anything.
const listeners = new Set()
let idSeq = 0

function show(message, { type = 'info', duration = 4000 } = {}) {
  const id = ++idSeq
  const toast = { id, message, type }
  listeners.forEach((fn) => fn({ type: 'add', toast }))
  if (duration > 0) {
    setTimeout(() => listeners.forEach((fn) => fn({ type: 'remove', id })), duration)
  }
  return id
}

const toast = {
  show,
  success: (msg, opts) => show(msg, { ...opts, type: 'success' }),
  error: (msg, opts) => show(msg, { ...opts, type: 'error' }),
  info: (msg, opts) => show(msg, { ...opts, type: 'info' }),
  subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
}

export default toast
