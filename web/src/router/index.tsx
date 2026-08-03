import { createRouter, createRootRouteWithContext, createRoute, Outlet, redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { Layout } from '../components/Layout'
import { NotesPage } from '../features/notes/NotesPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { DocsPage } from '../features/docs/DocsPage'
import { HelpPage } from '../features/help/HelpPage'
import { AuthCallbackPage } from '../features/auth/AuthCallbackPage'
import { getAccessToken } from '../lib/api'
import { buildSchluesselLoginUrl } from '../lib/authRedirect'
import { queryClient } from '../lib/queryClient'

interface RouterContext {
  queryClient: QueryClient
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
})

const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/callback',
  component: AuthCallbackPage,
})

const protectedLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'protected',
  beforeLoad: async () => {
    if (!getAccessToken()) {
      window.location.href = await buildSchluesselLoginUrl(window.location.pathname + window.location.search)
    }
  },
  component: () => <Layout><Outlet /></Layout>,
})

const indexRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/',
  beforeLoad: () => { throw redirect({ to: '/notes' }) },
})

const notesRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/notes',
  component: NotesPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/settings',
  component: SettingsPage,
})

// Role-gated inside DocsPage itself, not here - the current user's role
// only lives in useAuth()'s React state (populated asynchronously), which
// a beforeLoad running before that state exists can't check synchronously.
const docsRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/docs',
  component: DocsPage,
})

const helpRoute = createRoute({
  getParentRoute: () => protectedLayout,
  path: '/help',
  component: HelpPage,
})

const routeTree = rootRoute.addChildren([
  authCallbackRoute,
  protectedLayout.addChildren([
    indexRoute,
    notesRoute,
    settingsRoute,
    docsRoute,
    helpRoute,
  ]),
])

export const router = createRouter({ routeTree, context: { queryClient } })

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
