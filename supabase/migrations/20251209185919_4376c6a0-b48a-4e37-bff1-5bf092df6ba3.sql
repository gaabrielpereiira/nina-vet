-- Primeiro, remover duplicatas mantendo apenas o registro mais recente por user_id
DELETE FROM nina_settings a
USING nina_settings b
WHERE a.user_id = b.user_id 
  AND a.user_id IS NOT NULL
  AND a.created_at < b.created_at;

-- Adicionar constraint UNIQUE na coluna user_id
ALTER TABLE nina_settings 
ADD CONSTRAINT nina_settings_user_id_unique UNIQUE (user_id);