-- WINTER CAMP 2026 — DATABASE + GESTIONALE
-- Eseguire in Supabase > SQL Editor.
-- Lo script può essere rilanciato anche su una versione precedente.

create extension if not exists pgcrypto;

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  is_minister boolean not null,
  church text not null,
  guest_count integer not null default 0 check (guest_count between 0 and 10),
  guest_details text,
  receipt_path text,
  deposit_amount numeric(10,2) not null,
  status text not null default 'ricevuta' check (status in ('ricevuta','confirmed','cancelled')),
  source text not null default 'online' check (source in ('online','manual')),
  confirmation_email_sent_at timestamptz,
  confirmation_email_count integer not null default 0,
  admin_notification_email_sent_at timestamptz,
  payment_status text not null default 'pending' check (payment_status in ('pending','confirmed')),
  payment_confirmed_at timestamptz,
  payment_confirmed_by text,
  hotel_name text,
  room_number text,
  constraint guests_need_details check ((guest_count <= 1) or (guest_details is not null and length(trim(guest_details)) > 0))
);

-- Compatibilità con installazioni già esistenti.
alter table public.registrations add column if not exists updated_at timestamptz not null default now();
alter table public.registrations add column if not exists source text not null default 'online';
alter table public.registrations add column if not exists confirmation_email_sent_at timestamptz;
alter table public.registrations add column if not exists confirmation_email_count integer not null default 0;
alter table public.registrations add column if not exists admin_notification_email_sent_at timestamptz;
alter table public.registrations add column if not exists payment_status text not null default 'pending';
alter table public.registrations add column if not exists payment_confirmed_at timestamptz;
alter table public.registrations add column if not exists payment_confirmed_by text;
alter table public.registrations add column if not exists hotel_name text;
alter table public.registrations add column if not exists room_number text;
alter table public.registrations alter column receipt_path drop not null;

create table if not exists public.admin_users (
  email text primary key
);

-- Centro notifiche del gestionale. Ogni nuova prenotazione genera una notifica persistente.
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
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_notifications(type,title,body,registration_id)
  values(
    'new_registration',
    'Nuova prenotazione',
    trim(new.first_name || ' ' || new.last_name) || ' · ' || new.guest_count || case when new.guest_count = 1 then ' persona' else ' persone' end || ' · ' || new.church,
    new.id
  );
  return new;
end;
$$;

drop trigger if exists trg_registration_admin_notification on public.registrations;
create trigger trg_registration_admin_notification
after insert on public.registrations
for each row execute function public.create_registration_admin_notification();

-- Una riga per ogni PERSONA che deve effettuare il check-in in hotel.
create table if not exists public.registration_participants (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  participant_key text not null,
  participant_order integer not null default 0,
  participant_name text not null,
  birth_date date,
  checked_in boolean not null default false,
  checked_in_at timestamptz,
  checked_in_by text,
  issue boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(registration_id, participant_key)
);

create index if not exists idx_registration_participants_registration on public.registration_participants(registration_id);
create index if not exists idx_registration_participants_checkin on public.registration_participants(checked_in);

-- Mantiene automaticamente sincronizzate le PERSONE con il check-in.
-- IMPORTANTE: guest_count è mantenuto per compatibilità con le versioni precedenti,
-- ma rappresenta il NUMERO TOTALE DI PERSONE della prenotazione, incluso il referente.
-- Esempio: Samuele + Debora = guest_count 2 e guest_details contiene solo Debora.

-- Aggiorna anche il vincolo delle vecchie installazioni:
-- i dettagli degli altri partecipanti sono richiesti solo quando le persone totali sono > 1.
alter table public.registrations drop constraint if exists guests_need_details;
alter table public.registrations add constraint guests_need_details
check ((guest_count <= 1) or (guest_details is not null and length(trim(guest_details)) > 0));

create or replace function public.sync_registration_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lines text[];
  i integer;
  extra_count integer;
  raw_line text;
  guest_name text;
  guest_birth date;
begin
  -- 1) Il referente che compila il modulo è SEMPRE la prima persona del check-in.
  insert into public.registration_participants(
    registration_id, participant_key, participant_order, participant_name, birth_date, updated_at
  ) values (
    new.id, 'main', 0, trim(new.first_name || ' ' || new.last_name), null, now()
  )
  on conflict (registration_id, participant_key) do update set
    participant_order = 0,
    participant_name = excluded.participant_name,
    updated_at = now();

  -- 2) Le altre righe arrivano dal textarea. Se le persone totali sono 2,
  --    deve esistere UNA sola riga aggiuntiva oltre al referente.
  extra_count := greatest(new.guest_count - 1, 0);
  lines := regexp_split_to_array(coalesce(new.guest_details,''), E'\r?\n');

  if extra_count > 0 then
    for i in 1..extra_count loop
      raw_line := trim(coalesce(lines[i],''));
      guest_birth := null;

      if raw_line ~ '[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}' then
        begin
          guest_birth := to_date(substring(raw_line from '([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})'), 'DD/MM/YYYY');
        exception when others then
          guest_birth := null;
        end;
      end if;

      guest_name := trim(regexp_replace(raw_line, ',?\s*[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}.*$', '', 'g'));
      if guest_name = '' then guest_name := 'Partecipante ' || (i + 1); end if;

      insert into public.registration_participants(
        registration_id, participant_key, participant_order, participant_name, birth_date, updated_at
      ) values (
        new.id, 'guest-' || i, i, guest_name, guest_birth, now()
      )
      on conflict (registration_id, participant_key) do update set
        participant_order = excluded.participant_order,
        participant_name = excluded.participant_name,
        birth_date = excluded.birth_date,
        updated_at = now();
    end loop;
  end if;

  -- 3) Elimina eventuali placeholder/righe in eccesso create dalle versioni precedenti.
  delete from public.registration_participants
  where registration_id = new.id
    and participant_key like 'guest-%'
    and coalesce(nullif(substring(participant_key from 7), '')::integer, 9999) > extra_count;

  return new;
end;
$$;

drop trigger if exists trg_sync_registration_participants on public.registrations;
create trigger trg_sync_registration_participants
after insert or update of first_name,last_name,guest_count,guest_details
on public.registrations
for each row execute function public.sync_registration_participants();

-- Helper per correggere e sincronizzare anche tutte le prenotazioni già presenti.
create or replace function public.sync_registration_participants_row(p_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.registrations%rowtype;
  lines text[];
  i integer;
  extra_count integer;
  raw_line text;
  guest_name text;
  guest_birth date;
begin
  select * into r from public.registrations where id = p_registration_id;
  if not found then return; end if;

  insert into public.registration_participants(
    registration_id,participant_key,participant_order,participant_name,birth_date,updated_at
  ) values (
    r.id,'main',0,trim(r.first_name || ' ' || r.last_name),null,now()
  )
  on conflict(registration_id,participant_key) do update set
    participant_order=0,
    participant_name=excluded.participant_name,
    updated_at=now();

  extra_count := greatest(r.guest_count - 1, 0);
  lines := regexp_split_to_array(coalesce(r.guest_details,''), E'\r?\n');

  if extra_count > 0 then
    for i in 1..extra_count loop
      raw_line := trim(coalesce(lines[i],''));
      guest_birth := null;
      if raw_line ~ '[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}' then
        begin
          guest_birth := to_date(substring(raw_line from '([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})'),'DD/MM/YYYY');
        exception when others then
          guest_birth := null;
        end;
      end if;
      guest_name := trim(regexp_replace(raw_line, ',?\s*[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}.*$', '', 'g'));
      if guest_name='' then guest_name:='Partecipante '||(i+1); end if;

      insert into public.registration_participants(
        registration_id,participant_key,participant_order,participant_name,birth_date,updated_at
      ) values (
        r.id,'guest-'||i,i,guest_name,guest_birth,now()
      )
      on conflict(registration_id,participant_key) do update set
        participant_order=excluded.participant_order,
        participant_name=excluded.participant_name,
        birth_date=excluded.birth_date,
        updated_at=now();
    end loop;
  end if;

  delete from public.registration_participants
  where registration_id = r.id
    and participant_key like 'guest-%'
    and coalesce(nullif(substring(participant_key from 7), '')::integer, 9999) > extra_count;
end;
$$;

-- Corregge immediatamente anche i dati storici già inseriti.
do $$
declare x record;
begin
  for x in select id from public.registrations loop
    perform public.sync_registration_participants_row(x.id);
  end loop;
end $$;

alter table public.registrations enable row level security;
alter table public.admin_users enable row level security;
alter table public.admin_notifications enable row level security;
alter table public.registration_participants enable row level security;

-- Modulo pubblico: può solo INSERIRE prenotazioni.
drop policy if exists "public can submit registrations" on public.registrations;
create policy "public can submit registrations"
on public.registrations for insert
to anon, authenticated
with check (true);

-- Admin: lettura / inserimento / modifica / eliminazione prenotazioni.
drop policy if exists "admins can read registrations" on public.registrations;
create policy "admins can read registrations"
on public.registrations for select
to authenticated
using (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')));

drop policy if exists "admins can insert registrations" on public.registrations;
create policy "admins can insert registrations"
on public.registrations for insert
to authenticated
with check (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')));

drop policy if exists "admins can update registrations" on public.registrations;
create policy "admins can update registrations"
on public.registrations for update
to authenticated
using (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')))
with check (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')));

drop policy if exists "admins can delete registrations" on public.registrations;
create policy "admins can delete registrations"
on public.registrations for delete
to authenticated
using (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')));

-- Admin users.
drop policy if exists "admins can read own admin row" on public.admin_users;
create policy "admins can read own admin row"
on public.admin_users for select
to authenticated
using (lower(email)=lower(auth.jwt()->>'email'));

-- Notifiche gestionali: solo admin.
drop policy if exists "admins can read notifications" on public.admin_notifications;
create policy "admins can read notifications"
on public.admin_notifications for select
to authenticated
using (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')));

drop policy if exists "admins can update notifications" on public.admin_notifications;
create policy "admins can update notifications"
on public.admin_notifications for update
to authenticated
using (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')))
with check (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')));

drop policy if exists "admins can delete notifications" on public.admin_notifications;
create policy "admins can delete notifications"
on public.admin_notifications for delete
to authenticated
using (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')));

-- Partecipanti / check-in: solo admin.
drop policy if exists "admins can read participants" on public.registration_participants;
create policy "admins can read participants"
on public.registration_participants for select
to authenticated
using (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')));

drop policy if exists "admins can insert participants" on public.registration_participants;
create policy "admins can insert participants"
on public.registration_participants for insert
to authenticated
with check (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')));

drop policy if exists "admins can update participants" on public.registration_participants;
create policy "admins can update participants"
on public.registration_participants for update
to authenticated
using (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')))
with check (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')));

drop policy if exists "admins can delete participants" on public.registration_participants;
create policy "admins can delete participants"
on public.registration_participants for delete
to authenticated
using (exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')));

-- REALTIME (evita errore se già presenti nella publication).
do $$ begin
  alter publication supabase_realtime add table public.registrations;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.registration_participants;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.admin_notifications;
exception when duplicate_object then null; end $$;

-- STORAGE: bucket privato per le distinte.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('payment-receipts','payment-receipts',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "public can upload payment receipts" on storage.objects;
create policy "public can upload payment receipts"
on storage.objects for insert to anon,authenticated
with check(bucket_id='payment-receipts');

drop policy if exists "admins can read payment receipts" on storage.objects;
create policy "admins can read payment receipts"
on storage.objects for select to authenticated
using(bucket_id='payment-receipts' and exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')));

drop policy if exists "admins can delete payment receipts" on storage.objects;
create policy "admins can delete payment receipts"
on storage.objects for delete to authenticated
using(bucket_id='payment-receipts' and exists(select 1 from public.admin_users a where lower(a.email)=lower(auth.jwt()->>'email')));

-- Dopo aver creato l'utente in Authentication > Users:
-- insert into public.admin_users(email) values ('tuaemail@example.com') on conflict do nothing;
