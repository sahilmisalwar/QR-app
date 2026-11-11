-- Application tables are private. Only api.call is exposed through PostgREST.
create schema if not exists ops;
create schema if not exists api;
create extension if not exists supabase_vault with schema vault;
do $$ begin
  if not exists (select from pg_roles where rolname = 'rih_executor') then
    create role rih_executor nologin nobypassrls;
  end if;
end $$;

create table ops.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default false
);
create table ops.staff (
  event_id uuid not null references ops.events,
  id uuid not null references auth.users,
  name text not null check (length(name) between 1 and 120),
  role text not null check (role in ('admin','volunteer')),
  mode text not null default 'entry' check (mode in ('entry','lunch','dinner')),
  day integer not null default 1 check (day in (1,2)),
  active boolean not null default true,
  revision integer not null default 1,
  primary key (event_id,id)
);
create table ops.schedules (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references ops.events,
  day integer not null check (day in (1,2)),
  mode text not null check (mode in ('entry','lunch','dinner')),
  opens timestamptz not null,
  closes timestamptz not null,
  enabled boolean not null default false,
  categories text[] not null default '{}',
  revision integer not null default 1,
  unique(event_id,day,mode), unique(event_id,id),
  check (opens < closes), check (categories <@ array['A','B','C']::text[])
);
create table ops.teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references ops.events,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{1,29}$'),
  name text not null check (length(name) between 1 and 120),
  college text not null check (length(college) between 1 and 250),
  category text not null check (category in ('A','B','C')),
  members text[] not null check (cardinality(members) between 1 and 30),
  active boolean not null default true,
  revision integer not null default 1,
  token_hash text unique,
  token_version integer not null default 0,
  vault_id uuid,
  unique(event_id,id), unique(event_id,code)
);
create table ops.previews (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  team_id uuid not null,
  schedule_id uuid not null,
  actor_id uuid not null,
  session_id uuid not null,
  team_revision integer not null,
  token_version integer not null,
  schedule_revision integer not null,
  staff_revision integer not null,
  expires timestamptz not null default clock_timestamp() + interval '60 seconds',
  consumed boolean not null default false,
  foreign key(event_id,team_id) references ops.teams(event_id,id),
  foreign key(event_id,schedule_id) references ops.schedules(event_id,id),
  foreign key(event_id,actor_id) references ops.staff(event_id,id)
);
create table ops.claims (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  team_id uuid not null,
  schedule_id uuid not null,
  team_code text not null,
  team_name text not null,
  category text not null,
  mode text not null,
  day integer not null,
  at timestamptz not null default clock_timestamp(),
  actor_id uuid not null,
  actor text not null,
  status text not null default 'confirmed' check (status in ('confirmed','voided')),
  full_team boolean not null,
  quantity integer not null,
  reason text,
  voided_by uuid,
  voided_at timestamptz,
  foreign key(event_id,team_id) references ops.teams(event_id,id),
  foreign key(event_id,schedule_id) references ops.schedules(event_id,id),
  foreign key(event_id,actor_id) references ops.staff(event_id,id)
);
create unique index one_active_claim on ops.claims(event_id,team_id,day,mode) where status = 'confirmed';
create index claims_history on ops.claims(event_id,at desc,id);
create table ops.receipts (
  event_id uuid not null references ops.events,
  actor_id uuid not null,
  request_id uuid not null,
  fingerprint text not null,
  claim_id uuid not null references ops.claims,
  result_code text not null,
  primary key(event_id,actor_id,request_id)
);
create table ops.audit (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references ops.events,
  at timestamptz not null default clock_timestamp(),
  actor_id uuid not null,
  actor text not null,
  action text not null,
  detail text not null
);
create index audit_history on ops.audit(event_id,at desc,id);

create function ops.team_json(t ops.teams, include_members boolean) returns jsonb language sql immutable
set search_path = '' as $$
  select jsonb_build_object('id',t.id,'code',t.code,'name',t.name,'college',t.college,
    'category',t.category,'members',case when include_members then to_jsonb(t.members) else '[]'::jsonb end,'active',t.active);
$$;
create function ops.staff_json(s ops.staff) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id',s.id,'name',s.name,'role',s.role,'mode',s.mode,'day',s.day,'active',s.active);
$$;
create function ops.claim_json(c ops.claims) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id',c.id,'teamId',c.team_id,'teamCode',c.team_code,'teamName',c.team_name,
    'category',c.category,'mode',c.mode,'day',c.day,'at',c.at,'actor',c.actor,'status',c.status,'reason',c.reason);
$$;
create function ops.write_audit(s ops.staff, action text, detail text) returns void language sql
set search_path = '' as $$
  insert into ops.audit(event_id,actor_id,actor,action,detail) values (s.event_id,s.id,s.name,action,detail);
$$;
create function ops.issue_pass(t ops.teams) returns text language plpgsql set search_path = '' as $$
declare token text; secret_id uuid;
begin
  token := 'RIH1.' || replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  select vault.create_secret(token,'rih-' || t.id::text || '-' || gen_random_uuid()::text,'Encrypted team QR pass') into secret_id;
  update ops.teams set token_hash = encode(sha256(convert_to(token,'UTF8')),'hex'),
    token_version = token_version + 1, vault_id = secret_id where id = t.id and event_id = t.event_id;
  return token;
end $$;
create function ops.save_team(p_event uuid, item jsonb) returns uuid language plpgsql set search_path = '' as $$
declare t ops.teams; member_names text[]; requested_id uuid;
begin
  if jsonb_typeof(item->'members') is distinct from 'array' then
    raise exception 'INVALID_INPUT|A team must include its member names.';
  end if;
  select array_agg(trim(value)) into member_names from jsonb_array_elements_text(item->'members');
  if member_names is null or cardinality(member_names) not between 1 and 30
    or exists(select from unnest(member_names) name where length(name) not between 1 and 120) then
    raise exception 'INVALID_INPUT|Enter between one and thirty valid member names.';
  end if;
  requested_id := nullif(item->>'id','')::uuid;
  if requested_id is not null then
    select * into t from ops.teams where event_id = p_event and id = requested_id;
    if not found then raise exception 'NOT_FOUND|Team not found in this event.'; end if;
  else
    select * into t from ops.teams where event_id = p_event and code = upper(trim(item->>'code'));
  end if;
  if t.id is null then
    insert into ops.teams(event_id,code,name,college,category,members,active)
    values(p_event,upper(trim(item->>'code')),trim(item->>'name'),trim(item->>'college'),item->>'category',member_names,coalesce((item->>'active')::boolean,true))
    returning * into t;
    perform ops.issue_pass(t);
  else
    update ops.teams set code=upper(trim(item->>'code')),name=trim(item->>'name'),college=trim(item->>'college'),
      category=item->>'category',members=member_names,active=coalesce((item->>'active')::boolean,true),revision=revision+1
    where event_id = p_event and id = t.id;
  end if;
  return t.id;
end $$;

-- One short event lock serializes config, QR rotation and confirmation. The
-- partial unique index independently enforces duplicate protection.
create function ops.dispatch(p_event uuid, p_operation text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor ops.staff; t ops.teams; win ops.schedules; draft ops.previews; existing ops.claims;
  prior ops.receipts; request_key uuid; fingerprint text; token text; item jsonb;
  output jsonb; new_preview uuid; staff_input jsonb; wanted_day integer; wanted_mode text;
  active_session uuid; outcome text; target_id uuid;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN|Sign in with an assigned staff account.'; end if;
  active_session := nullif(auth.jwt()->>'session_id','')::uuid;
  if active_session is null or not exists(select from auth.sessions where id=active_session and user_id=auth.uid()) then
    raise exception 'SESSION_EXPIRED|Sign in again to continue.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event::text,0));
  select * into actor from ops.staff where event_id=p_event and id=auth.uid() and active;
  if not found then raise exception 'FORBIDDEN|Your account has no active assignment for this event.'; end if;
  if not exists(select from ops.events where id=p_event and active) then
    raise exception 'EVENT_CLOSED|The event is not open. Ask the event administrator.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 2000000 then
    raise exception 'INVALID_INPUT|The request is invalid or too large.';
  end if;

  if p_operation = 'context' then return ops.staff_json(actor); end if;
  if p_operation in ('snapshot','export') then
    if p_operation='export' and actor.role <> 'admin' then raise exception 'FORBIDDEN|Only administrators can export records.'; end if;
    if p_operation='export' then perform ops.write_audit(actor,'Export','Exported event records'); end if;
    select jsonb_build_object(
      'teams',coalesce((select jsonb_agg(ops.team_json(x,actor.role='admin') order by x.code) from ops.teams x where x.event_id=p_event),'[]'::jsonb),
      'claims',coalesce((select jsonb_agg(ops.claim_json(x) order by x.at desc,x.id) from ops.claims x
        where x.event_id=p_event and (actor.role='admin' or (x.day=actor.day and x.mode=actor.mode))),'[]'::jsonb),
      'staff',coalesce((select jsonb_agg(ops.staff_json(x) order by x.name) from ops.staff x
        where x.event_id=p_event and (actor.role='admin' or x.id=actor.id)),'[]'::jsonb),
      'schedules',coalesce((select jsonb_agg(to_jsonb(x)-'event_id' order by x.day,x.mode) from ops.schedules x
        where x.event_id=p_event and (actor.role='admin' or (x.day=actor.day and x.mode=actor.mode))),'[]'::jsonb),
      'audit',coalesce((select jsonb_agg(to_jsonb(x)-'event_id'-'actor_id' order by x.at desc,x.id) from ops.audit x
        where x.event_id=p_event and actor.role='admin'),'[]'::jsonb),
      'serverTime',clock_timestamp()) into output;
    return output;
  end if;

  if p_operation = 'preview' then
    wanted_day := (p_payload->>'day')::integer;
    wanted_mode := p_payload->>'mode';
    if actor.role='volunteer' and (wanted_day is distinct from actor.day or wanted_mode is distinct from actor.mode) then
      raise exception 'FORBIDDEN|This checkpoint is outside your assignment.';
    end if;
    if length(coalesce(p_payload->>'token','')) not between 10 and 150 then raise exception 'INVALID_QR|This QR pass is invalid.'; end if;
    select * into t from ops.teams where event_id=p_event and token_hash=encode(sha256(convert_to(p_payload->>'token','UTF8')),'hex') and active;
    if not found then raise exception 'INVALID_QR|This pass is invalid, replaced or belongs to another event.'; end if;
    select * into win from ops.schedules where event_id=p_event and day=wanted_day and mode=wanted_mode;
    if not found or not win.enabled or clock_timestamp() < win.opens or clock_timestamp() >= win.closes then
      raise exception 'WINDOW_CLOSED|This checkpoint is currently closed.';
    end if;
    if not (t.category=any(win.categories)) then raise exception 'INELIGIBLE|This team category is not eligible for this service.'; end if;
    select * into existing from ops.claims where event_id=p_event and team_id=t.id and day=win.day and mode=win.mode and status='confirmed';
    if found then
      return jsonb_build_object('id','','team',ops.team_json(t,true),'mode',win.mode,'day',win.day,'expires',clock_timestamp(),
        'decision','ALREADY_CONFIRMED','previous',ops.claim_json(existing));
    end if;
    insert into ops.previews(event_id,team_id,schedule_id,actor_id,session_id,team_revision,token_version,schedule_revision,staff_revision)
    values(p_event,t.id,win.id,actor.id,active_session,t.revision,t.token_version,win.revision,actor.revision) returning id into new_preview;
    return jsonb_build_object('id',new_preview,'team',ops.team_json(t,true),'mode',win.mode,'day',win.day,
      'expires',(select expires from ops.previews where id=new_preview),'decision','ELIGIBLE');
  end if;

  if p_operation in ('confirm','receipt') then
    request_key := (p_payload->>'requestId')::uuid;
    if request_key is null then raise exception 'INVALID_INPUT|A request ID is required.'; end if;
    select * into prior from ops.receipts where event_id=p_event and actor_id=actor.id and request_id=request_key;
    if found then
      fingerprint := coalesce(p_payload->>'previewId','') || ':' || coalesce(p_payload->>'fullTeam','false');
      if p_operation='confirm' and prior.fingerprint <> fingerprint then raise exception 'REQUEST_CONFLICT|This request ID belongs to a different action.'; end if;
      select * into existing from ops.claims where id=prior.claim_id;
      if actor.role='volunteer' and (existing.mode<>actor.mode or existing.day<>actor.day) then raise exception 'FORBIDDEN|Your assignment changed. Ask an administrator to resolve this receipt.'; end if;
      return jsonb_build_object('code',case when existing.status='voided' then 'VOIDED' else prior.result_code end,'claim',ops.claim_json(existing));
    end if;
    if p_operation='receipt' then return 'null'::jsonb; end if;
    select * into draft from ops.previews where id=(p_payload->>'previewId')::uuid and event_id=p_event and actor_id=actor.id and session_id=active_session;
    if not found or draft.consumed or clock_timestamp() >= draft.expires then raise exception 'PREVIEW_EXPIRED|Scan the pass again before confirming.'; end if;
    select * into t from ops.teams where event_id=p_event and id=draft.team_id;
    select * into win from ops.schedules where event_id=p_event and id=draft.schedule_id;
    if not t.active or draft.token_version<>t.token_version or draft.team_revision<>t.revision
      or draft.schedule_revision<>win.revision or draft.staff_revision<>actor.revision then
      raise exception 'CONTEXT_CHANGED|The team, pass or checkpoint changed. Scan again.';
    end if;
    if actor.role='volunteer' and (actor.mode<>win.mode or actor.day<>win.day) then raise exception 'FORBIDDEN|This checkpoint is outside your assignment.'; end if;
    if not win.enabled or clock_timestamp()<win.opens or clock_timestamp()>=win.closes then raise exception 'WINDOW_CLOSED|This checkpoint is currently closed.'; end if;
    if not (t.category=any(win.categories)) then raise exception 'INELIGIBLE|The team is not eligible for this service.'; end if;
    if win.mode <> 'entry' and coalesce((p_payload->>'fullTeam')::boolean,false) is not true then
      raise exception 'FULL_TEAM_REQUIRED|Confirm that every registered team member is present.';
    end if;
    select * into existing from ops.claims where event_id=p_event and team_id=t.id and day=win.day and mode=win.mode and status='confirmed';
    if found then outcome := 'ALREADY_CONFIRMED';
    else
      insert into ops.claims(event_id,team_id,schedule_id,team_code,team_name,category,mode,day,actor_id,actor,full_team,quantity)
      values(p_event,t.id,win.id,t.code,t.name,t.category,win.mode,win.day,actor.id,actor.name,coalesce((p_payload->>'fullTeam')::boolean,false),cardinality(t.members))
      returning * into existing;
      outcome := 'CONFIRMED';
      perform ops.write_audit(actor,'Check-in',t.code || ' · Day ' || win.day || ' · ' || win.mode);
    end if;
    insert into ops.receipts(event_id,actor_id,request_id,fingerprint,claim_id,result_code)
      values(p_event,actor.id,request_key,(p_payload->>'previewId') || ':' || coalesce(p_payload->>'fullTeam','false'),existing.id,outcome);
    update ops.previews set consumed=true where id=draft.id;
    return jsonb_build_object('code',outcome,'claim',ops.claim_json(existing));
  end if;

  if actor.role <> 'admin' then raise exception 'FORBIDDEN|Only an event administrator can perform this action.'; end if;
  if p_operation='save_team' then
    target_id := ops.save_team(p_event,p_payload->'team');
    perform ops.write_audit(actor,'Team updated','Saved team ' || target_id::text);
    return '{}'::jsonb;
  elsif p_operation='import_teams' then
    if jsonb_typeof(p_payload->'teams') is distinct from 'array' or jsonb_array_length(p_payload->'teams') not between 1 and 1000 then
      raise exception 'INVALID_INPUT|Import must contain between one and one thousand teams.';
    end if;
    if exists(select from jsonb_array_elements(p_payload->'teams') x group by upper(trim(x->>'code')) having count(*)>1) then
      raise exception 'INVALID_INPUT|Duplicate team codes were found in this import.';
    end if;
    for item in select value from jsonb_array_elements(p_payload->'teams') loop
      perform ops.save_team(p_event,item-'id');
    end loop;
    perform ops.write_audit(actor,'Roster imported','Imported ' || jsonb_array_length(p_payload->'teams')::text || ' teams');
    return '{}'::jsonb;
  elsif p_operation in ('pass','rotate') then
    select * into t from ops.teams where event_id=p_event and id=(p_payload->>'teamId')::uuid and active;
    if not found then raise exception 'NOT_FOUND|Active team not found.'; end if;
    if p_operation='rotate' then
      if length(trim(coalesce(p_payload->>'reason',''))) not between 5 and 500 then raise exception 'REASON_REQUIRED|Enter a reason of at least five characters.'; end if;
      token := ops.issue_pass(t);
      perform ops.write_audit(actor,'QR replaced',t.code || ' · ' || trim(p_payload->>'reason'));
    else
      select decrypted_secret into token from vault.decrypted_secrets where id=t.vault_id;
      if token is null then raise exception 'PASS_UNAVAILABLE|The pass could not be recovered. Ask the infrastructure owner.'; end if;
      perform ops.write_audit(actor,'Pass downloaded',t.code);
    end if;
    return to_jsonb(token);
  elsif p_operation='void' then
    if length(trim(coalesce(p_payload->>'reason',''))) not between 5 and 500 then raise exception 'REASON_REQUIRED|Enter a reason of at least five characters.'; end if;
    select * into existing from ops.claims where event_id=p_event and id=(p_payload->>'claimId')::uuid;
    if not found then raise exception 'NOT_FOUND|Check-in record not found.'; end if;
    if existing.status='voided' then return '{}'::jsonb; end if;
    update ops.claims set status='voided',reason=trim(p_payload->>'reason'),voided_at=clock_timestamp(),voided_by=actor.id where id=existing.id;
    perform ops.write_audit(actor,'Check-in reversed',existing.team_code || ' · ' || existing.mode || ' · ' || trim(p_payload->>'reason'));
    return '{}'::jsonb;
  elsif p_operation='schedule' then
    item := p_payload->'schedule';
    if length(trim(coalesce(p_payload->>'reason',''))) not between 5 and 500 then raise exception 'REASON_REQUIRED|Enter a reason for changing the schedule.'; end if;
    select * into win from ops.schedules where event_id=p_event and id=(item->>'id')::uuid;
    if not found then raise exception 'NOT_FOUND|Configure the event service rows before editing schedules.'; end if;
    if win.revision <> (item->>'revision')::integer then raise exception 'CONTEXT_CHANGED|This schedule changed. Refresh before editing.'; end if;
    if win.day <> (item->>'day')::integer or win.mode <> item->>'mode' then raise exception 'INVALID_INPUT|A service day and checkpoint identity cannot change.'; end if;
    update ops.schedules set opens=(item->>'opens')::timestamptz,closes=(item->>'closes')::timestamptz,
      enabled=(item->>'enabled')::boolean,categories=array(select jsonb_array_elements_text(item->'categories')),revision=revision+1
      where id=win.id;
    perform ops.write_audit(actor,'Schedule updated','Day ' || win.day || ' · ' || win.mode || ' · ' || trim(p_payload->>'reason'));
    return '{}'::jsonb;
  elsif p_operation='assign' then
    staff_input := p_payload->'staff';
    if staff_input->>'role' <> 'volunteer' then raise exception 'FORBIDDEN|Administrator promotion requires the controlled provisioning process.'; end if;
    if not exists(select from ops.staff where event_id=p_event and id=(staff_input->>'id')::uuid and role='volunteer') then
      raise exception 'NOT_FOUND|Provision the volunteer account before assigning a station.';
    end if;
    if not exists(select from ops.schedules where event_id=p_event and day=(staff_input->>'day')::integer and mode=staff_input->>'mode') then
      raise exception 'INVALID_INPUT|Choose a configured day and checkpoint.';
    end if;
    update ops.staff set name=trim(staff_input->>'name'),day=(staff_input->>'day')::integer,mode=staff_input->>'mode',
      active=(staff_input->>'active')::boolean,revision=revision+1 where event_id=p_event and id=(staff_input->>'id')::uuid;
    perform ops.write_audit(actor,'Assignment updated',trim(staff_input->>'name') || ' · Day ' || (staff_input->>'day') || ' · ' || (staff_input->>'mode'));
    return '{}'::jsonb;
  end if;
  raise exception 'INVALID_OPERATION|This operation is unavailable.';
end $$;

create function api.call(p_event uuid, p_operation text, p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select ops.dispatch(p_event,p_operation,p_payload);
$$;

revoke all on schema ops,api from public,anon,authenticated;
revoke all on all tables in schema ops from public,anon,authenticated;
revoke all on all functions in schema ops,api from public,anon,authenticated;
alter default privileges in schema ops revoke execute on functions from public;
alter default privileges in schema api revoke execute on functions from public;
grant usage on schema ops,api to authenticated;
grant execute on function api.call(uuid,text,jsonb),ops.dispatch(uuid,text,jsonb) to authenticated;
grant usage on schema ops,auth,vault to rih_executor;
grant select on auth.sessions to rih_executor;
grant execute on function auth.uid(),auth.jwt() to rih_executor;
grant select on vault.decrypted_secrets to rih_executor;
grant execute on function vault.create_secret(text,text,text,uuid) to rih_executor;
grant select,insert,update on all tables in schema ops to rih_executor;
revoke update on ops.audit from rih_executor;
grant execute on all functions in schema ops to rih_executor;
-- Hosted Supabase's migration role is not a superuser. Ownership transfer
-- needs role membership and temporary CREATE on the destination schema.
do $$ begin execute format('grant rih_executor to %I', current_user); end $$;
grant create on schema ops to rih_executor;
alter function ops.dispatch(uuid,text,jsonb) owner to rih_executor;
revoke create on schema ops from rih_executor;

do $$ declare table_name text;
begin
  foreach table_name in array array['events','staff','schedules','teams','previews','claims','receipts','audit'] loop
    execute format('alter table ops.%I enable row level security',table_name);
    execute format('create policy internal_access on ops.%I to rih_executor using (true) with check (true)',table_name);
  end loop;
end $$;
