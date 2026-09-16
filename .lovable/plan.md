# Ficha do lead na aba Contatos

Hoje a aba Contatos só mostra uma tabela: nome, telefone, e-mail e data. Clicar na linha não abre nada e o botão "..." está desativado. Vamos criar a ficha completa do lead.

## O que muda

**Clique na linha (ou no botão "...") abre um painel lateral com:**

- **Dados do tutor** — nome, telefone, e-mail, primeiro contato, última atividade, etiquetas, notas e um selo "VetSoft" quando veio da importação.
- **Pets** — nome, espécie, raça, sexo e data de nascimento de cada animal ligado ao tutor.
- **Histórico de conversa** — últimas mensagens trocadas no WhatsApp, em ordem, com quem enviou (tutor, Nina ou atendente), e um botão "Abrir conversa" que leva para o chat.
- **Agendamentos** — consultas futuras e passadas do tutor, com procedimento e data.

**Ajustes na lista:**

- A tabela hoje carrega no máximo 100 contatos e existem 400 importados — passa a carregar todos, com busca por nome, telefone e e-mail.
- Cada linha ganha a contagem de pets e o selo de origem VetSoft.

## Observações

- Nenhum pet foi gravado ainda (a leitura de animais do VetSoft estava bloqueada na importação): a seção de pets fica com uma mensagem de "nenhum pet cadastrado" até uma importação trazer os animais.
- Os leads importados não têm conversa nem agendamento ainda, então essas seções aparecerão vazias para eles — é o comportamento esperado.

## Detalhes técnicos

- Novo componente `src/components/contacts/ContactDetailPanel.tsx` (painel lateral), aberto por estado local em `Contacts.tsx`.
- Novo hook `src/hooks/useContactDetails.ts` que, para o contato selecionado, busca em paralelo: linha completa de `contacts`, `animals` por `contact_id`, `conversations` + últimas `messages` do contato, e `appointments` (com `procedures` relacionado).
- `api.fetchContacts` passa a devolver os campos extras (`tags`, `notes`, `vetsoft_client_id`, `first_contact_date`) e a remover o `limit(100)`; o tipo `Contact` em `src/types.ts` é estendido com esses campos opcionais.
- Sem alteração de banco: as tabelas e as permissões atuais já cobrem a leitura (contatos são acessíveis para o administrador, animais para usuários autenticados).
