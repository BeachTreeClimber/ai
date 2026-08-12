import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Provider } from '@supabase/supabase-js'

const REDIRECT_URL = `${window.location.origin}${import.meta.env.BASE_URL}`

const SOCIAL_PROVIDERS: { provider: Provider; label: string }[] = [
  { provider: 'google', label: 'Google' },
]

export function Auth() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const opts = {
      email,
      password,
      options: { emailRedirectTo: REDIRECT_URL },
    }

    const { error } =
      mode === 'signup'
        ? await supabase.auth.signUp(opts)
        : await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
    } else if (mode === 'signup') {
      setSent(true)
    }
    setLoading(false)
  }

  const sendMagicLink = async () => {
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: REDIRECT_URL },
    })
    if (error) setError(error.message)
    else setSent(true)
    setLoading(false)
  }

  const signInWithProvider = async (provider: Provider) => {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: REDIRECT_URL },
    })
    if (error) setError(error.message)
  }

  if (sent) {
    return (
      <div className="card">
        <h1>Check your email</h1>
        <p>
          A sign-in link was sent to <strong>{email}</strong>. Click it to
          continue.
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <h1>{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
      <div className="social">
        {SOCIAL_PROVIDERS.map(({ provider, label }) => (
          <button
            key={provider}
            type="button"
            className={`social-btn ${provider}`}
            onClick={() => signInWithProvider(provider)}
          >
            Continue with {label}
          </button>
        ))}
      </div>
      <div className="divider">
        <span>or continue with email</span>
      </div>
      <form onSubmit={handleSubmit} className="stack">
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading
            ? 'Please wait…'
            : mode === 'signin'
              ? 'Sign in'
              : 'Create account'}
        </button>
      </form>
      <div className="row">
        <button className="link" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
        {mode === 'signin' && (
          <button className="link" onClick={sendMagicLink} disabled={loading || !email}>
            Send magic link
          </button>
        )}
      </div>
    </div>
  )
}
