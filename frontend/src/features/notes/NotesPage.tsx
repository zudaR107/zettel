import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, Link } from '@tanstack/react-router'
import { Plus, Pin, Search } from 'lucide-react'
import { EmptyState, Button } from '@zudar107/schloss-ui'
import { api } from '../../lib/api'
import type { Note } from '../../lib/types'
import { HeroIllustration } from '../../components/HeroIllustration'

// Debounced so typing doesn't fire a request per keystroke - 300ms is
// short enough to still feel live, long enough to skip intermediate
// characters of a fast typist.
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

export function NotesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query, 300)

  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ['notes', debouncedQuery],
    queryFn: () => api.get(`/notes${debouncedQuery ? `?q=${encodeURIComponent(debouncedQuery)}` : ''}`),
  })

  const createMutation = useMutation({
    mutationFn: () => api.post<Note>('/notes', { title: '', content: '' }),
    onSuccess: (note) => {
      qc.invalidateQueries({ queryKey: ['notes'] })
      void navigate({ to: '/notes/$id', params: { id: note.id } })
    },
  })

  if (isLoading) return null

  const pinned = notes.filter((n) => n.pinned)
  const rest = notes.filter((n) => !n.pinned)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Заметки
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
            {notes.length} {notes.length === 1 ? 'заметка' : 'заметок'}
          </p>
        </div>
        <Button variant="primary" style={{ fontSize: '0.8125rem', padding: '0.4rem 0.875rem' }} onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
          <Plus size={15} /> Новая заметка
        </Button>
      </div>

      {notes.length === 0 && !query ? (
        <EmptyState
          illustration={<HeroIllustration size={100} />}
          title="Заметок пока нет"
          description="Создайте первую заметку — писать можно сразу в markdown, с live-превью."
          actionLabel="Новая заметка"
          actionIcon={<Plus size={16} />}
          onAction={() => createMutation.mutate()}
        />
      ) : (
        <>
          <div style={{ position: 'relative', maxWidth: 320, marginBottom: '1.25rem' }}>
            <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="input"
              style={{ paddingLeft: '2rem' }}
              placeholder="Поиск заметок…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {notes.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Ничего не найдено.</p>
          ) : (
            <>
              {pinned.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <SectionLabel icon={<Pin size={13} />} text="Закреплённые" />
                  <NoteGrid notes={pinned} />
                </div>
              )}
              {rest.length > 0 && (
                <div>
                  {pinned.length > 0 && <SectionLabel text="Остальные" />}
                  <NoteGrid notes={rest} />
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function SectionLabel({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.625rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {icon}{text}
    </div>
  )
}

function NoteGrid({ notes }: { notes: Note[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.875rem' }}>
      {notes.map((note) => <NoteCard key={note.id} note={note} />)}
    </div>
  )
}

function NoteCard({ note }: { note: Note }) {
  return (
    <Link
      to="/notes/$id"
      params={{ id: note.id }}
      className="card"
      style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', textDecoration: 'none', cursor: 'pointer', minHeight: 120 }}
    >
      <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
        {note.pinned && <Pin size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {note.title || 'Без названия'}
        </span>
      </div>
      <div style={{
        fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5,
        overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
      }}>
        {note.content || 'Пусто'}
      </div>
      {note.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
          {note.tags.map((tag) => (
            <span
              key={tag}
              style={{
                background: 'var(--accent-muted)', color: 'var(--accent-text)',
                borderRadius: 6, padding: '0.1rem 0.375rem',
                fontSize: '0.6875rem', fontWeight: 600,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 'auto' }}>
        {formatRelative(note.updatedAt)}
      </div>
    </Link>
  )
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} дн назад`
  return new Date(iso).toLocaleDateString('ru-RU')
}
