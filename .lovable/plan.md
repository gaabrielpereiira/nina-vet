## Aplicar identidade visual Vet+

Trocar a paleta atual (ciano/roxo escuro) pela paleta Vet+ e substituir o logo/favicon pelo enviado.

### Paleta
- `#6CC8C0` — cor primária (turquesa suave)
- `#D8E6E6` — accent/secundária (azul-esverdeado claro)
- `#EEE7CA` — destaque quente (bege)
- `#F3F3F3` — neutro claro
- Preto/carvão para contraste do logo

### Decisão de tema
Manter o app em **dark mode** (como está hoje), usando `#6CC8C0` como primário sobre fundo escuro, e `#EEE7CA` como accent quente para ícones/badges. Isso preserva toda a UI existente (sidebar, cards, gradientes) sem quebrar contraste. Se preferir migrar para tema claro usando `#F3F3F3` como background, me avise antes de eu implementar.

### Mudanças

1. **`src/index.css`**
   - Reescrever tokens HSL de `:root` e `.dark`:
     - `--primary`: HSL de `#6CC8C0`
     - `--accent`: HSL de `#EEE7CA` (destaque quente) — substitui o roxo
     - `--ring`: igual ao primary
     - `--sidebar-primary` / `--sidebar-ring`: novo primary
   - Ajustar cor da scrollbar para tom neutro compatível.

2. **Logo Vet+**
   - Subir `WhatsApp_Image_2023-05-23_at_11.51.30.jpeg` via `lovable-assets` como `src/assets/logo-vetmais.png.asset.json` (converter em PNG com fundo transparente não é possível sem edição; usaremos a imagem como está).
   - Substituir em `src/components/Sidebar.tsx`:
     - `viaIcon` → novo logo Vet+ (dentro do container gradiente atual)
     - `viaLogoWhite` (rodapé) → mesmo logo Vet+ em opacidade reduzida
   - Substituir em `src/pages/Auth.tsx` o `src/assets/icon-via.png` pelo novo logo.

3. **Favicon**
   - Copiar o logo para `public/favicon.png` e garantir `<link rel="icon" href="/favicon.png" type="image/png">` no `index.html` (já está). Remover `public/favicon.ico` se existir.

4. **Título do app**
   - `index.html`: `<title>Vet+ | Assistente IA</title>` e ajustar `<meta name="description">` para clínica veterinária.
   - `metadata.json`: atualizar `name` e `description` para Vet+.

### Fora de escopo
- Nenhuma mudança em lógica de negócio, hooks ou edge functions.
- Não vou migrar para tema claro nesta rodada (posso fazer depois se quiser).

### Detalhes técnicos
- Conversões HSL aproximadas:
  - `#6CC8C0` → `174 45% 60%`
  - `#D8E6E6` → `180 20% 87%`
  - `#EEE7CA` → `48 55% 86%`
  - `#F3F3F3` → `0 0% 95%`
- `--primary-foreground` fica escuro (`222 84% 5%`) para contraste sobre o turquesa claro.