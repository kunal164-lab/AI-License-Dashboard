// The one browser-only piece of the report engine — every report builder
// (pdfReport/excelReport/csvReport) produces a plain Blob/string in pure,
// Node-testable functions and hands off to this to actually trigger a save.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
