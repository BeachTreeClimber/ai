import { createClient } from '@supabase/supabase-js'
import type { Conversation, Message } from '../src/types'

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
  const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning
  if (typeof reasoning === 'string' && reasoning.trim()) {
    return reasoning.trim() + '\n\n_(response was truncated — try a shorter prompt)_'
  }
  if (choice?.finish_reason === 'length')
    return 'Sorry — the response was cut off. Please try a shorter prompt.'
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

const IMAGE_PREFIX = '/image '

function isImagePrompt(message: string): string | null {
  if (message.toLowerCase().startsWith(IMAGE_PREFIX)) return message.slice(IMAGE_PREFIX.length).trim()
  return null
}

async function handleImage(
  prompt: string,
  env: Env,
): Promise<{ dataUrl: string } | { error: string }> {
  if (!prompt) return { error: 'Image prompt is required. Use: /image a cat in space' }
  try {
    const result = await env.AI.run(IMAGE_MODEL, { prompt })
    let buf: Uint8Array
    if (result instanceof ReadableStream) {
      const ab = await new Response(result).arrayBuffer()
      buf = new Uint8Array(ab)
    } else if (result instanceof Uint8Array) {
      buf = result
    } else {
      const asObj = result as { image?: string }
      if (asObj.image) buf = Uint8Array.from(atob(asObj.image), (c) => c.charCodeAt(0))
      else return { error: 'Unexpected image response' }
    }
    let bin = ''
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
    return { dataUrl: `data:image/png;base64,${btoa(bin)}` }
  } catch (err) {
    console.error('Image error', err)
    return { error: 'Image generation failed' }
  }
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

  // Image generation — trigger with "/image a cat in space"
  const imagePrompt = isImagePrompt(message)
  if (imagePrompt !== null) {
    const img = await handleImage(imagePrompt, env)
    if ('error' in img) return json({ error: img.error }, 400)
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
      content: `![generated image](${img.dataUrl})`,
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
