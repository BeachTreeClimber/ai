import { createClient } from '@supabase/supabase-js'
import type { Conversation, Message } from '../src/types'

// Model run in your own Cloudflare account (Workers AI).
// Swap for any model at https://developers.cloudflare.com/workers-ai/models/
const MODEL = '@cf/openai/gpt-oss-120b'

interface AiResult {
  response?: string
  choices?: { message?: { content?: string } }[]
}

function extractReply(result: unknown): string {
  const r = result as AiResult
  if (typeof r.response === 'string' && r.response) return r.response
  const content = r.choices?.[0]?.message?.content
  if (typeof content === 'string' && content) return content
  return JSON.stringify(result)
}

interface Env {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  AI: { run: (model: string, options: unknown) => Promise<unknown> }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

export const onRequestOptions = (): Response => new Response(null, { headers: corsHeaders })

export const onRequestPost = async (context: {
  request: Request
  env: Env
}): Promise<Response> => {
  const { request, env } = context
  const authHeader = request.headers.get('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Missing bearer token' }, 401)
  }
  const token = authHeader.slice('Bearer '.length)

  // Verify the user's Supabase JWT server-side; RLS on the tables then applies.
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !userData.user) {
    return json({ error: 'Invalid or expired token' }, 401)
  }
  const userId = userData.user.id

  const { conversationId, message }: { conversationId?: string; message: string } =
    await request.json().catch(() => ({}))
  if (!message || typeof message !== 'string' || !message.trim()) {
    return json({ error: 'Message is required' }, 400)
  }

  // Reuse an existing conversation, or create a new one.
  let conversationIdResolved = conversationId
  if (!conversationIdResolved) {
    const title = message.trim().slice(0, 40)
    const { data, error } = await supabase
      .from('conversations')
      .insert({ user_id: userId, title })
      .select()
      .single()
    if (error) return json({ error: error.message }, 500)
    conversationIdResolved = (data as Conversation).id
  }

  // Persist the user's message.
  const { error: userMsgError } = await supabase.from('messages').insert({
    conversation_id: conversationIdResolved,
    role: 'user',
    content: message,
  })
  if (userMsgError) return json({ error: userMsgError.message }, 500)

  // Load history to give the model context.
  const { data: history, error: historyError } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationIdResolved)
    .order('created_at', { ascending: true })
    .limit(50)
  if (historyError) return json({ error: historyError.message }, 500)

  const systemPrompt =
    'You are a helpful assistant. Answer concisely and accurately.'
  const chatMessages = [
    { role: 'system', content: systemPrompt },
    ...(history ?? []),
  ]

  // Run the model via Cloudflare Workers AI.
  let reply: string
  try {
    const result = await env.AI.run(MODEL, { messages: chatMessages })
    reply = extractReply(result)
  } catch (err) {
    console.error('Workers AI error', err)
    return json(
      { error: 'The model call failed. Check that the AI binding and model ID are valid.' },
      502,
    )
  }

  // Persist the assistant's reply.
  const { data: assistantMsg, error: aiMsgError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationIdResolved,
      role: 'assistant',
      content: reply,
    })
    .select()
    .single()
  if (aiMsgError) return json({ error: aiMsgError.message }, 500)

  // Bump updated_at so the sidebar ordering stays current.
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationIdResolved)

  // Return the full thread so the client can render exactly what's in the DB.
  const { data: messages, error: finalError } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationIdResolved)
    .order('created_at', { ascending: true })
  if (finalError) return json({ error: finalError.message }, 500)

  const { data: conversation, error: convoError } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationIdResolved)
    .single()
  if (convoError) return json({ error: convoError.message }, 500)

  return json({ conversation: conversation as Conversation, messages: messages as Message[] })
}
