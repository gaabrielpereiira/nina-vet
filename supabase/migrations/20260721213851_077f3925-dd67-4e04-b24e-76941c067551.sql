-- Ajustar RLS de deals e appointments para modo single-tenant compartilhado
-- Após remix, as políticas por user_id impedem acesso aos dados compartilhados

-- Deals: substituir política own-deals por acesso compartilhado
DROP POLICY IF EXISTS "Users can manage own deals" ON public.deals;
DROP POLICY IF EXISTS "Allow all operations on deals" ON public.deals;

CREATE POLICY "Authenticated users can access all deals"
ON public.deals
FOR ALL
TO authenticated
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

-- Appointments: substituir política own-appointments por acesso compartilhado
DROP POLICY IF EXISTS "Users can manage own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Allow all operations on appointments" ON public.appointments;

CREATE POLICY "Authenticated users can access all appointments"
ON public.appointments
FOR ALL
TO authenticated
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');
