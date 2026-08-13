import { useState } from 'react'
import { supabase } from '../lib/supabase'

const REDIRECT_URL = `${window.location.origin}${import.meta.env.BASE_URL}`
const LOGO_URL = `${import.meta.env.BASE_URL}logo.svg`

export function Auth() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [accepted, setAccepted] = useState(false)

  const signInWithGoogle = async () => {
    if (!accepted) return
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: REDIRECT_URL },
    })
    setLoading(false)
    if (error) setError(error.message)
  }

  return (
    <div className="card">
      <img src={LOGO_URL} alt="" className="logo" />
      <h1>Welcome</h1>
      {error && <p className="error">{error}</p>}
      <label className="terms">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        <span>
          I agree to the{' '}
          <a
            href={`${import.meta.env.BASE_URL}terms.html`}
            target="_blank"
            rel="noreferrer"
          >
            Terms &amp; Conditions
          </a>
        </span>
      </label>
      <button
        className="social-btn google"
        onClick={signInWithGoogle}
        disabled={loading || !accepted}
      >
        {loading ? 'Please wait…' : 'Continue with Google'}
      </button>
      <p className="disclaimer">Sign in to chat with your AI assistant</p>
    </div>
  )
}