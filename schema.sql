-- Notes app schema — run in the NEW Supabase project's SQL editor.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists flowcharts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null default 'Untitled chart',
  data jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists flowcharts_user_idx on flowcharts (user_id, updated_at desc);
