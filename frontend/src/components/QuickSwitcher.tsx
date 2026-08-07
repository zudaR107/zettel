import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { api } from '../lib/api'
import type { Note } from '../lib/types'

const MAX_RESULTS = 8

// A Ctrl+K / Cmd+K command palette for jumping straight to a note by
// title - mounted once in Layout so the shortcut works from any page.
// Reuses the ['notes', ''] query cache key NotesPage's own unfiltered
// list and NoteEditorPage's wiki-link resolution already populate,
// rather than issuing a fresh request every time it opens.
export function QuickSwitcher() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: notes = [] } = useQuery<Note[]>({
    queryKey: ['notes', ''],
    queryFn: () => api.get('/notes'),
    enabled: open,
  })

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? notes.filter((n) => n.title.toLowerCase().includes(q)) : notes
    return filtered.slice(0, MAX_RESULTS)
  }, [notes, query])

  function close() {
    setOpen(false)
  }

  function go(note: Note) {
    close()
    void navigate({ to: '/notes/$id', params: { id: note.id } })
  }

  // Reserve the browser shortcut in a stable capture-phase listener. It
  // must preventDefault during the key event itself (before Chrome opens
  // browser search), and repeated presses only refocus the palette.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  // Escape/arrows/Enter work regardless of which palette control has focus.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!open) return
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted((h) => Math.min(h + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted((h) => Math.max(h - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const note = results[highlighted]
        if (note) go(note)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, results, highlighted])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setHighlighted(0)
    // Focus after the input actually mounts - it's conditionally rendered
    // (this whole component returns null while closed), so it doesn't
    // exist yet at the moment `open` flips true.
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  // Re-clamps to the top result whenever the query changes, so a stale
  // index from a longer previous result set can't point past the end of
  // a shorter new one.
  useEffect(() => setHighlighted(0), [query])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'var(--bg-overlay)', zIndex: 100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '15vh',
      }}
      onClick={close}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: 480, padding: 0, overflow: 'hidden', margin: '0 1rem' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)' }}>
          <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Перейти к заметке…"
            style={{
              font: 'inherit', fontSize: '0.9375rem', border: 'none', outline: 'none',
              background: 'none', color: 'var(--text-primary)', width: '100%',
            }}
          />
        </div>

        {results.length === 0 ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Ничего не найдено
          </div>
        ) : (
          <div style={{ padding: '0.375rem', maxHeight: '50vh', overflowY: 'auto' }}>
            {results.map((note, i) => (
              <button
                key={note.id}
                type="button"
                onClick={() => go(note)}
                onMouseEnter={() => setHighlighted(i)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                  padding: '0.5rem 0.75rem', borderRadius: 8, fontSize: '0.875rem',
                  background: i === highlighted ? 'var(--accent-muted)' : 'none',
                  color: i === highlighted ? 'var(--accent-text)' : 'var(--text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {note.title || 'Без названия'}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
