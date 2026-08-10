import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { downloadDataUrl, generateQrDataUrl } from '@/lib/qrcode'
import { Button } from './ui/button'

interface QrCodeDisplayProps {
  value: string
  filename: string
  label: string
}

export default function QrCodeDisplay({ value, filename, label }: QrCodeDisplayProps) {
  const { t } = useTranslation()
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDataUrl(null)
    generateQrDataUrl(value).then((url) => {
      if (!cancelled) setDataUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [value])

  return (
    <div className="flex flex-col items-center gap-2 p-3 border border-border rounded-md bg-background-dark w-40">
      <p className="text-white text-xs text-center break-words">{label}</p>
      {dataUrl ? (
        <img src={dataUrl} alt={label} className="w-32 h-32 bg-white p-1 rounded" />
      ) : (
        <div className="w-32 h-32 flex items-center justify-center text-text-muted text-xs">{t('common.loading')}</div>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={!dataUrl}
        onClick={() => dataUrl && downloadDataUrl(dataUrl, filename)}
        className="w-full"
      >
        {t('admin.download')}
      </Button>
    </div>
  )
}
