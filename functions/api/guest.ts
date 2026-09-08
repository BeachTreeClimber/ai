interface Env {
  AI: { run: (model: string, options: unknown) => Promise<unknown> }
}

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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

export const onRequestOptions = (): Response => new Response(null, { headers: corsHeaders })

const IMAGE_PREFIX = '/image '

function isImagePrompt(message: string): string | null {
  if (message.toLowerCase().startsWith(IMAGE_PREFIX)) return message.slice(IMAGE_PREFIX.length).trim()
  return null
}

async function handleImage(prompt: string, env: Env): Promise<Response> {
  if (!prompt) return json({ error: 'Image prompt is required. Use: /image a cat in space' }, 400)
  try {
    const result = await env.AI.run(IMAGE_MODEL, { prompt })
    if (result instanceof ReadableStream) {
      return new Response(result, { headers: { 'Content-Type': 'image/png', ...corsHeaders } })
    }
    if (result instanceof Uint8Array)
      return new Response(result as BodyInit, { headers: { 'Content-Type': 'image/png', ...corsHeaders } })
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

export const onRequestPost = async (context: {
  request: Request
  env: Env
}): Promise<Response> => {
  const { request, env } = context
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
