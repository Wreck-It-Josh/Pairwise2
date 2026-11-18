-- Pairwise: shared lists (partner sync).
-- Run this once, after schema.sql: Supabase dashboard > SQL Editor > New query > paste > Run.
--
--   shared_lists   a list both partners see (name, sections, budget, shopping history), one row per list
--   shared_items   the items on those lists, one row per item, so two people ticking at once never
--                  overwrite each other
--
-- Only the two people in a household can read or change their household's rows.

create table public.shared_lists (
  household_id uuid not null references public.households (id) on delete cascade,
  id           text not null check (char_length(id) <= 64),
  data         jsonb not null check (octet_length(data::text) < 200000),
  updated_at   timestamptz not null default now(),
  primary key (household_id, id)
);

create table public.shared_items (
  household_id uuid not null,
  list_id      text not null,
  id           text not null check (char_length(id) <= 64),
  data         jsonb not null check (octet_length(data::text) < 20000),
  updated_at   timestamptz not null default now(),
  primary key (household_id, id),
  -- deleting a list deletes its items
  foreign key (household_id, list_id) references public.shared_lists (household_id, id) on delete cascade
);
create index shared_items_list_idx on public.shared_items (household_id, list_id);

alter table public.shared_lists enable row level security;
alter table public.shared_items enable row level security;

create policy "household uses shared lists" on public.shared_lists
  for all to authenticated
  using (household_id = public.my_household())
  with check (household_id = public.my_household());

create policy "household uses shared items" on public.shared_items
  for all to authenticated
  using (household_id = public.my_household())
  with check (household_id = public.my_household());

revoke all on public.shared_lists, public.shared_items from anon;

-- live updates on both phones
alter publication supabase_realtime add table public.shared_lists, public.shared_items;
