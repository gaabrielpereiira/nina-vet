# Corrigir a importação que veio zerada

O catálogo do VetSoft foi lido com sucesso — 471 serviços e 405 produtos chegaram na resposta. O problema é só no reconhecimento dos campos: o VetSoft nomeia código e nome dos itens como `cod_prod_serv` / `nom_prod_serv`, e a importação estava procurando por `cod_servico` / `nom_servico`. Como nenhum item batia, todos foram descartados e as três abas ficaram em zero.

## O que muda

1. Passar a ler o código e o nome pelos campos reais do VetSoft, mantendo as variantes já previstas como reserva.
2. Preço vem de `val_venda` (preço de venda) e a categoria de `nom_grupo` — já compatíveis, apenas confirmados.
3. Vacinas: o VetSoft não tem lista própria de vacinas (os endereços testados retornam "não encontrado"). Elas ficam dentro de serviços/produtos, então em vez de procurar uma lista separada o item é classificado como Vacina quando o grupo dele menciona vacina. O aviso amarelo "Não foi possível ler do VetSoft: Vacina" sai da tela.
4. Itens inativos no VetSoft (`sit_registro` diferente de 1) deixam de aparecer na importação.
5. Depois do ajuste, abrir a importação e conferir que os números aparecem — a expectativa é algo próximo de 876 itens no total.

## Detalhes técnicos

- `supabase/functions/_shared/vetsoft.ts`:
  - `ID_FIELDS`: incluir `cod_prod_serv` (primeiro da lista).
  - `NAME_FIELDS`: incluir `nom_prod_serv` (primeiro da lista).
  - `normalizeItem`: aplicar `trim` no nome (a API devolve espaços à direita), classificar `type` como `vaccine` quando `nom_grupo` casar com `/vacin/i`, e descartar itens com `sit_registro` presente e diferente de `1`.
  - `CATALOG_CANDIDATES`: remover a chave `vaccine` (sem endpoint próprio); manter `service` (`/services`) e `product` (`/products`).
  - Deduplicar por `cod_prod_serv` considerando que serviços e produtos compartilham a mesma sequência de código — a chave de comparação passa a ser o par (tipo resolvido, código), e a origem (`service`/`product`) é preservada em `source_endpoint` para depuração.
- Redeploy de `vetsoft-import-procedures` e teste do modo `preview` via logs para confirmar as contagens.
