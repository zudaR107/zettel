interface Section {
  titel: string
  text: string
}

const SECTIONS: Section[] = [
  {
    titel: 'Заметки',
    text: 'Каждая заметка — заголовок и текст в markdown. Закрепите важные заметки значком булавки в редакторе — они поднимутся в отдельный раздел «Закреплённые» на странице «Заметки». Ненужные заметки не удаляйте сразу — сначала архивируйте значком архива рядом с булавкой.',
  },
  {
    titel: 'Режимы редактирования',
    text: 'Над текстом заметки переключайте «Правка», «Просмотр» и «Разделить» — последний показывает исходный markdown и его рендер рядом, обновляясь по мере ввода.',
  },
  {
    titel: 'Wiki-ссылки и обратные ссылки',
    text: 'Наберите [[Название заметки]] прямо в тексте — если заметка с таким названием существует, ссылка станет кликабельной. Внизу каждой заметки есть панель «Ссылки на эту заметку» со списком всех заметок, которые на неё ссылаются — так связи видны в обе стороны.',
  },
  {
    titel: 'Поиск',
    text: 'Строка поиска на странице «Заметки» ищет по заголовку и содержимому сразу — начинайте вводить, результаты обновляются на лету.',
  },
]

export function HelpPage() {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          Как пользоваться Zettel
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
          Быстрое хранилище заметок
        </p>
      </div>

      <p style={{ margin: '0 0 1.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>
        Zettel — блокнот для markdown-заметок со ссылками между ними. Пишите
        заметку, ссылайтесь на другие через [[Название]], и Zettel сам
        соберёт из этих ссылок сеть — на каждой заметке видно, кто на неё
        ссылается.
      </p>

      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Первые шаги
        </h2>
        {/* Tailwind's preflight resets ol/ul to `list-style: none`, so the
            numbers need to be explicitly restored - otherwise the paddingLeft
            below just looks like unexplained indentation with no markers. */}
        <ol style={{ margin: 0, paddingLeft: '1.25rem', listStyleType: 'decimal', color: 'var(--text-muted)', fontSize: '0.8125rem', lineHeight: 1.7 }}>
          <li>Нажмите «Новая заметка» на странице «Заметки».</li>
          <li>Пишите в markdown, переключаясь между «Правка», «Просмотр» и «Разделить».</li>
          <li>Свяжите заметки — наберите [[Название заметки]] прямо в тексте.</li>
        </ol>
      </div>

      {SECTIONS.map((s) => (
        <div key={s.titel} className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {s.titel}
          </h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8125rem', lineHeight: 1.6 }}>
            {s.text}
          </p>
        </div>
      ))}
    </div>
  )
}
