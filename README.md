# AI Chat Assistant

A self-hosted chat assistant with Supabase auth + chat history, the model
served by Cloudflare Workers AI, the frontend hosted on GitHub Pages, and the
chat API running in a Cloudflare Worker.

## Stack

- **Frontend:** React + Vite + TypeScript
- **Auth & storage:** Supabase (Auth, Postgres tables with Row Level Security)
- **AI model:** Cloudflare Workers AI — open models (GPT-OSS 120B by default)
  running in your own Cloudflare account. No OpenAI key required.
- **Hosting:** GitHub Pages (frontend) + Cloudflare Worker (`worker/`) for the
  chat API, since GitHub Pages cannot run server code.

## How it works

1. Users sign in/up via Supabase Auth (email + password, magic link, or Google).
2. The chat API runs in the `worker/` Cloudflare Worker (deployed as
   `ai-chat-api`). It verifies the user's Supabase JWT, saves their message to
   `messages`, loads history, calls the model through the Workers AI `AI`
   binding, saves the reply, and returns the full thread.
3. The frontend calls the Worker URL via `VITE_API_URL` (set in
   `.github/workflows/deploy.yml`).
4. Row Level Security ensures every query is scoped to the signed-in user.

## URLs

- Site: https://beachtreeclimber.github.io/ai/
- Chat API: https://ai-chat-api.lachlanhenryhumphreys.workers.dev

## Setup

### 1. Supabase

1. Create a project at https://supabase.com
2. Open **SQL Editor** and run `supabase/schema.sql` (creates `profiles`,
   `conversations`, `messages` + RLS policies).
3. Get the **Project URL** and **anon public key** from
   Project Settings → API.
4. Authentication → URL Configuration: add your site URL and the redirect URL
   `https://beachtreeclimber.github.io/**`.

### 2. Cloudflare

1. `npm install`
2. `wrangler login`
3. Deploy the chat API Worker (the `[ai]` binding and Supabase vars are already
   in `worker/wrangler.toml`):

   ```sh
   npx wrangler deploy --config worker/wrangler.toml
   ```

   (The model is free up to 10,000 neurons/day on the free plan.)

### 3. Environment variables

Local development (Vite):

```sh
cp .env.example .env          # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
cp .dev.vars.example .dev.vars # SUPABASE_URL, SUPABASE_ANON_KEY (for the Function)
```

For GitHub Pages, the build env vars (`VITE_*` and `VITE_API_URL`) are set in
`.github/workflows/deploy.yml` and applied by the Actions build.

### 4. Run locally

```sh
npm run dev          # frontend only (chat calls /api/chat → needs a local server)
npm run pages:dev    # frontend + local Pages Functions (uses .dev.vars + AI binding)
```

### 5. Deploy

Push to `main` — GitHub Actions builds and publishes the site to GitHub Pages.
The chat API Worker is deployed separately (step 2 above).

## Changing the model

Edit `MODEL` in `worker/index.ts` (and `functions/api/chat.ts` for local dev),
then redeploy the Worker with `npx wrangler deploy --config worker/wrangler.toml`.
Any model in https://developers.cloudflare.com/workers-ai/models/ works, e.g.
`@cf/openai/gpt-oss-120b` (default, 120B) or `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
The reply extractor handles both the Llama-style (`response`) and OpenAI-style
(`choices[0].message.content`) output shapes.

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
call in `worker/index.ts` with a `fetch()` to your endpoint and store its
URL/key in `worker/wrangler.toml` [vars] or `.dev.vars`.

## Scripts

| Command              | What it does                          |
| -------------------- | ------------------------------------- |
| `npm run dev`        | Vite dev server                       |
| `npm run pages:dev`  | Local Pages Functions + frontend      |
| `npm run build`      | Typecheck + production build          |
| `npx wrangler deploy --config worker/wrangler.toml` | Deploy the chat API Worker |
