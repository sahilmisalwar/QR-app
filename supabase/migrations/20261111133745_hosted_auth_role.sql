-- Supabase protects the auth schema from direct grants by postgres.
-- Inherit its standard authenticated role for schema usage. This direction
-- does NOT grant any application privileges to browser users.
grant authenticated to rih_executor;
