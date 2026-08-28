import { FormEvent, useRef, useState } from 'react'

interface GuestMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
}

const WORKER_ORIGIN = 'https://ai-chat-api.lachlanhenryhumphreys.workers.dev'
function guestApiUrl(): string {
  const base = import.meta.env.VITE_API_URL as string | undefined
  if (base) return `${base.replace(/\/$/, '').replace(/\/chat$/, '')}/guest`
  // Cloudflare Pages — guest is at /api/guest
  if (window.location.hostname.endsWith('pages.dev')) return '/api/guest'
  // GitHub Pages — hit the Worker
  return `${WORKER_ORIGIN}/guest`
}

export function GuestChat({ onBack }: { onBack: () => void }) {
  const [messages, setMessages] = useState<GuestMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setError(null)
    setLoading(true)

    const next: GuestMessage = {
      id: Date.now(),
      role: 'user',
      content: text,
      created_at: '',
    } as GuestMessage
    const updated = [...messages, next]
    setMessages(updated)
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }))

    try {
      const res = await fetch(guestApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: updated.map((m) => ({ role: m.role, content: m.content })),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }
      const { reply } = (await res.json()) as { reply: string }
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, role: 'assistant', content: reply } as GuestMessage,
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setMessages(updated)
    } finally {
      setLoading(false)
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }))
    }
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="logo" />
          <span>AI Chat Assistant</span>
        </div>
        <p className="guest-note">Guest mode — chats are not saved</p>
        <button className="new-chat" onClick={onBack}>
          ← Back to sign in
        </button>
      </aside>
      <main className="chat">
        <div className="thread">
          {messages.length === 0 && (
            <div className="empty">
              <p>Say hello — try the model without signing in.</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`message ${m.role}`}>
              <div className="bubble">{m.content}</div>
            </div>
          ))}
          {loading && (
            <div className="message assistant">
              <div className="bubble typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        {error && <p className="error">{error}</p>}
        <form onSubmit={sendMessage} className="composer">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message the assistant…"
            disabled={loading}
          />
          <button type="submit" disabled={loading || !input.trim()}>
            Send
          </button>
        </form>
      </main>
    </div>
  )
}
