export interface Note {
  id: string
  title: string
  content: string
  pinned: boolean
  archived: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface Tag {
  id: string
  name: string
}

export interface NoteBacklink {
  id: string
  title: string
}
