-- Keep legacy clients' schedule totals accurate while category settings are retired.
alter table ops.schedules alter column categories set default array['A','B','C'];
update ops.schedules set categories=array['A','B','C']
where categories is distinct from array['A','B','C'];

create or replace function ops.dispatch(p_event uuid, p_operation text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor ops.staff; t ops.teams; win ops.schedules; draft ops.previews; existing ops.claims;
  prior ops.receipts; request_key uuid; fingerprint text; token text; item jsonb;
  output jsonb; new_preview uuid; staff_input jsonb; wanted_day integer; wanted_mode text;
  active_session uuid; outcome text; target_id uuid;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN|Sign in with an assigned staff account.'; end if;
  active_session := nullif(auth.jwt()->>'session_id','')::uuid;
  if active_session is null or not ops.session_is_active() then
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

  -- Context exposes only the caller's assignment so the client can request MFA.
  if p_operation = 'context' then return ops.staff_json(actor); end if;
  if actor.role = 'admin' and (auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'MFA_REQUIRED|Verify your authenticator code before opening administrator records.';
  end if;
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
      enabled=(item->>'enabled')::boolean,categories=array['A','B','C'],revision=revision+1
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
