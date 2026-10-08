GRANT SELECT, INSERT, UPDATE ON public.send_queue TO authenticated;
GRANT ALL ON public.send_queue TO service_role;
DROP POLICY IF EXISTS "Staff access send_queue" ON public.send_queue;
CREATE POLICY "Staff access send_queue" ON public.send_queue FOR ALL TO authenticated USING (true) WITH CHECK (true);