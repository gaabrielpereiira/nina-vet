CREATE POLICY "Authenticated insert chat media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'audio-messages');

CREATE POLICY "Authenticated update chat media"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'audio-messages')
WITH CHECK (bucket_id = 'audio-messages');

CREATE POLICY "Authenticated delete chat media"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'audio-messages');

CREATE POLICY "Public read chat media"
ON storage.objects FOR SELECT TO anon
USING (bucket_id = 'audio-messages');

CREATE POLICY "Service role manage chat media"
ON storage.objects FOR ALL TO service_role
USING (bucket_id = 'audio-messages')
WITH CHECK (bucket_id = 'audio-messages');