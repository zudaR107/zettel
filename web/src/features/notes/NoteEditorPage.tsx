import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, Link } from '@tanstack/react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Pin, Archive } from 'lucide-react'
import { SegmentedControl, Button } from '@zudar107/schloss-ui'
import { api } from '../../lib/api'
import type { Note } from '../../lib/types'
import 'highlight.js/styles/github.css'

type ViewMode = 'edit' | 'preview' | 'split'

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'edit', label: 'Правка' },
  { value: 'preview', label: 'Просмотр' },
  { value: 'split', label: 'Разделить' },
]

export function NoteEditorPage() {
  const { id } = useParams({ from: '/protected/notes/$id' })
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<ViewMode>('split')

  const { data: note } = useQuery<Note>({
    queryKey: ['note', id],
    queryFn: () => api.get(`/notes/${id}`),
  })

  // Only initializes local state from the server's data - once the user
  // starts typing, `note` (the query cache) stays put as the "last saved"
  // baseline (see the autosave effect below), so this never overwrites
  // in-progress edits with stale server data.
  useEffect(() => {
    if (note) {
      setTitle(note.title)
      setContent(note.content)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id])

  const saveMutation = useMutation({
    mutationFn: (data: { title: string; content: string }) => api.put<Note>(`/notes/${id}`, data),
    onSuccess: (updated) => {
      qc.setQueryData(['note', id], updated)
      qc.invalidateQueries({ queryKey: ['notes'] })
    },
  })

  // Debounced autosave - only schedules a save when local state actually
  // diverges from the last-known server state (`note`), so it neither
  // fires on initial load (title/content are set to exactly `note`'s own
  // values above) nor loops forever (a successful save updates the query
  // cache to match, via onSuccess above).
  useEffect(() => {
    if (!note) return
    if (title === note.title && content === note.content) return
    const t = setTimeout(() => saveMutation.mutate({ title, content }), 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, note])

  const pinMutation = useMutation({
    mutationFn: (pinned: boolean) => api.put<Note>(`/notes/${id}`, { pinned }),
    onSuccess: (updated) => {
      qc.setQueryData(['note', id], updated)
      qc.invalidateQueries({ queryKey: ['notes'] })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: () => api.delete(`/notes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes'] })
      void navigate({ to: '/notes' })
    },
  })

  if (!note) return null

  const showEdit = mode === 'edit' || mode === 'split'
  const showPreview = mode === 'preview' || mode === 'split'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>
            <Link to="/notes" style={{ color: 'inherit', textDecoration: 'none' }}>Заметки</Link> / {title || 'Без названия'}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Без названия"
            style={{
              font: 'inherit', fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em',
              color: 'var(--text-primary)', border: 'none', outline: 'none', background: 'none',
              width: '100%', padding: 0,
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          <Button
            variant="ghost"
            style={{ padding: '0.4rem', color: note.pinned ? 'var(--accent)' : undefined }}
            onClick={() => pinMutation.mutate(!note.pinned)}
            aria-label={note.pinned ? 'Открепить' : 'Закрепить'}
          >
            <Pin size={16} fill={note.pinned ? 'currentColor' : 'none'} />
          </Button>
          <Button variant="ghost" style={{ padding: '0.4rem' }} onClick={() => archiveMutation.mutate()} aria-label="Архивировать заметку">
            <Archive size={16} />
          </Button>
          <SegmentedControl options={VIEW_OPTIONS} value={mode} onChange={setMode} />
        </div>
      </div>

      <div style={{
        display: 'grid', gap: '1rem',
        gridTemplateColumns: showEdit && showPreview ? '1fr 1fr' : '1fr',
        minHeight: 420,
      }}>
        {showEdit && (
          <textarea
            className="input"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Пишите здесь на markdown…"
            style={{
              minHeight: 420, resize: 'vertical', fontFamily: 'ui-monospace, monospace',
              fontSize: '0.8125rem', lineHeight: 1.7,
            }}
          />
        )}
        {showPreview && (
          <div className="card" style={{ padding: '1rem', minHeight: 420, overflow: 'auto' }}>
            {content ? (
              <div className="markdown-preview">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {content}
                </ReactMarkdown>
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Нечего показать</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
