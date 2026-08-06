import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HelpPage } from '../features/help/HelpPage'

describe('HelpPage', () => {
  it('renders the guide heading', () => {
    render(<HelpPage />)
    expect(screen.getByText('Как пользоваться Zettel')).toBeInTheDocument()
  })

  it('renders a heading for every section', () => {
    render(<HelpPage />)
    expect(screen.getByText('Заметки')).toBeInTheDocument()
    expect(screen.getByText('Режимы редактирования')).toBeInTheDocument()
    expect(screen.getByText('Wiki-ссылки и обратные ссылки')).toBeInTheDocument()
    expect(screen.getByText('Поиск')).toBeInTheDocument()
  })

  it('renders the "Первые шаги" ordered list with visible decimal numbering', () => {
    render(<HelpPage />)

    const heading = screen.getByText('Первые шаги')
    const ol = heading.parentElement?.querySelector('ol')
    expect(ol).toBeInTheDocument()

    // Tailwind preflight resets ol/ul to `list-style: none`; the fix restores
    // visible numbering via an inline `listStyleType: 'decimal'`, so assert
    // the actual computed inline style rather than just presence of the tag.
    expect(ol).toHaveStyle({ listStyleType: 'decimal' })
    expect(ol?.style.listStyleType).not.toBe('none')
    expect(ol?.style.listStyleType).not.toBe('')

    const items = ol ? Array.from(ol.querySelectorAll('li')) : []
    expect(items).toHaveLength(3)
    items.forEach((item) => expect(item).toBeInTheDocument())
  })
})
