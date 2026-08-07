import { useQuery } from '@tanstack/react-query'
import type { DatePrefs } from '@zudar107/schloss-ui'
import { api } from '../lib/api'

interface MeResponse extends DatePrefs {
  id: string
  email: string
  name: string
}

// GET /users/me already carries weekStart/dateFormat/timezone straight
// off the verified JWT (see backend/src/features/users/router.ts) -
// this just exposes the two Zettel actually uses (no calendar UI here,
// so weekStart is skipped).
export function useDatePrefs(): DatePrefs {
  const { data } = useQuery<MeResponse>({
    queryKey: ['users', 'me', 'datePrefs'],
    queryFn: () => api.get('/users/me'),
  })
  return { dateFormat: data?.dateFormat ?? null, timezone: data?.timezone ?? null }
}
