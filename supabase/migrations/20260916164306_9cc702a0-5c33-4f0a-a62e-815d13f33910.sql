ALTER TABLE public.procedures
  ADD COLUMN IF NOT EXISTS vetsoft_item_id integer,
  ADD COLUMN IF NOT EXISTS vetsoft_item_type text,
  ADD COLUMN IF NOT EXISTS vetsoft_synced_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

CREATE UNIQUE INDEX IF NOT EXISTS procedures_vetsoft_item_unique
  ON public.procedures (vetsoft_item_type, vetsoft_item_id)
  WHERE vetsoft_item_id IS NOT NULL;