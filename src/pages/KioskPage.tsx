import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Ticket, ShoppingCart, ChevronLeft, CreditCard, Printer, Mail, CheckCircle2, Minus, Plus, X } from 'lucide-react'
import { useClubData } from '@/hooks/useClubData'
import {
  createKioskCheckoutSession,
  createKioskOrder,
  fetchKioskOrder,
  fetchKioskProducts,
  sendKioskOrderEmail
} from '@/lib/kiosk'
import { generateQrDataUrl } from '@/lib/qrcode'
import { KioskOrder, KioskOrderLine, KioskProduct } from '@/types'

type Screen = 'select' | 'detail' | 'order' | 'redirecting' | 'confirming' | 'timedOut' | 'success'
type Delivery = 'choice' | 'email-form' | 'email-sent' | 'printed' | null

interface CartLine extends KioskOrderLine {
  id: string
}

const POLL_MS = 2500
const POLL_TIMEOUT_MS = 30000

function fmt(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

/**
 * The entrance kiosk ("Riešenie 2" in CLAUDE.md) — a touch tablet at the
 * door: tap a tile, pick a variant (dospelí/dieťa/s voucherom, from
 * KioskProduct.variants — see AdminKioskPage.tsx for where these come
 * from) and a quantity, build an order across several products at once,
 * pay by card, then choose to print or email the ticket. Always a locked,
 * chrome-less full-screen view (see App.tsx's isTvScreen check) — there is
 * deliberately no way to navigate out of this page from the UI itself; a
 * real deployment locks the tablet's own OS to this one URL (Android
 * kiosk-launcher app, or iPad Guided Access).
 *
 * Payment reuses the exact same create-pending-doc-then-redirect shape
 * every other real-money flow in this app uses (see createKioskOrder/
 * createKioskCheckoutSession, src/lib/kiosk.ts): this page never decides
 * whether a payment succeeded on its own — only stripeWebhook
 * (functions/src/payments.ts) flipping the order's `status` to 'paid' is
 * ever trusted, so the success screen polls for that after Stripe redirects
 * back here, same pattern TrainingPaymentStatusPage.tsx already
 * established.
 */
export default function KioskPage() {
  const { club } = useClubData()
  const [searchParams, setSearchParams] = useSearchParams()

  const [products, setProducts] = useState<(KioskProduct & { id: string })[]>([])
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [cart, setCart] = useState<CartLine[]>([])
  const [screen, setScreen] = useState<Screen>('select')

  const [detailProductId, setDetailProductId] = useState<string | null>(null)
  const [detailVariantId, setDetailVariantId] = useState<string | null>(null)
  const [detailQty, setDetailQty] = useState(1)

  const [payBusy, setPayBusy] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)

  const [order, setOrder] = useState<(KioskOrder & { id: string }) | null>(null)
  const [delivery, setDelivery] = useState<Delivery>(null)
  const [email, setEmail] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [printQr, setPrintQr] = useState<string | null>(null)

  const startedReturnFlowRef = useRef(false)

  useEffect(() => {
    if (!club) return
    fetchKioskProducts(club.id).then((all) => {
      setProducts(all.filter((p) => p.active))
      setLoadingProducts(false)
    })
  }, [club])

  // Stripe redirects back here with ?status=success|cancelled&orderId=...
  // after Checkout — a 'success' redirect doesn't mean the payment is
  // actually recorded yet, only the webhook flipping `status` to 'paid'
  // does, so this polls for a short while rather than trusting the
  // redirect itself (see this file's own doc comment).
  useEffect(() => {
    const status = searchParams.get('status')
    const orderId = searchParams.get('orderId')
    if (!status || !orderId || startedReturnFlowRef.current) return
    startedReturnFlowRef.current = true

    if (status === 'cancelled') {
      setScreen('select')
      setSearchParams({}, { replace: true })
      return
    }
    if (status !== 'success') return

    setScreen('confirming')
    const startedAt = Date.now()
    const poll = async () => {
      const found = await fetchKioskOrder(orderId)
      if (found?.status === 'paid') {
        setOrder(found)
        setDelivery('choice')
        setScreen('success')
        setSearchParams({}, { replace: true })
        return
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setScreen('timedOut')
        return
      }
      setTimeout(poll, POLL_MS)
    }
    poll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const openDetail = (product: KioskProduct & { id: string }) => {
    setDetailProductId(product.id)
    setDetailVariantId(product.variants[0]?.id ?? null)
    setDetailQty(1)
    setScreen('detail')
  }

  const detailProduct = products.find((p) => p.id === detailProductId) ?? null
  const detailVariant = detailProduct?.variants.find((v) => v.id === detailVariantId) ?? null

  const addToCart = () => {
    if (!detailProduct || !detailVariant) return
    const id = `${detailProduct.id}:${detailVariant.id}`
    setCart((prev) => {
      const existing = prev.find((l) => l.id === id)
      if (existing) {
        return prev.map((l) => (l.id === id ? { ...l, qty: l.qty + detailQty } : l))
      }
      return [
        ...prev,
        {
          id,
          productId: detailProduct.id,
          productName: detailProduct.name,
          variantId: detailVariant.id,
          variantName: detailVariant.name,
          unitPrice: detailVariant.price,
          qty: detailQty
        }
      ]
    })
    setScreen('select')
  }

  const removeCartLine = (id: string) => setCart((prev) => prev.filter((l) => l.id !== id))

  const countByProduct = (productId: string) => cart.filter((l) => l.productId === productId).reduce((s, l) => s + l.qty, 0)

  const totalCount = cart.reduce((s, l) => s + l.qty, 0)
  const totalPrice = cart.reduce((s, l) => s + l.qty * l.unitPrice, 0)

  const handlePay = async () => {
    if (!club || cart.length === 0) return
    setPayBusy(true)
    setPayError(null)
    try {
      const orderId = await createKioskOrder({
        clubId: club.id,
        lines: cart.map((line) => ({
          productId: line.productId,
          productName: line.productName,
          variantId: line.variantId,
          variantName: line.variantName,
          unitPrice: line.unitPrice,
          qty: line.qty
        }))
      })
      setScreen('redirecting')
      const url = await createKioskCheckoutSession({ clubId: club.id, orderId, appOrigin: window.location.origin })
      window.location.href = url
    } catch {
      setPayError('Platbu sa nepodarilo spustiť. Skúste to prosím znova.')
      setScreen('order')
    } finally {
      setPayBusy(false)
    }
  }

  const handlePrint = async () => {
    if (!order) return
    const url = `${window.location.origin}/kiosk/vstup/${order.id}/${order.cancellationToken}`
    const qr = await generateQrDataUrl(url)
    setPrintQr(qr)
    requestAnimationFrame(() => {
      window.print()
      setDelivery('printed')
    })
  }

  const handleSendEmail = async () => {
    if (!club || !order || !email.trim() || !email.includes('@')) {
      setEmailError('Zadajte platnú e-mailovú adresu.')
      return
    }
    setEmailBusy(true)
    setEmailError(null)
    try {
      await sendKioskOrderEmail({ clubId: club.id, orderId: order.id, email: email.trim(), appOrigin: window.location.origin })
      setDelivery('email-sent')
    } catch {
      setEmailError('E-mail sa nepodarilo odoslať. Skúste to prosím znova.')
    } finally {
      setEmailBusy(false)
    }
  }

  const handleNewOrder = () => {
    setCart([])
    setOrder(null)
    setDelivery(null)
    setEmail('')
    setEmailError(null)
    setPrintQr(null)
    startedReturnFlowRef.current = false
    setScreen('select')
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background-dark text-white flex flex-col print:hidden">
      {/* Top bar — no nav, no back, no menu: nothing to tap your way out with. */}
      <div className="shrink-0 h-14 flex items-center justify-between gap-3 px-4 sm:px-5 border-b border-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <img src="/icon-192.png" alt="" className="h-7 w-7 rounded-md shrink-0" />
          <span className="font-bold text-sm sm:text-base truncate">{club?.name ?? 'Pokladňa'}</span>
        </div>
        <span className="shrink-0 text-xs text-text-muted mono">kiosk režim</span>
      </div>

      {/* SELECT — fluid grid (no fixed breakpoints): tile width stays
          between MIN/MAX via auto-fill, so a phone gets 2 narrow columns
          and a wide tablet/monitor gets several comfortably-sized ones
          instead of a handful of oversized tiles. The whole area is capped
          at max-w-5xl and centered so it doesn't stretch indefinitely on a
          very wide screen. */}
      {screen === 'select' && (
        <div className="flex-1 min-h-0 flex flex-col items-center">
          <div className="w-full max-w-5xl flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pt-4 grid grid-cols-[repeat(auto-fill,minmax(130px,180px))] justify-center gap-3 sm:gap-4 content-start">
            {loadingProducts ? (
              <p className="text-text-muted col-span-full">Načítava sa...</p>
            ) : products.length === 0 ? (
              <p className="text-text-muted col-span-full">Momentálne nie je k dispozícii žiadna ponuka.</p>
            ) : (
              products.map((product) => {
                const count = countByProduct(product.id)
                const fromPrice = Math.min(...product.variants.map((v) => v.price))
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => openDetail(product)}
                    className="relative aspect-[4/3] rounded-2xl bg-background-card border border-border flex flex-col items-center justify-center gap-1.5 sm:gap-2 p-2.5 sm:p-3 hover:border-primary transition-colors"
                  >
                    {count > 0 && (
                      <span className="absolute -top-2.5 -right-2.5 min-w-[30px] h-7 sm:h-8 px-2 sm:px-2.5 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-extrabold text-xs sm:text-sm shadow">
                        ×{count}
                      </span>
                    )}
                    <div className="h-11 w-11 sm:h-14 sm:w-14 rounded-2xl bg-background-dark flex items-center justify-center text-primary">
                      <Ticket className="h-5 w-5 sm:h-7 sm:w-7" />
                    </div>
                    <p className="font-extrabold text-sm sm:text-base text-center leading-tight">{product.name}</p>
                    <p className="mono text-text-muted text-xs sm:text-sm">od {fmt(fromPrice)} €</p>
                  </button>
                )
              })
            )}
          </div>

          <div className="shrink-0 w-full max-w-5xl mx-auto my-3 sm:my-4 rounded-2xl bg-background-card border border-border px-4 sm:px-5 py-3.5 sm:py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
                <ShoppingCart className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">
                  {totalCount} {totalCount === 1 ? 'lístok' : 'lístky'}
                </p>
                <p className="mono text-xl font-extrabold">{fmt(totalPrice)} €</p>
              </div>
            </div>
            <button
              type="button"
              disabled={cart.length === 0}
              onClick={() => setScreen('order')}
              className="rounded-xl px-6 py-4 font-extrabold text-base disabled:cursor-not-allowed disabled:bg-border disabled:text-text-muted bg-primary text-primary-foreground hover:bg-primary-gold"
            >
              Zobraziť objednávku
            </button>
          </div>
        </div>
      )}

      {/* DETAIL */}
      {screen === 'detail' && detailProduct && (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col px-4 sm:px-6 py-5 max-w-xl w-full mx-auto">
          <button
            type="button"
            onClick={() => setScreen('select')}
            className="flex items-center gap-1.5 text-text-muted text-sm mb-4 self-start"
          >
            <ChevronLeft className="h-4 w-4" /> Späť na výber
          </button>

          <div className="flex items-center gap-4 mb-6">
            <div className="h-12 w-12 rounded-xl bg-background-card flex items-center justify-center text-primary">
              <Ticket className="h-6 w-6" />
            </div>
            <p className="font-extrabold text-2xl">{detailProduct.name}</p>
          </div>

          <p className="text-text-muted text-xs uppercase tracking-wide font-bold mb-2">Vyberte variantu</p>
          <div className="flex flex-col gap-2 mb-6">
            {detailProduct.variants.map((v) => {
              const selected = v.id === detailVariantId
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setDetailVariantId(v.id)}
                  className={`flex items-center justify-between rounded-xl border-2 px-4 py-3.5 ${
                    selected ? 'border-primary bg-primary/10' : 'border-border bg-background-card'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span className={`h-5 w-5 rounded-full border-2 ${selected ? 'border-primary bg-primary' : 'border-border-light'}`} />
                    <span className="font-semibold text-base">{v.name}</span>
                  </span>
                  <span className="mono font-bold text-primary">{fmt(v.price)} €</span>
                </button>
              )
            })}
          </div>

          <div className="flex items-center justify-between mb-6">
            <span className="font-semibold text-text-secondary">Počet</span>
            <div className="flex items-center gap-4">
              <button
                type="button"
                aria-label="Menej"
                onClick={() => setDetailQty((q) => Math.max(1, q - 1))}
                className="h-11 w-11 rounded-xl border border-border bg-background-card flex items-center justify-center"
              >
                <Minus className="h-5 w-5" />
              </button>
              <span className="mono font-extrabold text-xl w-8 text-center">{detailQty}</span>
              <button
                type="button"
                aria-label="Viac"
                onClick={() => setDetailQty((q) => q + 1)}
                className="h-11 w-11 rounded-xl bg-primary text-primary-foreground flex items-center justify-center"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={addToCart}
            className="mt-auto w-full rounded-2xl bg-primary text-primary-foreground font-extrabold text-lg py-4"
          >
            Pridať do objednávky — {fmt((detailVariant?.price ?? 0) * detailQty)} €
          </button>
        </div>
      )}

      {/* ORDER REVIEW */}
      {screen === 'order' && (
        <div className="flex-1 min-h-0 flex flex-col px-4 sm:px-6 py-5 max-w-2xl w-full mx-auto">
          <button
            type="button"
            onClick={() => setScreen('select')}
            className="flex items-center gap-1.5 text-text-muted text-sm mb-3 self-start"
          >
            <ChevronLeft className="h-4 w-4" /> Pridať ďalšie položky
          </button>
          <h1 className="font-extrabold text-2xl mb-3">Vaša objednávka</h1>

          {payError && <p className="text-status-danger text-sm mb-3">{payError}</p>}

          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
            {cart.map((line) => (
              <div key={line.id} className="flex items-center gap-3 bg-background-card border border-border rounded-xl px-4 py-3">
                <span className="mono shrink-0 h-8 w-8 rounded-lg bg-background-dark text-primary flex items-center justify-center font-bold text-sm">
                  {line.qty}×
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{line.productName}</p>
                  <p className="text-text-muted text-xs">{line.variantName}</p>
                </div>
                <span className="mono font-bold">{fmt(line.unitPrice * line.qty)} €</span>
                <button
                  type="button"
                  aria-label={`Odstrániť ${line.productName}`}
                  onClick={() => removeCartLine(line.id)}
                  className="shrink-0 h-9 w-9 rounded-lg border border-border text-status-danger flex items-center justify-center"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="shrink-0 mt-4 rounded-2xl bg-background-card border border-border px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-text-muted">
                Spolu — {totalCount} {totalCount === 1 ? 'lístok' : 'lístky'}
              </p>
              <p className="mono text-2xl font-extrabold">{fmt(totalPrice)} €</p>
            </div>
            <button
              type="button"
              disabled={payBusy || cart.length === 0}
              onClick={handlePay}
              className="flex items-center gap-2.5 rounded-xl bg-primary text-primary-foreground font-extrabold text-base px-7 py-4 disabled:opacity-60"
            >
              <CreditCard className="h-5 w-5" />
              {payBusy ? 'Spracúva sa...' : 'Zaplatiť kartou'}
            </button>
          </div>
        </div>
      )}

      {/* REDIRECTING / CONFIRMING (waiting on Stripe) */}
      {(screen === 'redirecting' || screen === 'confirming') && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 text-center">
          <div className="h-10 w-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="font-bold text-lg">{screen === 'redirecting' ? 'Presmerúva sa na platbu...' : 'Overuje sa platba...'}</p>
        </div>
      )}

      {screen === 'timedOut' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="font-bold text-lg">Platbu sa nepodarilo včas overiť.</p>
          <p className="text-text-muted text-sm max-w-sm">
            Ak vám bola suma odpočítaná, obráťte sa prosím na personál klubu s potvrdzovacím kódom z e-mailu/účtenky.
          </p>
          <button type="button" onClick={handleNewOrder} className="rounded-xl border border-border px-6 py-3 font-semibold">
            Nový nákup
          </button>
        </div>
      )}

      {/* SUCCESS */}
      {screen === 'success' && order && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 text-center">
          <div className="h-16 w-16 rounded-full bg-status-success flex items-center justify-center">
            <CheckCircle2 className="h-9 w-9 text-background-dark" />
          </div>
          <p className="font-extrabold text-xl">Platba úspešná — {fmt(order.totalAmount)} €</p>

          {delivery === 'choice' && (
            <>
              <p className="text-text-muted text-sm">Ako chcete dostať svoj lístok (QR kód)?</p>
              <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
                <button
                  type="button"
                  onClick={handlePrint}
                  className="flex flex-col items-center gap-2 w-28 sm:w-36 rounded-2xl border-2 border-border bg-background-card py-4 sm:py-5 px-3"
                >
                  <Printer className="h-6 w-6 text-primary" />
                  <span className="font-bold text-sm">Vytlačiť</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDelivery('email-form')}
                  className="flex flex-col items-center gap-2 w-28 sm:w-36 rounded-2xl border-2 border-border bg-background-card py-4 sm:py-5 px-3"
                >
                  <Mail className="h-6 w-6 text-primary" />
                  <span className="font-bold text-sm">Poslať e-mailom</span>
                </button>
              </div>
            </>
          )}

          {delivery === 'email-form' && (
            <div className="flex flex-col gap-2.5 w-full max-w-sm">
              <label htmlFor="kioskEmail" className="text-xs text-text-muted text-left">
                Zadajte e-mail, pošleme QR kód lístka
              </label>
              <div className="flex gap-2">
                <input
                  id="kioskEmail"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vas@email.sk"
                  className="flex-1 bg-background-card border border-border rounded-xl px-4 py-3 text-white"
                />
                <button
                  type="button"
                  onClick={handleSendEmail}
                  disabled={emailBusy}
                  className="shrink-0 bg-primary text-primary-foreground rounded-xl px-5 font-extrabold disabled:opacity-60"
                >
                  {emailBusy ? '...' : 'Odoslať'}
                </button>
              </div>
              {emailError && <p className="text-status-danger text-xs">{emailError}</p>}
            </div>
          )}

          {delivery === 'printed' && (
            <div className="flex items-center gap-4 bg-background-card border border-border rounded-2xl px-6 py-4 max-w-sm">
              <Printer className="h-10 w-10 text-primary shrink-0" />
              <p className="text-sm text-left">Váš lístok sa tlačí — odtrhnite si ho a naskenujte pri vstupe.</p>
            </div>
          )}

          {delivery === 'email-sent' && (
            <div className="flex items-center gap-3 bg-background-card border border-border rounded-2xl px-6 py-4">
              <CheckCircle2 className="h-6 w-6 text-status-success shrink-0" />
              <p className="font-semibold text-sm">QR kód odoslaný na {email}</p>
            </div>
          )}

          {delivery && delivery !== 'email-form' && (
            <button type="button" onClick={handleNewOrder} className="mt-2 rounded-xl border border-border px-6 py-3 font-semibold text-sm">
              Nový nákup
            </button>
          )}
        </div>
      )}

      {/* Hidden print-only receipt, rendered only in print output. */}
      {order && printQr && (
        <div className="hidden print:flex print:flex-col print:items-center print:gap-3 print:p-6 print:text-black">
          <p className="font-bold text-lg">{club?.name}</p>
          <p className="font-bold">Vstupenka</p>
          <div className="text-sm">
            {order.lines.map((l, i) => (
              <p key={i}>
                {l.qty}× {l.productName} — {l.variantName}
              </p>
            ))}
          </div>
          <p className="font-bold">Spolu: {fmt(order.totalAmount)} €</p>
          <p>Potvrdzovací kód: {order.confirmationCode}</p>
          <img src={printQr} alt="QR kód vstupenky" className="w-48 h-48" />
          <p className="text-xs">Naskenujte tento QR kód pri vstupe.</p>
        </div>
      )}
    </div>
  )
}
