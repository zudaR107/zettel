import { NotebookText } from 'lucide-react'
import { ICON_SIZE } from '@zudar107/schloss-ui'

// Placeholder - replaced by the real notes list/editor once the notes
// core feature lands (see the "Notes core" milestone).
export function NotesPage() {
  return (
    <div style={{ maxWidth: 440, margin: '4rem auto 0', textAlign: 'center' }}>
      <div style={{
        width: 52, height: 52, borderRadius: 14, background: 'var(--accent-muted)',
        color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 1rem',
      }}>
        <NotebookText size={ICON_SIZE.illustrative} strokeWidth={2} />
      </div>
      <h2 style={{ margin: '0 0 0.5rem', color: 'var(--text-primary)', fontSize: '1.125rem', fontWeight: 600 }}>
        Заметки скоро появятся
      </h2>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        Эта страница станет вашим быстрым хранилищем заметок с поддержкой markdown.
      </p>
    </div>
  )
}
