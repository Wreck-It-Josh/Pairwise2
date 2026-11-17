-- Pairwise backend for Supabase.
-- Run this once in your project: Supabase dashboard > SQL Editor > New query > paste > Run.
-- It is safe to run on a fresh project only (it creates tables, it does not migrate them).
--
-- What lives here:
--   profiles      one row per account (display name + which household they belong to)
--   households    a pair of partners, joined with an invite code
--   budgets       each person's own budget, stored as one JSON document, private to them
--   joint_plans   shared savings plans, visible only to the two people in the household
--   joint_moves   money added to / taken from joint plans, one row per entry

-- ---------- tables ----------

create table public.households (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  name         text not null default '' check (char_length(name) <= 80),
  household_id uuid references public.households (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index profiles_household_idx on public.profiles (household_id);

create table public.budgets (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null check (octet_length(data::text) < 5000000),
  updated_at timestamptz not null default now()
);

create table public.joint_plans (
  household_id uuid not null references public.households (id) on delete cascade,
  id           text not null check (char_length(id) <= 64),
  data         jsonb not null check (octet_length(data::text) < 20000),
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  primary key (household_id, id)
);

create table public.joint_moves (
  household_id uuid not null references public.households (id) on delete cascade,
  id           text not null check (char_length(id) <= 64),
  data         jsonb not null check (octet_length(data::text) < 20000),
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  primary key (household_id, id)
);

-- ---------- helpers ----------

-- The signed-in person's household (security definer so policies can use it without recursion).
create function public.my_household() returns uuid
language sql stable security definer set search_path = '' as $$
  select household_id from public.profiles where id = auth.uid()
$$;

-- Create a profile automatically when someone signs up (name comes from the sign-up form).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'name', ''), 80));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- households: create / join / leave ----------

-- Creates a household for the caller and returns its 10-character invite code.
-- If the caller is already in one, returns that household's code.
create function public.create_household() returns text
language plpgsql security definer set search_path = '' as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';  -- Crockford base32: no I, L, O, U
  idx constant int[] := array[0,1,2,3,4,5,10,11,12,13];          -- fully random bytes of a v4 uuid
  hid uuid; c text; b bytea; i int;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select household_id into hid from public.profiles where id = auth.uid();
  if hid is not null then
    select code into c from public.households where id = hid;
    return c;
  end if;
  loop
    b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    c := '';
    foreach i in array idx loop
      c := c || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    begin
      insert into public.households (code) values (c) returning id into hid;
      exit;
    exception when unique_violation then
      -- extremely unlikely; try another code
    end;
  end loop;
  update public.profiles set household_id = hid where id = auth.uid();
  return c;
end $$;

-- Joins the household with this invite code. A household holds at most two people.
create function public.join_household(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare hid uuid; cur uuid; n int;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select id into hid from public.households
   -- ignore dashes/spaces, and read the look-alikes O, I, L as 0, 1, 1
   where code = translate(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'OIL', '011')
   for update;
  if hid is null then raise exception 'invalid_code'; end if;
  select household_id into cur from public.profiles where id = auth.uid();
  if cur = hid then return hid; end if;
  if cur is not null then raise exception 'already_in_household'; end if;
  select count(*) into n from public.profiles where household_id = hid;
  if n >= 2 then raise exception 'household_full'; end if;
  update public.profiles set household_id = hid where id = auth.uid();
  return hid;
end $$;

-- Leaves the current household. When the last person leaves, its plans are deleted.
create function public.leave_household() returns void
language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select household_id into hid from public.profiles where id = auth.uid();
  if hid is null then return; end if;
  update public.profiles set household_id = null where id = auth.uid();
  delete from public.households h
   where h.id = hid
     and not exists (select 1 from public.profiles p where p.household_id = hid);
end $$;

revoke execute on function public.my_household(), public.create_household(),
  public.join_household(text), public.leave_household() from public, anon;
grant execute on function public.my_household(), public.create_household(),
  public.join_household(text), public.leave_household() to authenticated;

-- ---------- row level security ----------

alter table public.households  enable row level security;
alter table public.profiles    enable row level security;
alter table public.budgets     enable row level security;
alter table public.joint_plans enable row level security;
alter table public.joint_moves enable row level security;

-- households: you can read your own household (for its invite code). Changes go through the functions above.
create policy "read own household" on public.households
  for select to authenticated using (id = public.my_household());

-- profiles: read your own and your partner's; edit only your own name.
create policy "read self and partner" on public.profiles
  for select to authenticated
  using (id = auth.uid() or (household_id is not null and household_id = public.my_household()));
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (name) on public.profiles to authenticated;

-- budgets: strictly private to their owner.
create policy "own budget" on public.budgets
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- joint plans: both partners can read and change them.
create policy "household reads plans" on public.joint_plans
  for select to authenticated using (household_id = public.my_household());
create policy "household adds plans" on public.joint_plans
  for insert to authenticated with check (household_id = public.my_household());
create policy "household edits plans" on public.joint_plans
  for update to authenticated using (household_id = public.my_household())
  with check (household_id = public.my_household());
create policy "household deletes plans" on public.joint_plans
  for delete to authenticated using (household_id = public.my_household());

-- joint moves: both can read and edit (deleting a plan re-assigns its money), only the author can delete.
create policy "household reads moves" on public.joint_moves
  for select to authenticated using (household_id = public.my_household());
create policy "household adds moves" on public.joint_moves
  for insert to authenticated
  with check (household_id = public.my_household() and created_by = auth.uid());
create policy "household edits moves" on public.joint_moves
  for update to authenticated using (household_id = public.my_household())
  with check (household_id = public.my_household());
create policy "author deletes moves" on public.joint_moves
  for delete to authenticated
  using (household_id = public.my_household() and created_by = auth.uid());

revoke all on public.households, public.profiles, public.budgets,
  public.joint_plans, public.joint_moves from anon;

-- ---------- realtime (live joint plans on both phones) ----------

alter publication supabase_realtime add table public.joint_plans, public.joint_moves;
