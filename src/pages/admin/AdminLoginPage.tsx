import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function AdminLoginPage() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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

  return (
    <div className="content-container py-12 max-w-sm mx-auto">
      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white">{t('admin.loginTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
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
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
