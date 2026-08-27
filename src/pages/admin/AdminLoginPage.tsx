import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import BackButton from '@/components/BackButton'

export default function AdminLoginPage() {
  const { t } = useTranslation()
  const { login, resetPassword } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // A "forgot password?" mode swaps the password field for a single
  // confirmation message once submitted — see resetPassword's own doc
  // comment for why the same message shows regardless of whether the
  // email actually has an account.
  const [resetMode, setResetMode] = useState(false)
  const [resetSubmitting, setResetSubmitting] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      navigate('/admin')
    } catch (err) {
      console.error('Login failed:', err)
      setError(t('admin.invalidCredentials'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setResetSubmitting(true)
    try {
      await resetPassword(email)
    } catch (err) {
      console.error('Password reset request failed:', err)
    } finally {
      setResetSubmitting(false)
      setResetSent(true)
    }
  }

  return (
    <div className="content-container py-12 max-w-sm mx-auto">
      <BackButton fallback="/" />
      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white">{resetMode ? t('admin.resetPasswordTitle') : t('admin.loginTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {resetMode ? (
            resetSent ? (
              <div className="space-y-4">
                <p className="text-text-secondary text-sm">{t('admin.resetPasswordSent')}</p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setResetMode(false)
                    setResetSent(false)
                  }}
                >
                  {t('admin.backToLogin')}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleReset} className="space-y-4">
                <p className="text-text-secondary text-sm">{t('admin.resetPasswordHint')}</p>
                <div>
                  <Label htmlFor="reset-email" className="text-white">{t('common.email')}</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-background-dark border-border text-white"
                    required
                  />
                </div>
                <Button type="submit" disabled={resetSubmitting} className="w-full bg-primary hover:bg-primary-gold text-primary-foreground">
                  {resetSubmitting ? t('common.saving') : t('admin.sendResetLink')}
                </Button>
                <button type="button" onClick={() => setResetMode(false)} className="block w-full text-center text-text-muted text-sm hover:text-primary">
                  {t('admin.backToLogin')}
                </button>
              </form>
            )
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && <p className="text-status-danger text-sm">{error}</p>}
                <div>
                  <Label htmlFor="email" className="text-white">{t('common.email')}</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-background-dark border-border text-white"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="password" className="text-white">{t('admin.password')}</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-background-dark border-border text-white"
                    required
                  />
                </div>
                <Button type="submit" disabled={submitting} className="w-full bg-primary hover:bg-primary-gold text-primary-foreground">
                  {submitting ? t('admin.signingIn') : t('admin.signIn')}
                </Button>
                <button type="button" onClick={() => setResetMode(true)} className="block w-full text-center text-text-muted text-sm hover:text-primary">
                  {t('admin.forgotPassword')}
                </button>
              </form>
              <p className="text-text-muted text-sm text-center mt-4">
                <Link to="/admin/signup" className="hover:text-primary">{t('admin.createAccount')}</Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
