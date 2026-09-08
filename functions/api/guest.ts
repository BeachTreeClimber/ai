interface Env {
  AI: { run: (model: string, options: unknown) => Promise<unknown> }
}

const MODEL = '@cf/openai/gpt-oss-120b'

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

  const chatMessages = [
    { role: 'system', content: 'You are a helpful assistant. Answer concisely and accurately.' },
    ...((history ?? []).slice(-20)),
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
