import { useState } from 'react'
import { X } from 'lucide-react'

interface TagInputProps {
  tags: string[]
  /** Every tag name the user has in use elsewhere, for the autocomplete dropdown. */
  suggestions: string[]
  onChange: (tags: string[]) => void
}

// A free-text field with autocomplete against existing tags - Enter adds
// whatever's typed (creating a new tag if it doesn't match one), clicking
// a suggestion adds that exact existing tag instead, and Backspace on an
// empty field removes the last chip. Matching (both against existing
// tags and against a note's own tags, to skip already-applied ones from
// the dropdown) is case-insensitive throughout, mirroring the backend's
// own case-insensitive tag matching.
export function TagInput({ tags, suggestions, onChange }: TagInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [focused, setFocused] = useState(false)

  const query = inputValue.trim().toLowerCase()
  const filteredSuggestions = query
    ? suggestions
        .filter((s) => s.toLowerCase().includes(query) && !tags.some((t) => t.toLowerCase() === s.toLowerCase()))
        .slice(0, 6)
    : []

  function addTag(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    if (tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) { setInputValue(''); return }
    onChange([...tags, trimmed])
    setInputValue('')
  }

  function removeTag(name: string) {
    onChange(tags.filter((t) => t !== name))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag(inputValue)
    } else if (e.key === 'Backspace' && inputValue === '' && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.375rem' }}>
        {tags.map((tag) => (
          <span
            key={tag}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
              background: 'var(--accent-muted)', color: 'var(--accent-text)',
              borderRadius: 6, padding: '0.2rem 0.4rem 0.2rem 0.5rem',
              fontSize: '0.75rem', fontWeight: 600,
            }}
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              aria-label={`Убрать тег ${tag}`}
              style={{
                display: 'flex', border: 'none', background: 'none', padding: 2,
                cursor: 'pointer', color: 'inherit', opacity: 0.7,
              }}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          // Delayed so a click on a suggestion below (a blur-triggering
          // event) still registers before the dropdown unmounts.
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={tags.length === 0 ? 'Добавить тег…' : ''}
          style={{
            font: 'inherit', fontSize: '0.75rem', border: 'none', outline: 'none',
            background: 'none', color: 'var(--text-primary)', minWidth: 90, flex: 1,
          }}
        />
      </div>

      {focused && filteredSuggestions.length > 0 && (
        <div
          className="card"
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 10,
            minWidth: 160, padding: '0.25rem', display: 'flex', flexDirection: 'column',
          }}
        >
          {filteredSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addTag(s)}
              style={{
                textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer',
                padding: '0.375rem 0.5rem', borderRadius: 6, fontSize: '0.8125rem',
                color: 'var(--text-primary)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-base)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
