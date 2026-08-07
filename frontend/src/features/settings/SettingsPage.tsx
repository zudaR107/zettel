import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { Button } from '@zudar107/schloss-ui'
import { api } from '../../lib/api'

interface UserProfile {
  id: string
  email: string
  name: string
}

export function SettingsPage() {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(false)
  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ['userProfile'],
    queryFn: () => api.get('/users/me'),
  })

  async function downloadExport() {
    setExporting(true)
    setExportError(false)
    try {
      const data = await api.get('/users/export')
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `zettel-export-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setExportError(true)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ maxWidth: 500, margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          Настройки
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
          Профиль
        </p>
      </div>

      <div className="card" style={{ padding: '1.5rem' }}>
        {isLoading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Загрузка…</div>
        ) : profile ? (
          <div>
            <div className="label">Аккаунт</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>{profile.name}</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{profile.email}</div>
          </div>
        ) : null}
        <p style={{ margin: '1rem 0 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          Смена пароля и удаление аккаунта — в настройках Schlüssel (доступны через значок профиля в шапке).
        </p>
      </div>

      <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
        <div className="label">Экспорт данных</div>
        <p style={{ margin: '0 0 1rem', fontSize: '0.8125rem', lineHeight: 1.5, color: 'var(--text-muted)' }}>
          Скачайте JSON со всеми заметками Zettel, включая архивные заметки и теги.
        </p>
        <Button variant="secondary" onClick={() => void downloadExport()} disabled={exporting}>
          <Download size={15} /> {exporting ? 'Подготовка…' : 'Скачать экспорт'}
        </Button>
        {exportError && (
          <p role="alert" style={{ margin: '0.75rem 0 0', fontSize: '0.8125rem', color: 'var(--danger)' }}>
            Не удалось скачать данные. Попробуйте ещё раз.
          </p>
        )}
      </div>
    </div>
  )
}
