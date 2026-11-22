import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import {
  createKioskProduct,
  deleteKioskProduct,
  fetchKioskProducts,
  setKioskProductActive,
  updateKioskProduct
} from '@/lib/kiosk'
import { KioskProduct, KioskVariant } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import BackButton from '@/components/BackButton'

interface VariantRow {
  id?: string
  name: string
  price: string
}

const EMPTY_VARIANT_ROW: VariantRow = { name: '', price: '' }

/**
 * "Kiosk — položky a ceny" — the owner-only backend behind the entrance
 * kiosk tablet (see CLAUDE.md's "Riešenie 2" discussion: a touch kiosk,
 * one square tile per product, tap a tile to pick a variant — dospelí/
 * dieťa/s voucherom — and a quantity, pay by card). This page only ever
 * manages the catalog (KioskProduct docs); the public kiosk page itself,
 * the Stripe Checkout wiring, and the QR/entrance check-in are a separate,
 * later pass — this is deliberately just the "what's on offer and for how
 * much" half, which is also the one piece an owner needs to be able to
 * change without a code deploy.
 *
 * Owner/superadmin only — narrower than every other staff-config page in
 * this app (which typically also trusts a plain assistant/trainer), per
 * explicit product direction that pricing is an owner-level decision.
 */
export default function AdminKioskPage() {
  const { t } = useTranslation()
  const { staff } = useAuth()
  const { club, loading: clubLoading } = useClubData()

  const canManage = staff?.role === 'owner' || staff?.role === 'superadmin'

  const [products, setProducts] = useState<(KioskProduct & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [variantRows, setVariantRows] = useState<VariantRow[]>([{ ...EMPTY_VARIANT_ROW }])
  const [busy, setBusy] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const refresh = async () => {
    if (!club) return
    setLoading(true)
    try {
      setProducts(await fetchKioskProducts(club.id))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club])

  const resetForm = () => {
    setEditingId(null)
    setName('')
    setVariantRows([{ ...EMPTY_VARIANT_ROW }])
  }

  const handleEdit = (product: KioskProduct & { id: string }) => {
    setEditingId(product.id)
    setName(product.name)
    setVariantRows(product.variants.map((v) => ({ id: v.id, name: v.name, price: String(v.price).replace('.', ',') })))
  }

  const handleVariantChange = (index: number, field: 'name' | 'price', value: string) => {
    setVariantRows((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  const handleAddVariantRow = () => setVariantRows((rows) => [...rows, { ...EMPTY_VARIANT_ROW }])

  const handleRemoveVariantRow = (index: number) =>
    setVariantRows((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows))

  const parsedVariants = variantRows
    .map((r) => ({ id: r.id, name: r.name.trim(), price: parseFloat(r.price.replace(',', '.')) }))
    .filter((v) => v.name && Number.isFinite(v.price) && v.price >= 0)

  const canSubmit = name.trim().length > 0 && parsedVariants.length > 0 && !busy

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!club || !staff || !canSubmit) return
    setBusy(true)
    try {
      if (editingId) {
        const existing = products.find((p) => p.id === editingId)
        await updateKioskProduct(editingId, {
          name: name.trim(),
          variants: parsedVariants as KioskVariant[],
          active: existing?.active ?? true,
          sortOrder: existing?.sortOrder ?? products.length
        })
      } else {
        await createKioskProduct({
          clubId: club.id,
          name: name.trim(),
          variants: parsedVariants,
          active: true,
          sortOrder: products.length,
          createdBy: staff.uid,
          createdByName: staff.name
        })
      }
      resetForm()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleToggleActive = async (product: KioskProduct & { id: string }) => {
    setTogglingId(product.id)
    try {
      await setKioskProductActive(product.id, !product.active)
      await refresh()
    } finally {
      setTogglingId(null)
    }
  }

  const handleDelete = async (product: KioskProduct & { id: string }) => {
    if (!window.confirm(t('kiosk.confirmDelete', { name: product.name }))) return
    await deleteKioskProduct(product.id)
    if (editingId === product.id) resetForm()
    await refresh()
  }

  if (!canManage) {
    return (
      <div className="content-container py-12 max-w-md mx-auto text-center space-y-4">
        <BackButton fallback="/admin" />
        <h1 className="text-white text-xl font-bold">{t('kiosk.notAuthorizedTitle')}</h1>
        <p className="text-text-secondary">{t('kiosk.notAuthorizedNotice')}</p>
      </div>
    )
  }

  return (
    <div className="content-container py-6 space-y-6 max-w-2xl mx-auto">
      <BackButton fallback="/admin" />
      <div>
        <h1 className="text-2xl font-bold text-white">{t('kiosk.title')}</h1>
        <p className="text-text-secondary text-sm mt-1">{t('kiosk.intro')}</p>
        <a href="/kiosk" target="_blank" rel="noreferrer" className="inline-block mt-2 text-primary hover:text-primary-gold text-sm underline">
          {t('kiosk.openKiosk')}
        </a>
      </div>

      {clubLoading || loading ? (
        <p className="text-text-muted">{t('common.loading')}</p>
      ) : (
        <div className="space-y-3">
          {products.length === 0 && <p className="text-text-muted text-sm">{t('kiosk.none')}</p>}
          {products.map((product) => (
            <Card key={product.id} className={`arena-card ${product.active ? '' : 'opacity-55'}`}>
              <CardContent className="py-4 flex items-start gap-4">
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-white font-semibold text-base">{product.name}</p>
                  <div className="flex flex-wrap gap-2">
                    {product.variants.map((v) => (
                      <span
                        key={v.id}
                        className="inline-flex items-center gap-1 rounded-full bg-background-dark border border-border px-2.5 py-1 text-xs text-text-secondary"
                      >
                        {v.name}
                        <span className="text-primary font-semibold mono">{v.price.toFixed(2).replace('.', ',')} €</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={product.active}
                    aria-label={product.active ? t('kiosk.deactivate', { name: product.name }) : t('kiosk.activate', { name: product.name })}
                    disabled={togglingId === product.id}
                    onClick={() => handleToggleActive(product)}
                    className="relative w-11 h-6 rounded-full border-none cursor-pointer disabled:opacity-50"
                    style={{ background: product.active ? '#22c55e' : '#3a3a3a' }}
                  >
                    <span
                      className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
                      style={{ left: product.active ? '22px' : '2px' }}
                    />
                  </button>
                  <div className="flex gap-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => handleEdit(product)}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-status-danger"
                      onClick={() => handleDelete(product)}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-base">{editingId ? t('kiosk.editProduct') : t('kiosk.newProduct')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="kioskName">{t('kiosk.productName')}</Label>
              <Input
                id="kioskName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('kiosk.productNamePlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('kiosk.variants')}</Label>
              {variantRows.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={row.name}
                    onChange={(e) => handleVariantChange(index, 'name', e.target.value)}
                    placeholder={t('kiosk.variantNamePlaceholder')}
                    className="flex-1"
                  />
                  <Input
                    value={row.price}
                    onChange={(e) => handleVariantChange(index, 'price', e.target.value)}
                    placeholder="3,50"
                    className="w-24 mono"
                    inputMode="decimal"
                  />
                  <span className="text-text-muted text-sm">€</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleRemoveVariantRow(index)}
                    disabled={variantRows.length <= 1}
                    aria-label={t('kiosk.removeVariant')}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={handleAddVariantRow}>
                {t('kiosk.addVariant')}
              </Button>
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={!canSubmit} className="bg-primary hover:bg-primary-gold text-primary-foreground">
                {busy ? t('common.saving') : editingId ? t('common.save') : t('kiosk.addProduct')}
              </Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={resetForm}>
                  {t('common.cancel')}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
