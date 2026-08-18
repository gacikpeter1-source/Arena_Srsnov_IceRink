import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import SignupModeSwitch from '@/components/SignupModeSwitch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function AdminSignupPage() {
  const { t } = useTranslation()
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signup(email, password, name)
      navigate('/admin')
    } catch (err) {
      console.error('Sign up failed:', err)
      setError(t('admin.signupError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="content-container py-12 max-w-sm mx-auto">
      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white">{t('admin.signupTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <SignupModeSwitch active="staff" />
          <p className="text-text-secondary text-sm mb-4">{t('admin.signupNotice')}</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="text-status-danger text-sm">{error}</p>}
            <div>
              <Label htmlFor="name" className="text-white">{t('common.name')}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-background-dark border-border text-white"
                required
              />
            </div>
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
                minLength={6}
                required
              />
            </div>
            <Button type="submit" disabled={submitting} className="w-full bg-primary hover:bg-primary-gold text-primary-foreground">
              {submitting ? t('admin.signingUp') : t('admin.signUp')}
            </Button>
          </form>
          <p className="text-text-muted text-sm text-center mt-4">
            <Link to="/admin/login" className="hover:text-primary">{t('admin.haveAccount')}</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
