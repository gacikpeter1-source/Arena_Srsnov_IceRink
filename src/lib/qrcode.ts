import QRCode from 'qrcode'

/**
 * Renders a URL as a QR code PNG data URI. Works both in the browser (for
 * on-screen display/download) and in lib/email.ts (for embedding directly
 * in an email's HTML, no external image hosting needed).
 *
 * `errorCorrectionLevel` is opt-in (default stays the library's own 'M')
 * — passing 'L' lets a caller trade redundancy for fewer/coarser modules
 * at the same pixel size, which matters when the code is displayed very
 * small on screen (e.g. a TV-board corner QR) and a phone camera struggles
 * to resolve a dense grid at that scale.
 */
export async function generateQrDataUrl(
  value: string,
  opts?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }
): Promise<string> {
  return QRCode.toDataURL(value, {
    width: 512,
    margin: 2,
    ...(opts?.errorCorrectionLevel ? { errorCorrectionLevel: opts.errorCorrectionLevel } : {})
  })
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
