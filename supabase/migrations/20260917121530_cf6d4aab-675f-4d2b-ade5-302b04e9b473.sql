CREATE TABLE public.vetsoft_sync_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  area text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  triggered_by text NOT NULL DEFAULT 'cron',
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  finished_at timestamp with time zone,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  total_count integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.vetsoft_sync_runs TO authenticated;
GRANT ALL ON public.vetsoft_sync_runs TO service_role;

ALTER TABLE public.vetsoft_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read vetsoft sync runs"
ON public.vetsoft_sync_runs
FOR SELECT
TO authenticated
USING (true);

CREATE TRIGGER update_vetsoft_sync_runs_updated_at
BEFORE UPDATE ON public.vetsoft_sync_runs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_vetsoft_sync_runs_area_started ON public.vetsoft_sync_runs (area, started_at DESC);