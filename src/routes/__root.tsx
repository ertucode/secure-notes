import { Outlet, createRootRoute } from '@tanstack/react-router'
import { AppShell } from '~/components/AppShell'
import { VaultGate } from '~/components/VaultGate'
import { VaultProvider } from '~/context/VaultContext'

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => <div className="message-page"><h1>Note not found</h1><p>This note may have been moved or deleted.</p></div>,
  errorComponent: ({ error }) => <div className="message-page"><h1>Something went wrong</h1><p>{error instanceof Error ? error.message : 'Please try again.'}</p></div>,
})

function RootComponent() {
  return <VaultProvider><VaultGate><AppShell><Outlet /></AppShell></VaultGate></VaultProvider>
}
