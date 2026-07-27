## Promover usuário a admin

Vou executar via ferramenta de insert:

```sql
INSERT INTO public.user_roles (user_id, role)
VALUES ('b45dd8ac-f056-4735-81a9-396c797e7db3', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

DELETE FROM public.user_roles
WHERE user_id = 'b45dd8ac-f056-4735-81a9-396c797e7db3'
  AND role = 'user';
```

Depois disso, recarregue a página — o salvamento das configurações do agente vai funcionar (RLS de `nina_settings` exige `admin`).

Não vou mexer no admin antigo herdado do remix nem alterar RLS.