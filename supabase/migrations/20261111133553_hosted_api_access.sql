-- Complete hosted Vault permissions for the private application executor.
do $$ begin
  if to_regprocedure('vault._crypto_aead_det_decrypt(bytea,bytea,bigint,bytea,bytea)') is not null then
    grant execute on function vault._crypto_aead_det_decrypt(bytea,bytea,bigint,bytea,bytea) to rih_executor;
  end if;
end $$;

-- Cover foreign keys for roster, schedule and assignment maintenance.
create index staff_auth_user on ops.staff(id);
create index previews_team on ops.previews(event_id,team_id);
create index previews_schedule on ops.previews(event_id,schedule_id);
create index previews_actor on ops.previews(event_id,actor_id);
create index previews_expiry on ops.previews(expires);
create index claims_team on ops.claims(event_id,team_id);
create index claims_schedule on ops.claims(event_id,schedule_id);
create index claims_actor on ops.claims(event_id,actor_id);
create index receipts_claim on ops.receipts(claim_id);

-- Expose only the authenticated RPC wrapper; keep application tables private.
-- The embedded test database does not include PostgREST's authenticator role.
do $$ begin
  if exists (select from pg_roles where rolname='authenticator') then
    alter role authenticator set pgrst.db_schemas = 'api';
  end if;
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
