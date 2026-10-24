import { Outlet, createRootRoute } from '@tanstack/react-router'
import { AppShell } from '~/components/AppShell'
import { VaultGate } from '~/components/VaultGate'
import { VaultProvider } from '~/context/VaultContext'
import { MessagePage } from '~/components/ui'

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => <MessagePage title="Note not found">This note may have been moved or deleted.</MessagePage>,
  errorComponent: ({ error }) => <MessagePage title="Something went wrong">{error instanceof Error ? error.message : 'Please try again.'}</MessagePage>,
})

function RootComponent() {
  return <VaultProvider><VaultGate><AppShell><Outlet /></AppShell></VaultGate></VaultProvider>
}
