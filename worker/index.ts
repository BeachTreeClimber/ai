import { createClient } from '@supabase/supabase-js'

interface Conversation {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
}

interface Message {
  id: number
  conversation_id: string
  role: string
  content: string
  created_at: string
}

// Model run in your own Cloudflare account (Workers AI).
// Swap for any model at https://developers.cloudflare.com/workers-ai/models/
const MODEL = '@cf/openai/gpt-oss-120b'
const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell'

interface AiResult {
  response?: string
  choices?: {
    finish_reason?: string
    message?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null }
  }[]
}

function extractReply(result: unknown): string {
  const r = result as AiResult
  if (typeof r.response === 'string' && r.response) return r.response
  const choice = r.choices?.[0]
  const content = choice?.message?.content
  if (typeof content === 'string' && content) return content
  // gpt-oss-120b is a reasoning model — when max_tokens is too low it
  // truncates with finish_reason "length" and content=null but reasoning
  // still contains text. Fall back to reasoning text instead of dumping JSON.
  const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning
  if (typeof reasoning === 'string' && reasoning.trim()) {
    return reasoning.trim() + '\n\n_(response was truncated — try a shorter prompt)_'
  }
  const finish = choice?.finish_reason
  if (finish === 'length') return 'Sorry — the response was cut off. Please try a shorter prompt.'
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

const IMAGE_PREFIX = '/image '

function isImagePrompt(message: string): string | null {
  if (message.toLowerCase().startsWith(IMAGE_PREFIX)) return message.slice(IMAGE_PREFIX.length).trim()
  return null
}

async function handleImage(prompt: string, env: Env): Promise<Response> {
  if (!prompt) return json({ error: 'Image prompt is required. Use: /image a cat in space' }, 400)
  try {
    const result = await env.AI.run(IMAGE_MODEL, { prompt })
    // Flux returns a ReadableStream of PNG bytes on Workers AI
    if (result instanceof ReadableStream) {
      return new Response(result, {
        headers: { 'Content-Type': 'image/png', ...corsHeaders },
      })
    }
    // Some runtimes return Uint8Array / ArrayBuffer
    if (result instanceof Uint8Array)
      return new Response(result as BodyInit, { headers: { 'Content-Type': 'image/png', ...corsHeaders } })
    // Fallback: base64 in object
    const asObj = result as { image?: string }
    if (asObj.image) {
      const bin = Uint8Array.from(atob(asObj.image), (c) => c.charCodeAt(0))
      return new Response(bin as BodyInit, { headers: { 'Content-Type': 'image/png', ...corsHeaders } })
    }
    return json({ error: 'Unexpected image response' }, 500)
  } catch (err) {
    console.error('Image error', err)
    return json({ error: 'Image generation failed' }, 502)
  }
}

async function handleGuest(request: Request, env: Env): Promise<Response> {
  const {
    message,
    history,
  }: { message: string; history?: { role: string; content: string }[] } =
    await request.json().catch(() => ({}))
  if (!message || typeof message !== 'string' || !message.trim()) {
    return json({ error: 'Message is required' }, 400)
  }

  const imagePrompt = isImagePrompt(message)
  if (imagePrompt !== null) {
    return handleImage(imagePrompt, env)
  }

  const cleanHistory = (history ?? []).slice(-20).map((m) => ({
    role: m.role,
    content: m.content.startsWith('![generated image]') ? '[generated image]' : m.content,
  }))
  const chatMessages = [
    {
      role: 'system',
      content:
        'You are a helpful assistant and coding expert. Answer concisely and accurately. For code, provide clean, well-commented examples with syntax highlighting in mind. Use markdown code fences.',
    },
    ...cleanHistory,
    { role: 'user', content: message },
  ]

  let reply: string
  try {
    const result = await env.AI.run(MODEL, {
      messages: chatMessages,
      max_tokens: 2048,
    })
    reply = extractReply(result)
  } catch (err) {
    console.error('Workers AI error', err)
    return json(
      { error: 'The model call failed. Check that the AI binding and model ID are valid.' },
      502,
    )
  }

  return json({ reply })
}

async function handleChat(request: Request, env: Env): Promise<Response> {
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

  const imagePrompt = isImagePrompt(message)
  if (imagePrompt !== null) {
    // Images are ephemeral — don't save to chat history, just generate and return
    const imgRes = await handleImage(imagePrompt, env)
    if (!imgRes.ok) return imgRes
    // Return the PNG as base64 data URL inside a normal chat reply so the
    // frontend can display it inline and it gets saved as a message.
    const buf = new Uint8Array(await imgRes.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
    const b64 = btoa(bin)
    const dataUrl = `data:image/png;base64,${b64}`

    // Persist both sides so the image appears in history
    let conversationIdResolved = conversationId
    if (!conversationIdResolved) {
      const title = `Image: ${imagePrompt.slice(0, 40)}`
      const { data, error } = await supabase
        .from('conversations')
        .insert({ user_id: userId, title })
        .select()
        .single()
      if (error) return json({ error: error.message }, 500)
      conversationIdResolved = (data as Conversation).id
    }
    await supabase.from('messages').insert({
      conversation_id: conversationIdResolved,
      role: 'user',
      content: message,
    })
    await supabase.from('messages').insert({
      conversation_id: conversationIdResolved,
      role: 'assistant',
      content: `![generated image](${dataUrl})`,
    })
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationIdResolved)
    const { data: messages } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationIdResolved)
      .order('created_at', { ascending: true })
    const { data: conversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationIdResolved)
      .single()
    return json({ conversation: conversation as Conversation, messages: messages as Message[] })
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

  const cleanHistory = ((history as { role: string; content: string }[]) ?? []).map((m) => ({
    role: m.role,
    content: m.content.startsWith('![generated image]') ? '[generated image]' : m.content,
  }))
  const systemPrompt =
    'You are a helpful assistant and coding expert. Answer concisely and accurately. For code, provide clean, well-commented examples with syntax highlighting in mind. Use markdown code fences.'
  const chatMessages = [
    { role: 'system', content: systemPrompt },
    ...cleanHistory,
  ]

  // Run the model via Cloudflare Workers AI.
  let reply: string
  try {
    const result = await env.AI.run(MODEL, {
      messages: chatMessages,
      max_tokens: 2048,
    })
    reply = extractReply(result)
  } catch (err) {
    console.error('Workers AI error', err)
    return json(
      { error: 'The model call failed. Check that the AI binding and model ID are valid.' },
      502,
    )
  }

  // Persist the assistant's reply.
  const { error: aiMsgError } = await supabase.from('messages').insert({
    conversation_id: conversationIdResolved,
    role: 'assistant',
    content: reply,
  })
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
    if (request.method === 'POST') {
      const url = new URL(request.url)
      if (url.pathname === '/guest') return handleGuest(request, env)
      return handleChat(request, env)
    }
    if (request.method === 'GET') return json({ ok: true, service: 'ai-chat-api' })
    return json({ error: 'Method not allowed' }, 405)
  },
}