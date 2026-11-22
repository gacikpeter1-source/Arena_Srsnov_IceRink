import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchKioskOrder } from '@/lib/kiosk'

/**
 * What the kiosk's "Zaplatiť cez QR v telefóne" QR actually encodes — a
 * short link, not the real Stripe Checkout URL directly (see
 * KioskPage.tsx's handlePayViaPhone for why: that URL is 200+ characters,
 * too dense to reliably scan at a normal on-screen kiosk size). Reads the
 * real URL back off the order (checkoutUrl, stored by
 * createKioskCheckoutSession) and bounces the phone there immediately.
 */
export default function KioskPayRedirectPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!orderId) {
      setNotFound(true)
      return
    }
    fetchKioskOrder(orderId).then((order) => {
      if (order?.checkoutUrl) {
        window.location.replace(order.checkoutUrl)
      } else {
        setNotFound(true)
      }
    })
  }, [orderId])

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center gap-4 bg-background-dark text-white text-center px-6">
      {notFound ? (
        <p className="text-text-secondary">Túto platbu sa nepodarilo nájsť. Skúste prosím znova naskenovať QR kód na kiosku.</p>
      ) : (
        <>
          <div className="h-10 w-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-text-secondary">Presmerúva sa na platbu...</p>
        </>
      )}
    </div>
  )
}
