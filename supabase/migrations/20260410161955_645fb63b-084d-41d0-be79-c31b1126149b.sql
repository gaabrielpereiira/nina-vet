
CREATE TABLE public.system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read system_settings"
ON public.system_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert system_settings"
ON public.system_settings FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update system_settings"
ON public.system_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Public can read system_settings"
ON public.system_settings FOR SELECT TO anon USING (true);

CREATE TRIGGER update_system_settings_updated_at
BEFORE UPDATE ON public.system_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
