/** Trigger a client-side CSV file download (UTF-8 BOM so Excel opens it correctly). */
export function downloadCsv(filename: string, csv: string) {
  if (typeof document === 'undefined') return
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'export.csv'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
