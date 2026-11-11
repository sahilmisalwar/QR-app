-- Hosted integration check. Every fixture, including Auth and Vault rows, is rolled back.
-- This tests database authorization with simulated JWT claims, not an Auth sign-in.
begin;
do $$
declare e uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); v uuid:=gen_random_uuid();
  sa uuid:=gen_random_uuid(); sv uuid:=gen_random_uuid();
begin
  insert into auth.users(id) values(a),(v);
  insert into auth.sessions(id,user_id) values(sa,a),(sv,v);
  insert into ops.events(id,name,active) values(e,'Disposable transaction verification',true);
  insert into ops.staff(event_id,id,name,role,mode) values(e,a,'Verification admin','admin','entry'),(e,v,'Verification volunteer','volunteer','lunch');
  insert into ops.schedules(event_id,day,mode,opens,closes,enabled,categories)
    select e,1,m,now()-interval '1 hour',now()+interval '1 hour',true,array['A','B','C'] from unnest(array['entry','lunch','dinner']) m;
  perform set_config('test.event',e::text,true);
  perform set_config('test.admin',a::text,true);
  perform set_config('test.volunteer',v::text,true);
  perform set_config('test.admin_session',sa::text,true);
  perform set_config('test.volunteer_session',sv::text,true);
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'session_id',sa,'role','authenticated','aal','aal2')::text,true);
end $$;
set local role authenticated;
do $$
declare
 e uuid:=current_setting('test.event')::uuid; t uuid; token text; rotated text;
 p jsonb; p2 jsonb; receipt jsonb; replay jsonb; snapshot jsonb; request_id uuid:=gen_random_uuid();
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.admin'),'session_id',current_setting('test.admin_session'),'role','authenticated','aal','aal1')::text,true);
 if api.call(e,'context','{}')->>'role' <> 'admin' then raise exception 'CHECK_FAILED: enrollment context'; end if;
 begin
   perform api.call(e,'snapshot','{}');
   raise exception 'CHECK_FAILED: admin data without MFA allowed';
 exception when raise_exception then if sqlerrm not like 'MFA_REQUIRED|%' then raise; end if; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.admin'),'session_id',current_setting('test.admin_session'),'role','authenticated','aal','aal2')::text,true);
 begin
   perform * from ops.teams;
   raise exception 'CHECK_FAILED: direct table access allowed';
 exception when insufficient_privilege then null; end;
 perform api.call(e,'save_team',jsonb_build_object('team',jsonb_build_object('code','QA-001','name','Disposable verification','college','Verification','category','A','members',jsonb_build_array('Test member'),'active',true)));
 snapshot:=api.call(e,'snapshot','{}');
 t:=(snapshot->'teams'->0->>'id')::uuid;
 token:=api.call(e,'pass',jsonb_build_object('teamId',t))#>>'{}';
 if token not like 'RIH1.%' then raise exception 'CHECK_FAILED: Vault roundtrip'; end if;
 perform set_config('request.jwt.claim.sub',current_setting('test.volunteer'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.volunteer'),'session_id',current_setting('test.volunteer_session'),'role','authenticated','aal','aal2')::text,true);
 begin
   perform api.call(e,'export','{}');
   raise exception 'CHECK_FAILED: volunteer export allowed';
 exception when raise_exception then if sqlerrm not like 'FORBIDDEN|%' then raise; end if; end;
 begin
   perform api.call(e,'preview',jsonb_build_object('token',token,'day',1,'mode','dinner'));
   raise exception 'CHECK_FAILED: wrong station allowed';
 exception when raise_exception then if sqlerrm not like 'FORBIDDEN|%' then raise; end if; end;
 p:=api.call(e,'preview',jsonb_build_object('token',token,'day',1,'mode','lunch'));
 p2:=api.call(e,'preview',jsonb_build_object('token',token,'day',1,'mode','lunch'));
 begin
   perform api.call(e,'confirm',jsonb_build_object('previewId',p->>'id','requestId',request_id,'fullTeam',false));
   raise exception 'CHECK_FAILED: meal attestation bypassed';
 exception when raise_exception then if sqlerrm not like 'FULL_TEAM_REQUIRED|%' then raise; end if; end;
 receipt:=api.call(e,'confirm',jsonb_build_object('previewId',p->>'id','requestId',request_id,'fullTeam',true));
 if receipt->>'code'<>'CONFIRMED' then raise exception 'CHECK_FAILED: confirmation'; end if;
 replay:=api.call(e,'confirm',jsonb_build_object('previewId',p->>'id','requestId',request_id,'fullTeam',true));
 if receipt<>replay then raise exception 'CHECK_FAILED: retry changed receipt'; end if;
 replay:=api.call(e,'confirm',jsonb_build_object('previewId',p2->>'id','requestId',gen_random_uuid(),'fullTeam',true));
 if replay->>'code'<>'ALREADY_CONFIRMED' then raise exception 'CHECK_FAILED: duplicate allowed'; end if;
 snapshot:=api.call(e,'snapshot','{}');
 if jsonb_array_length(snapshot->'claims')<>1 or jsonb_array_length(snapshot->'teams'->0->'members')<>0 then
   raise exception 'CHECK_FAILED: scope or duplicate record'; end if;
 perform set_config('request.jwt.claim.sub',current_setting('test.admin'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.admin'),'session_id',current_setting('test.admin_session'),'role','authenticated','aal','aal2')::text,true);
 perform api.call(e,'void',jsonb_build_object('claimId',receipt->'claim'->>'id','reason','Disposable verification correction'));
 replay:=api.call(e,'snapshot','{}');
 if replay->'claims'->0->>'status'<>'voided' then raise exception 'CHECK_FAILED: correction'; end if;
 rotated:=api.call(e,'rotate',jsonb_build_object('teamId',t,'reason','Disposable verification rotation'))#>>'{}';
 if rotated=token then raise exception 'CHECK_FAILED: rotation'; end if;
 begin
   perform api.call(e,'preview',jsonb_build_object('token',token,'day',1,'mode','lunch'));
   raise exception 'CHECK_FAILED: revoked pass accepted';
 exception when raise_exception then if sqlerrm not like 'INVALID_QR|%' then raise; end if; end;
 perform set_config('request.jwt.claims','{}',true);
 begin
   perform api.call(e,'context','{}');
   raise exception 'CHECK_FAILED: session validation bypassed';
 exception when raise_exception then if sqlerrm not like 'SESSION_EXPIRED|%' then raise; end if; end;
end $$;
rollback;
select 'PASS: Vault, private tables, station roles, human confirmation, duplicate protection, idempotent retry, correction, QR rotation, session validation. All fixtures rolled back.' as result;
