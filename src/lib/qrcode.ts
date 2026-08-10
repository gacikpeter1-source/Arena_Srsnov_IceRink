import QRCode from 'qrcode'

/**
 * Renders a URL as a QR code PNG data URI. Works both in the browser (for
 * on-screen display/download) and in lib/email.ts (for embedding directly
 * in an email's HTML, no external image hosting needed).
 */
export async function generateQrDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, { width: 512, margin: 2 })
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
