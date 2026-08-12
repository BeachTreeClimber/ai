import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Conversation, Message } from '../types'

interface ChatProps {
  email: string
  onSignOut: () => void
}

interface ChatResponse {
  conversation: Conversation
  messages: Message[]
}

const API_URL = import.meta.env.VITE_API_URL || '/api/chat'
const LOGO_URL = `${import.meta.env.BASE_URL}logo.svg`

export function Chat({ email, onSignOut }: ChatProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('Failed to load conversations', error)
        else setConversations(data as Conversation[])
      })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const loadConversation = useCallback(async (id: string) => {
    setActiveId(id)
    setError(null)
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
    if (error) console.error('Failed to load messages', error)
    else setMessages(data as Message[])
  }, [])

  const startNewChat = () => {
    setActiveId(null)
    setMessages([])
    setError(null)
  }

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setError(null)
    setLoading(true)

    const optimistic: Message = {
      id: Date.now(),
      conversation_id: activeId ?? '',
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) throw new Error('Not signed in')

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ conversationId: activeId, message: text }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }

      const data = (await res.json()) as ChatResponse
      setActiveId(data.conversation.id)
      setMessages(data.messages)

      setConversations((prev) => [
        data.conversation,
        ...prev.filter((c) => c.id !== data.conversation.id),
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
    } finally {
      setLoading(false)
    }
  }

  const deleteConversation = async (id: string) => {
    const { error } = await supabase.from('conversations').delete().eq('id', id)
    if (error) {
      console.error('Failed to delete conversation', error)
      return
    }
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (activeId === id) startNewChat()
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <img src={LOGO_URL} alt="" className="logo" />
          <span>AI Chat Assistant</span>
        </div>
        <button className="new-chat" onClick={startNewChat}>
          + New chat
        </button>
        <nav>
          {conversations.map((c) => (
            <div key={c.id} className={`convo ${c.id === activeId ? 'active' : ''}`}>
              <button className="convo-title" onClick={() => loadConversation(c.id)}>
                {c.title}
              </button>
              <button
                className="convo-delete"
                aria-label={`Delete ${c.title}`}
                onClick={() => deleteConversation(c.id)}
              >
                ×
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="user">{email}</span>
          <button className="link" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="chat">
        <div className="thread">
          {messages.length === 0 && (
            <div className="empty">
              {activeId ? (
                <p>This conversation is empty. Say hello!</p>
              ) : (
                <p>Start a new conversation below.</p>
              )}
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
