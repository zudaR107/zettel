import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TagInput } from '../components/TagInput'

// ---------------------------------------------------------------------------
// TagInput is a standalone controlled component ({ tags, suggestions,
// onChange }), so - unlike the page-level test files in this suite - no
// router or query-client wrapper is needed here.
// ---------------------------------------------------------------------------

function setup(props: Partial<{ tags: string[]; suggestions: string[] }> = {}) {
  const onChange = vi.fn()
  const tags = props.tags ?? []
  const suggestions = props.suggestions ?? []
  const utils = render(<TagInput tags={tags} suggestions={suggestions} onChange={onChange} />)
  return { onChange, ...utils }
}

describe('TagInput — rendering chips', () => {
  it('renders each tag as a visible chip with its text', () => {
    setup({ tags: ['Work', 'Ideas'] })
    expect(screen.getByText('Work')).toBeInTheDocument()
    expect(screen.getByText('Ideas')).toBeInTheDocument()
  })

  it('renders no chips when tags is empty', () => {
    setup({ tags: [] })
    // No remove buttons should exist at all.
    expect(screen.queryAllByRole('button').length).toBe(0)
  })
})

describe('TagInput — removing a chip', () => {
  it('clicking a chip\'s remove control calls onChange once with that tag removed, rest preserved in order', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ tags: ['Work', 'Ideas', 'Personal'] })

    const removeButton = findRemoveButtonFor('Ideas')
    await user.click(removeButton)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(['Work', 'Personal'])
  })
})

// Helper: locate the remove control associated with a given chip's text,
// tolerant of different DOM shapes (a button inside/adjacent to the chip
// text, possibly with an aria-label rather than visible text).
function findRemoveButtonFor(tagText: string): HTMLElement {
  const chipText = screen.getByText(tagText)
  // Walk up from the chip's own element (inclusive) to find the smallest
  // container with exactly one button in it - that's this chip's remove
  // control, not some other chip's.
  let container: HTMLElement | null = chipText
  while (container) {
    const buttons = within(container).queryAllByRole('button')
    if (buttons.length === 1) return buttons[0]!
    container = container.parentElement
  }
  throw new Error(`no remove button found near chip "${tagText}"`)
}

describe('TagInput — typing and Enter', () => {
  it('typing a name and pressing Enter appends the trimmed name to tags and clears the input', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ tags: ['Existing'] })

    const input = screen.getByRole('textbox')
    await user.type(input, '  New Tag  {Enter}')

    expect(onChange).toHaveBeenCalledWith(['Existing', 'New Tag'])
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('pressing Enter with empty input does not call onChange', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ tags: ['Existing'] })

    const input = screen.getByRole('textbox')
    await user.click(input)
    await user.keyboard('{Enter}')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('pressing Enter with whitespace-only input does not call onChange', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ tags: ['Existing'] })

    const input = screen.getByRole('textbox')
    await user.type(input, '   {Enter}')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('typing a name that case-insensitively duplicates an existing tag does not produce a duplicate', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ tags: ['Work'] })

    const input = screen.getByRole('textbox')
    await user.type(input, 'work{Enter}')

    if (onChange.mock.calls.length > 0) {
      const result = onChange.mock.calls.at(-1)?.[0] as string[]
      const lowered = result.map((t) => t.toLowerCase())
      expect(new Set(lowered).size).toBe(lowered.length)
    }
  })
})

describe('TagInput — Backspace to remove last tag', () => {
  it('pressing Backspace with empty input and non-empty tags removes the last tag', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ tags: ['Work', 'Ideas'] })

    const input = screen.getByRole('textbox')
    await user.click(input)
    await user.keyboard('{Backspace}')

    expect(onChange).toHaveBeenCalledWith(['Work'])
  })

  it('pressing Backspace with empty input and empty tags does not call onChange', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ tags: [] })

    const input = screen.getByRole('textbox')
    await user.click(input)
    await user.keyboard('{Backspace}')

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('TagInput — suggestions dropdown', () => {
  it('shows matching suggestions (case-insensitive substring), excluding ones already in tags', async () => {
    const user = userEvent.setup()
    setup({ tags: ['Work'], suggestions: ['Workshop', 'Working', 'Personal', 'Work'] })

    const input = screen.getByRole('textbox')
    await user.type(input, 'work')

    expect(await screen.findByText('Workshop')).toBeInTheDocument()
    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.queryByText('Personal')).not.toBeInTheDocument()
    // "Work" itself is already a current tag - must be excluded from suggestions
    // even though it matches. It may still legitimately appear as an existing
    // chip elsewhere in the DOM, so scope this to the suggestion list only.
    const workOccurrences = screen.getAllByText('Work')
    // Exactly one "Work" text node should exist: the chip. If the dropdown
    // also rendered a "Work" suggestion entry there would be two.
    expect(workOccurrences).toHaveLength(1)
  })

  it('clicking a suggestion appends its exact string to tags and clears the input', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ tags: [], suggestions: ['Workshop', 'Personal'] })

    const input = screen.getByRole('textbox')
    await user.type(input, 'work')

    const suggestion = await screen.findByText('Workshop')
    await user.click(suggestion)

    expect(onChange).toHaveBeenCalledWith(['Workshop'])
    expect((input as HTMLInputElement).value).toBe('')
  })
})
