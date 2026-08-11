-- Run this in the Supabase SQL editor.
-- Creates profiles, conversations and messages tables with Row Level Security.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);
create index if not exists conversations_user_idx on public.conversations (user_id, updated_at desc);

-- Roles need table privileges before RLS can apply to them.
-- (Supabase auto-grants only for tables made in the Table Editor.)
grant usage on schema public to anon, authenticated;
grant all on table public.profiles to anon, authenticated;
grant all on table public.conversations to anon, authenticated;
grant all on table public.messages to anon, authenticated;
grant all on sequence public.messages_id_seq to anon, authenticated;

-- Profiles -------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Conversations ---------------------------------------------------------------

alter table public.conversations enable row level security;

create policy "Users can manage own conversations"
  on public.conversations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Messages ---------------------------------------------------------------------

alter table public.messages enable row level security;

create policy "Users can manage messages in own conversations"
  on public.messages for all
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

-- Auto-create a profile on signup (safe to re-run). ---------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
