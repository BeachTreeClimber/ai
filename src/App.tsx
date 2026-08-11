import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { Auth } from './components/Auth'
import { Chat } from './components/Chat'
import type { Session } from '@supabase/supabase-js'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  if (loading) return <div className="loading">Loading…</div>

  return session ? (
    <Chat email={session.user.email ?? ''} onSignOut={() => supabase.auth.signOut()} />
  ) : (
    <div className="center">
      <Auth />
    </div>
  )
}
