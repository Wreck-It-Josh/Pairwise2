-- Pairwise: lock-screen notifications (web push).
-- Run this once, after schema.sql: Supabase dashboard > SQL Editor > New query > paste > Run.
--
--   push_subs   one row per phone or browser that turned notifications on: where to deliver them.
--               Only the owner can see or remove their rows.
--
-- The notify function (netlify/functions/notify.mjs) runs as the signed-in sender and can only ask for
-- the subscriptions of the *other* person in the sender's household, through partner_push_subs().

create table public.push_subs (
  endpoint   text primary key check (char_length(endpoint) between 10 and 1000),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh     text not null check (char_length(p256dh) < 200),
  auth       text not null check (char_length(auth) < 100),
  created_at timestamptz not null default now()
);
create index push_subs_user_idx on public.push_subs (user_id);

alter table public.push_subs enable row level security;

create policy "own push subs: read" on public.push_subs
  for select to authenticated using (user_id = auth.uid());
create policy "own push subs: remove" on public.push_subs
  for delete to authenticated using (user_id = auth.uid());
revoke all on public.push_subs from anon;
revoke insert, update on public.push_subs from authenticated;

-- Saves this device's subscription for the caller. A device that was used by someone else before
-- (same endpoint) now belongs to the caller.
create function public.save_push_sub(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_endpoint !~ '^https://' then raise exception 'bad_endpoint'; end if;
  insert into public.push_subs (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end $$;

-- Where to deliver a notification for the caller's partner (never the caller's own devices).
create function public.partner_push_subs() returns table (endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = '' as $$
  select s.endpoint, s.p256dh, s.auth
    from public.push_subs s
    join public.profiles p on p.id = s.user_id
   where p.household_id is not null
     and p.household_id = public.my_household()
     and s.user_id <> auth.uid()
$$;

-- Removes a partner's subscription that the push service reported as gone (phone reset, permission off).
create function public.drop_partner_push_sub(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subs s
   using public.profiles p
   where s.endpoint = p_endpoint
     and p.id = s.user_id
     and p.household_id is not null
     and p.household_id = public.my_household()
$$;

revoke execute on function public.save_push_sub(text, text, text), public.partner_push_subs(),
  public.drop_partner_push_sub(text) from public, anon;
grant execute on function public.save_push_sub(text, text, text), public.partner_push_subs(),
  public.drop_partner_push_sub(text) to authenticated;
