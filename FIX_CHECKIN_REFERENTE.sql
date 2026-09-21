-- FIX CHECK-IN: referente + altri partecipanti
-- Eseguire UNA VOLTA in Supabase > SQL Editor sulla versione precedente.

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

