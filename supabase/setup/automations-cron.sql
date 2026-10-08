-- Run after deploying the automation functions and applying the migration.
-- Enable pg_cron and pg_net in Supabase first. In Vault, create:
-- nina_automation_project_url: https://<project-ref>.supabase.co
-- nina_automation_service_role_key: this project's SUPABASE_SERVICE_ROLE_KEY
-- Never use the public/publishable key or put the service key in the frontend.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'nina_automation_project_url')
    OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'nina_automation_service_role_key') THEN
    RAISE EXCEPTION 'Create both nina_automation_* Vault secrets before scheduling workers';
  END IF;
END $$;

-- Named schedules can be reapplied: cron.schedule updates an existing named job.
SELECT cron.schedule('nina-automation-runner', '* * * * *', $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'nina_automation_project_url') || '/functions/v1/automation-runner',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'nina_automation_service_role_key')),
    body := '{}'::jsonb
  );
$job$);

SELECT cron.schedule('nina-automation-scheduler', '* * * * *', $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'nina_automation_project_url') || '/functions/v1/automation-scheduler',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'nina_automation_service_role_key')),
    body := '{}'::jsonb
  );
$job$);

SELECT cron.schedule('nina-webhook-cleanup', '0 6 * * *', $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'nina_automation_project_url') || '/functions/v1/webhook-cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'nina_automation_service_role_key')),
    body := '{}'::jsonb
  );
$job$);
