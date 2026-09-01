-- Wardrobe v1 — clothing inventory, outfits, wear log, stylist chat.
-- Own-only (RLS user_id = auth.uid()). One statement per line (copy-paste safe).
-- No dollar-quoted bodies, so an SQL-editor paste cannot mangle it.
-- Safe to re-run: create if not exists / drop policy if exists. It NEVER drops a
-- table — unlike the older scripts here, this one holds real inventory data.

-- ---- 1) Items ---------------------------------------------------------------
create table if not exists public.wardrobe_items (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade, name text not null, category text not null default 'top', subcategory text, brand text, size text, material text, colors text[] not null default '{}', pattern text, seasons text[] not null default '{}', warmth int not null default 3, formality int not null default 3, is_waterproof boolean not null default false, is_favorite boolean not null default false, tags text[] not null default '{}', price_cents int, purchased_on date, location text not null default 'mine', photo_path text, label_path text, cutout_path text, wear_count int not null default 0, last_worn_on date, wash_after_wears int, needs_wash boolean not null default false, notes text, ai_fields jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.wardrobe_items drop constraint if exists wardrobe_items_category_check;
alter table public.wardrobe_items add constraint wardrobe_items_category_check check (category in ('top','bottom','dress','outerwear','shoes','accessory','headwear','bag','underwear','sportswear','sleepwear','swimwear'));
alter table public.wardrobe_items drop constraint if exists wardrobe_items_location_check;
alter table public.wardrobe_items add constraint wardrobe_items_location_check check (location in ('mine','mom','dad','laundry','packed','lost'));
alter table public.wardrobe_items drop constraint if exists wardrobe_items_warmth_check;
alter table public.wardrobe_items add constraint wardrobe_items_warmth_check check (warmth between 1 and 5);
alter table public.wardrobe_items drop constraint if exists wardrobe_items_formality_check;
alter table public.wardrobe_items add constraint wardrobe_items_formality_check check (formality between 1 and 5);
alter table public.wardrobe_items enable row level security;
drop policy if exists wardrobe_items_own on public.wardrobe_items;
create policy wardrobe_items_own on public.wardrobe_items for all to authenticated using (user_id = auth.uid());
create index if not exists wardrobe_items_user_loc on public.wardrobe_items (user_id, location);
create index if not exists wardrobe_items_user_cat on public.wardrobe_items (user_id, category);
create index if not exists wardrobe_items_user_worn on public.wardrobe_items (user_id, last_worn_on);

-- ---- 2) Outfits -------------------------------------------------------------
create table if not exists public.wardrobe_outfits (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade, name text, item_ids uuid[] not null default '{}', source text not null default 'ai', brief text, reasoning text, weather jsonb, worn_on date, is_favorite boolean not null default false, created_at timestamptz not null default now());
alter table public.wardrobe_outfits drop constraint if exists wardrobe_outfits_source_check;
alter table public.wardrobe_outfits add constraint wardrobe_outfits_source_check check (source in ('ai','manual'));
alter table public.wardrobe_outfits enable row level security;
drop policy if exists wardrobe_outfits_own on public.wardrobe_outfits;
create policy wardrobe_outfits_own on public.wardrobe_outfits for all to authenticated using (user_id = auth.uid());
create index if not exists wardrobe_outfits_user_worn on public.wardrobe_outfits (user_id, worn_on desc);

-- ---- 3) Wear log ------------------------------------------------------------
create table if not exists public.wardrobe_wears (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade, item_id uuid not null references public.wardrobe_items on delete cascade, outfit_id uuid references public.wardrobe_outfits on delete set null, worn_on date not null default current_date, created_at timestamptz not null default now());
alter table public.wardrobe_wears enable row level security;
drop policy if exists wardrobe_wears_own on public.wardrobe_wears;
create policy wardrobe_wears_own on public.wardrobe_wears for all to authenticated using (user_id = auth.uid());
create index if not exists wardrobe_wears_user_day on public.wardrobe_wears (user_id, worn_on desc);
create index if not exists wardrobe_wears_item on public.wardrobe_wears (item_id);

-- ---- 4) Stylist chat --------------------------------------------------------
create table if not exists public.wardrobe_chat (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade, role text not null, content text not null, outfit_id uuid references public.wardrobe_outfits on delete set null, created_at timestamptz not null default now());
alter table public.wardrobe_chat drop constraint if exists wardrobe_chat_role_check;
alter table public.wardrobe_chat add constraint wardrobe_chat_role_check check (role in ('user','assistant'));
alter table public.wardrobe_chat enable row level security;
drop policy if exists wardrobe_chat_own on public.wardrobe_chat;
create policy wardrobe_chat_own on public.wardrobe_chat for all to authenticated using (user_id = auth.uid());
create index if not exists wardrobe_chat_user_at on public.wardrobe_chat (user_id, created_at);

-- ---- 5) Private "wardrobe" storage bucket, one folder per user --------------
-- PRIVATE on purpose (unlike avatars): photos of his clothes and of his rooms
-- are not world-readable. The app reads them through signed URLs.
insert into storage.buckets (id, name, public) values ('wardrobe', 'wardrobe', false) on conflict (id) do update set public = false;
drop policy if exists wardrobe_own_read on storage.objects;
create policy wardrobe_own_read on storage.objects for select to authenticated using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists wardrobe_own_write on storage.objects;
create policy wardrobe_own_write on storage.objects for insert to authenticated with check (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists wardrobe_own_update on storage.objects;
create policy wardrobe_own_update on storage.objects for update to authenticated using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists wardrobe_own_delete on storage.objects;
create policy wardrobe_own_delete on storage.objects for delete to authenticated using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = auth.uid()::text);
