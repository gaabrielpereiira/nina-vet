# Piloto de resposta manual no WhatsApp

A página do tutor mostra um campo de resposta a administradores quando o ambiente
permite uma única conversa de teste. O vínculo vem de uma mensagem recebida pelo
webhook assinado e registrada pelo worker. O teste exige conversa ativa com a
equipe, contato desbloqueado, rota única da conta e perfil configurados e mensagem
recebida nos últimos 23 h 55 min. A margem respeita a janela de 24 h do WhatsApp.

A API reserva a mensagem recebida no PostgreSQL antes de chamar o endpoint de
[resposta do Zernio](https://docs.zernio.com/platforms/whatsapp/inbox). Uma segunda
solicitação para a mesma mensagem lê o estado da primeira. O texto e o identificador
externo do destinatário ficam fora do registro de tentativas. Um retorno ambíguo
exige conferência pelo operador. O webhook de saída continua responsável pelo
histórico e pelas confirmações de entrega.

1. Publicar API e interface com `WHATSAPP_PILOT_ENABLED=false`.
2. Identificar um contato e uma conversa únicos a partir da mensagem de teste do
   participante. Conferir a conta e o perfil no vínculo já registrado.
3. Aplicar `0008_whatsapp_pilot.sql` e `server/sql/whatsapp-pilot-role.sql` como
   proprietário, em uma única transação. O backend exige os grants para ativar.
4. Configurar `WHATSAPP_PILOT_CONTACT_ID` e `WHATSAPP_PILOT_CONVERSATION_ID` com os
   UUIDs validados, habilitar o piloto e publicar somente a API.
5. Entrar como administrador, responder uma vez e conferir a mensagem no aparelho
   de teste e no histórico da Nina. Desligar a flag ao encerrar o piloto.

A revisão de respostas de IA e a autorização de envio a outros contatos são etapas
posteriores. Depois da migração, o retorno seguro usa a versão da API que reconhece
0008, com a flag desligada. Uma versão anterior falha na checagem de esquema.
