import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch, Link } from '@tanstack/react-router'
import { Plus, Pin, RotateCcw, Search, Tag as TagIcon, X } from 'lucide-react'
import { EmptyState, Button, SegmentedControl, formatDate, type DatePrefs } from '@zudar107/schloss-ui'
import { api } from '../../lib/api'
import type { Note } from '../../lib/types'
import { HeroIllustration } from '../../components/HeroIllustration'
import { useDatePrefs } from '../../hooks/useDatePrefs'

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
  // Set by clicking a tag "folder" in the sidebar (see Layout.tsx) -
  // strict: false since this same component also renders at plain
  // /notes, with no search params at all.
  const { tag } = useSearch({ strict: false }) as { tag?: string }
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'active' | 'archived'>('active')
  const debouncedQuery = useDebounced(query, 300)
  const datePrefs = useDatePrefs()
  const archived = view === 'archived'

  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ['notes', view, debouncedQuery, tag ?? ''],
    queryFn: () => {
      const params = new URLSearchParams()
      if (archived) params.set('archived', 'true')
      if (debouncedQuery) params.set('q', debouncedQuery)
      if (tag) params.set('tag', tag)
      const qs = params.toString()
      return api.get(`/notes${qs ? `?${qs}` : ''}`)
    },
  })

  const createMutation = useMutation({
    mutationFn: () => api.post<Note>('/notes', { title: '', content: '' }),
    onSuccess: (note) => {
      qc.invalidateQueries({ queryKey: ['notes'] })
      void navigate({ to: '/notes/$id', params: { id: note.id } })
    },
  })

  const restoreMutation = useMutation({
    mutationFn: (id: string) => api.post<Note>(`/notes/${id}/restore`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes'] })
      qc.invalidateQueries({ queryKey: ['tags'] })
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

      <div style={{ marginBottom: '1rem' }}>
        <SegmentedControl
          options={[
            { value: 'active', label: 'Активные' },
            { value: 'archived', label: 'Архивные' },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      {restoreMutation.isError && (
        <p role="alert" style={{ margin: '0 0 1rem', fontSize: '0.8125rem', color: 'var(--danger)' }}>
          Не удалось восстановить заметку. Попробуйте ещё раз.
        </p>
      )}

      {notes.length === 0 && !query && !tag && !archived ? (
        <EmptyState
          illustration={<HeroIllustration size={100} />}
          title="Заметок пока нет"
          description="Создайте первую заметку — писать можно сразу в markdown, с live-превью."
          actionLabel="Новая заметка"
          actionIcon={<Plus size={16} />}
          onAction={() => createMutation.mutate()}
        />
      ) : notes.length === 0 && !query && !tag ? (
        <EmptyState
          title="Архив пуст"
          description="Архивированные заметки появятся здесь, и их можно будет восстановить."
          actionLabel="К активным заметкам"
          onAction={() => setView('active')}
        />
      ) : (
        <>
          {tag && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                background: 'var(--accent-muted)', color: 'var(--accent-text)',
                borderRadius: 6, padding: '0.25rem 0.5rem 0.25rem 0.625rem',
                fontSize: '0.8125rem', fontWeight: 600,
              }}>
                <TagIcon size={13} />
                {tag}
                <Link
                  to="/notes"
                  aria-label="Сбросить фильтр по тегу"
                  style={{ display: 'flex', color: 'inherit', opacity: 0.7, marginLeft: 2 }}
                >
                  <X size={13} />
                </Link>
              </span>
            </div>
          )}
          <div style={{ position: 'relative', maxWidth: 320, marginBottom: '1.25rem' }}>
            <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="input"
              style={{ paddingLeft: '2rem', paddingRight: '3rem' }}
              placeholder="Поиск заметок…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {/* Hints at the Ctrl+K quick switcher (see QuickSwitcher.tsx,
                mounted globally in Layout) - this field itself only
                filters this page's list, the shortcut jumps straight to
                a note from anywhere. */}
            <span style={{
              position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)',
              fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)',
              background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 4,
              padding: '0.0625rem 0.3rem', pointerEvents: 'none',
            }}>
              Ctrl K
            </span>
          </div>

          {notes.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Ничего не найдено.</p>
          ) : (
            <>
              {!archived && pinned.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <SectionLabel icon={<Pin size={13} />} text="Закреплённые" />
                  <NoteGrid notes={pinned} datePrefs={datePrefs} />
                </div>
              )}
              {!archived && rest.length > 0 && (
                <div>
                  {pinned.length > 0 && <SectionLabel text="Остальные" />}
                  <NoteGrid notes={rest} datePrefs={datePrefs} />
                </div>
              )}
              {archived && (
                <NoteGrid
                  notes={notes}
                  datePrefs={datePrefs}
                  onRestore={(id) => restoreMutation.mutate(id)}
                  restoringId={restoreMutation.isPending ? restoreMutation.variables : undefined}
                />
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

function NoteGrid({
  notes,
  datePrefs,
  onRestore,
  restoringId,
}: {
  notes: Note[]
  datePrefs: DatePrefs
  onRestore?: (id: string) => void
  restoringId?: string
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.875rem' }}>
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          datePrefs={datePrefs}
          onRestore={onRestore}
          restoring={restoringId === note.id}
        />
      ))}
    </div>
  )
}

function NoteCard({
  note,
  datePrefs,
  onRestore,
  restoring,
}: {
  note: Note
  datePrefs: DatePrefs
  onRestore?: (id: string) => void
  restoring: boolean
}) {
  const contents = (
    <>
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
        {formatRelative(note.updatedAt, datePrefs)}
      </div>
      {onRestore && (
        <Button
          variant="secondary"
          style={{ alignSelf: 'flex-start', fontSize: '0.75rem', padding: '0.3rem 0.625rem' }}
          onClick={() => onRestore(note.id)}
          disabled={restoring}
        >
          <RotateCcw size={14} /> {restoring ? 'Восстановление…' : 'Восстановить'}
        </Button>
      )}
    </>
  )

  const style = {
    padding: '1rem', display: 'flex', flexDirection: 'column' as const, gap: '0.5rem',
    textDecoration: 'none', minHeight: 120,
  }

  if (onRestore) return <div className="card" style={style}>{contents}</div>

  return (
    <Link to="/notes/$id" params={{ id: note.id }} className="card" style={{ ...style, cursor: 'pointer' }}>
      {contents}
    </Link>
  )
}

function formatRelative(iso: string, datePrefs: DatePrefs): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} дн назад`
  return formatDate(iso, datePrefs)
}
