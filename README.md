# AI Chat Assistant

A self-hosted chat assistant with Supabase auth + chat history, the model
served by Cloudflare Workers AI, and the whole app hosted on Cloudflare Pages.

## Stack

- **Frontend:** React + Vite + TypeScript
- **Auth & storage:** Supabase (Auth, Postgres tables with Row Level Security)
- **AI model:** Cloudflare Workers AI — open models (GPT-OSS 120B by default)
  running in your own Cloudflare account. No OpenAI key required.
- **Hosting:** Cloudflare Pages (static app + `functions/` for server-side logic)

## How it works

1. Users sign in/up via Supabase Auth (email + password or magic link).
2. `functions/api/chat.ts` is a Cloudflare Pages Function. It verifies the
   user's Supabase JWT, saves their message to `messages`, loads history,
   calls the model through the Workers AI `AI` binding, saves the reply, and
   returns the full thread.
3. Row Level Security ensures every query is scoped to the signed-in user.

## Setup

### 1. Supabase

1. Create a project at https://supabase.com
2. Open **SQL Editor** and run `supabase/schema.sql` (creates `profiles`,
   `conversations`, `messages` + RLS policies).
3. Get the **Project URL** and **anon public key** from
   Project Settings → API.

### 2. Cloudflare

1. `npm install`
2. `wrangler login`
3. Add a **Workers AI** binding. With `wrangler.toml` present this is:
   ```toml
   [ai]
   binding = "AI"
   ```
   (The model is free up to 10,000 neurons/day on the free plan.)

### 3. Environment variables

Local development (Vite):

```sh
cp .env.example .env          # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
cp .dev.vars.example .dev.vars # SUPABASE_URL, SUPABASE_ANON_KEY (for the Function)
```

The AI binding is available locally via `wrangler pages dev`.

### 4. Run locally

```sh
npm run dev          # frontend only
npm run pages:dev    # frontend + Functions (uses .dev.vars + AI binding)
```

### 5. Deploy to Cloudflare Pages

```sh
npm run build
wrangler pages deploy dist
```

Then in the Cloudflare dashboard (your Pages project → Settings → Environment
variables) set:

- `VITE_SUPABASE_URL` (production)
- `VITE_SUPABASE_ANON_KEY` (production)
- `SUPABASE_URL` (production)
- `SUPABASE_ANON_KEY` (production)

And in the **Functions** section confirm the `AI` binding is attached to the
production deployment. Rebuild/redeploy after changing settings.

## Changing the model

Edit `MODEL` in `functions/api/chat.ts`. Any model in
https://developers.cloudflare.com/workers-ai/models/ works, e.g.
`@cf/openai/gpt-oss-120b` (default, 120B) or `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
The reply extractor in `chat.ts` handles both the Llama-style (`response`) and
OpenAI-style (`choices[0].message.content`) output shapes.

## Social sign-in (Google)

The UI button is already in place. You must create credentials in the Google
developer console, then paste them into
Supabase → Authentication → Providers → Google.

The callback URL is:

```
https://kemoqakrtsfzgflxahsa.supabase.co/auth/v1/callback
```

**Google** (https://console.cloud.google.com → APIs & Services → Credentials):
1. Create an OAuth client ID of type **Web application**.
2. Add the callback URL above to **Authorized redirect URIs**.
3. Copy the **Client ID** and **Client secret** into Supabase (provider: Google).

Finally, make sure your site URL and `.../auth/v1/callback` are listed in
Supabase → Authentication → URL Configuration → **Redirect URLs**.

## Custom / self-hosted endpoint

Prefer your own fine-tuned model behind an API? Replace the `env.AI.run(...)`
call in `functions/api/chat.ts` with a `fetch()` to your endpoint and store its
URL/key in `wrangler.toml` [vars] or `.dev.vars`.

## Scripts

| Command              | What it does                          |
| -------------------- | ------------------------------------- |
| `npm run dev`        | Vite dev server                       |
| `npm run pages:dev`  | Local Pages Functions + frontend      |
| `npm run build`      | Typecheck + production build          |
| `npm run pages:deploy` | Deploy to Cloudflare Pages          |
