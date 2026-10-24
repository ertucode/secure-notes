import { createFileRoute } from '@tanstack/react-router'
import { NotesView } from '~/components/NotesView'
import { noteFiltersSchema } from '~/lib/notes.schemas'

export const Route = createFileRoute('/')({
  validateSearch: noteFiltersSchema,
  component: NotesPage,
})

function NotesPage() {
  return <NotesView search={Route.useSearch()} />
}
