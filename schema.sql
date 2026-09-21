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
  constraint guests_need_details check ((guest_count = 0) or (guest_details is not null and length(trim(guest_details)) > 0))
);

-- Compatibilità con installazioni già esistenti.
alter table public.registrations add column if not exists updated_at timestamptz not null default now();
alter table public.registrations add column if not exists source text not null default 'online';
alter table public.registrations add column if not exists confirmation_email_sent_at timestamptz;
alter table public.registrations alter column receipt_path drop not null;

create table if not exists public.admin_users (
  email text primary key
);

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

-- Mantiene automaticamente sincronizzati gli ospiti con il check-in.
-- Il campo guest_count rappresenta il numero totale di persone prenotate
-- ai fini dell'acconto (€20 per persona). Il referente del modulo non viene
-- aggiunto automaticamente al check-in. Per gli ospiti si aspetta una riga
-- per persona, ad esempio: Mario Rossi, 01/01/2000
create or replace function public.sync_registration_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lines text[];
  i integer;
  raw_line text;
  guest_name text;
  guest_birth date;
begin
  -- Rimuove eventuali righe 'main' create da versioni precedenti.
  delete from public.registration_participants
  where registration_id = new.id and participant_key = 'main';

  lines := regexp_split_to_array(coalesce(new.guest_details,''), E'\\r?\\n');

  if new.guest_count > 0 then
    for i in 1..new.guest_count loop
      raw_line := trim(coalesce(lines[i],''));
      guest_birth := null;

      if raw_line ~ '[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}' then
        begin
          guest_birth := to_date(substring(raw_line from '([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})'), 'DD/MM/YYYY');
        exception when others then
          guest_birth := null;
        end;
      end if;

      guest_name := trim(regexp_replace(raw_line, ',?\\s*[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}.*$', '', 'g'));
      if guest_name = '' then guest_name := 'Ospite ' || i; end if;

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

  delete from public.registration_participants
  where registration_id = new.id
    and participant_key like 'guest-%'
    and coalesce(nullif(substring(participant_key from 7), '')::integer, 9999) > new.guest_count;

  return new;
end;
$$;

drop trigger if exists trg_sync_registration_participants on public.registrations;
create trigger trg_sync_registration_participants
after insert or update of first_name,last_name,guest_count,guest_details
on public.registrations
for each row execute function public.sync_registration_participants();

-- Helper per sincronizzare le righe storiche senza alterare i dati della prenotazione.
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
  raw_line text;
  guest_name text;
  guest_birth date;
begin
  select * into r from public.registrations where id = p_registration_id;
  if not found then return; end if;

  -- Rimuove eventuali righe 'main' create da versioni precedenti.
  delete from public.registration_participants
  where registration_id = r.id and participant_key = 'main';

  lines := regexp_split_to_array(coalesce(r.guest_details,''), E'\\r?\\n');
  if r.guest_count > 0 then
    for i in 1..r.guest_count loop
      raw_line := trim(coalesce(lines[i],'')); guest_birth := null;
      if raw_line ~ '[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}' then
        begin guest_birth := to_date(substring(raw_line from '([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})'),'DD/MM/YYYY'); exception when others then guest_birth:=null; end;
      end if;
      guest_name := trim(regexp_replace(raw_line, ',?\\s*[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}.*$', '', 'g'));
      if guest_name='' then guest_name:='Ospite '||i; end if;
      insert into public.registration_participants(registration_id,participant_key,participant_order,participant_name,birth_date,updated_at)
      values(r.id,'guest-'||i,i,guest_name,guest_birth,now())
      on conflict(registration_id,participant_key) do update set participant_order=excluded.participant_order,participant_name=excluded.participant_name,birth_date=excluded.birth_date,updated_at=now();
    end loop;
  end if;
end;
$$;

-- Ora sincronizza davvero tutte le righe storiche.
do $$
declare x record;
begin
  for x in select id from public.registrations loop
    perform public.sync_registration_participants_row(x.id);
  end loop;
end $$;

alter table public.registrations enable row level security;
alter table public.admin_users enable row level security;
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
