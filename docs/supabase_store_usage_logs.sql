-- Suggested Lite usage log table.
-- This file is documentation only. Do not run automatically.
-- Do not store property data, image data, prompts, user full input, URLs, paths, base64, cards, QR Codes, PDFs, 591 screenshots, or Rakuya screenshots.

create table if not exists public.store_usage_logs (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  event_type text not null,
  stage text null,
  success boolean default true,
  created_at timestamptz default now()
);

create index if not exists store_usage_logs_store_id_idx
  on public.store_usage_logs (store_id);

create index if not exists store_usage_logs_created_at_idx
  on public.store_usage_logs (created_at desc);
