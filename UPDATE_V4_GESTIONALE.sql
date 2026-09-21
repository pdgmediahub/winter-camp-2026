-- WINTER CAMP V4 — AGGIORNAMENTO GESTIONALE
-- Esegui una sola volta (può comunque essere rilanciato) in Supabase > SQL Editor.

create extension if not exists pgcrypto;

alter table public.registrations add column if not exists confirmation_email_count integer not null default 0;
alter table public.registrations add column if not exists admin_notification_email_sent_at timestamptz;
alter table public.registrations add column if not exists payment_status text not null default 'pending';
alter table public.registrations add column if not exists payment_confirmed_at timestamptz;
alter table public.registrations add column if not exists payment_confirmed_by text;
alter table public.registrations add column if not exists hotel_name text;
alter table public.registrations add column if not exists room_number text;

create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type text not null default 'new_registration',
  title text not null,
  body text not null,
  registration_id uuid references public.registrations(id) on delete cascade,
  read_at timestamptz
);
create index if not exists idx_admin_notifications_created on public.admin_notifications(created_at desc);
create index if not exists idx_admin_notifications_unread on public.admin_notifications(read_at) where read_at is null;

create or replace function public.create_registration_admin_notification()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.admin_notifications(type,title,body,registration_id)
  values('new_registration','Nuova prenotazione',trim(new.first_name || ' ' || new.last_name) || ' · ' || new.guest_count || case when new.guest_count = 1 then ' persona' else ' persone' end || ' · ' || new.church,new.id);
  return new;
end; $$;

drop trigger if exists trg_registration_admin_notification on public.registrations;
create trigger trg_registration_admin_notification after insert on public.registrations for each row execute function public.create_registration_admin_notification();

alter table public.admin_notifications enable row level security;

drop policy if exists "admins can read notifications" on public.admin_notifications;
create policy "admins can read notifications" on public.admin_notifications for select to authenticated
using (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')));

drop policy if exists "admins can update notifications" on public.admin_notifications;
create policy "admins can update notifications" on public.admin_notifications for update to authenticated
using (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')))
with check (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')));

drop policy if exists "admins can delete notifications" on public.admin_notifications;
create policy "admins can delete notifications" on public.admin_notifications for delete to authenticated
using (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')));

do $$ begin
  alter publication supabase_realtime add table public.admin_notifications;
exception when duplicate_object then null; end $$;
