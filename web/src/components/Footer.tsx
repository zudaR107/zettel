import { Footer as SharedFooter } from '@zudar107/schloss-ui'

export function Footer() {
  return <SharedFooter serviceName="Zettel" description="Быстрое хранилище заметок" version={__APP_VERSION__} helpHref="/help" />
}
