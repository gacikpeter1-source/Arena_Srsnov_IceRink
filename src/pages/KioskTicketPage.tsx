import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { useClubData } from '@/hooks/useClubData'
import { fetchKioskOrder } from '@/lib/kiosk'
import { generateQrDataUrl } from '@/lib/qrcode'
import { KioskOrder } from '@/types'
import BackButton from '@/components/BackButton'

function fmt(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

/**
 * The page a kiosk ticket's own QR code resolves to if opened by a human
 * (rather than scanned by the entrance gate hardware, see gateScanCheckIn
 * in functions/src/gate.ts, which reads the same URL shape but never
 * actually navigates here) — same dual-purpose convention every other QR
 * in this app already follows (e.g. a training registration's cancel
 * link). No cancel action here: a kiosk purchase has no self-cancel
 * concept, this is purely a "here's your ticket again" view.
 */
export default function KioskTicketPage() {
  const { orderId, token } = useParams<{ orderId: string; token: string }>()
  const { club } = useClubData()
  const [order, setOrder] = useState<(KioskOrder & { id: string }) | null | undefined>(undefined)
  const [qr, setQr] = useState<string | null>(null)

  useEffect(() => {
    if (!orderId) return
    fetchKioskOrder(orderId).then((found) => {
      const valid = found && found.cancellationToken === token ? found : null
      setOrder(valid)
      if (valid) generateQrDataUrl(`${window.location.origin}/kiosk/vstup/${valid.id}/${valid.cancellationToken}`).then(setQr)
    })
  }, [orderId, token])

  return (
    <div className="content-container py-6 space-y-6 max-w-sm mx-auto">
      <BackButton fallback="/" />
      {order === undefined ? (
        <p className="text-text-muted text-center">Načítava sa...</p>
      ) : order === null ? (
        <p className="text-text-secondary text-center">Táto vstupenka nebola nájdená.</p>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-white font-bold text-xl">{club?.name}</p>
          <p className="text-text-secondary text-sm">Vstupenka</p>
          <div className="w-full space-y-1">
            {order.lines.map((l, i) => (
              <p key={i} className="text-white text-sm">
                {l.qty}× {l.productName} — {l.variantName}
              </p>
            ))}
          </div>
          <p className="text-white font-bold">Spolu: {fmt(order.totalAmount)} €</p>
          <p className="text-text-muted text-sm">Potvrdzovací kód: {order.confirmationCode}</p>
          {qr && <img src={qr} alt="QR kód vstupenky" className="w-56 h-56 rounded-lg bg-white p-2" />}
          {order.checkedInAt ? (
            <div className="flex items-center gap-2 text-status-success text-sm">
              <CheckCircle2 className="h-5 w-5" />
              Táto vstupenka už bola použitá pri vstupe.
            </div>
          ) : (
            <p className="text-text-muted text-xs">Naskenujte tento QR kód pri vstupe.</p>
          )}
        </div>
      )}
    </div>
  )
}
