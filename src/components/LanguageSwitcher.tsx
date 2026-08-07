import { useTranslation } from 'react-i18next'
import { setLanguage, SupportedLanguage } from '@/i18n'
import { cn } from '@/lib/utils'

const LANGUAGES: { code: SupportedLanguage; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'sk', label: 'SK' }
]

export default function LanguageSwitcher() {
  const { i18n } = useTranslation()

  return (
    <div className="flex rounded-md border border-border overflow-hidden text-xs">
      {LANGUAGES.map(({ code, label }) => (
        <button
          key={code}
          onClick={() => setLanguage(code)}
          aria-current={i18n.language === code}
          className={cn(
            'px-2 py-1 font-medium transition-colors',
            i18n.language === code
              ? 'bg-primary text-primary-foreground'
              : 'bg-background-card text-text-secondary hover:bg-background-cardHover'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
