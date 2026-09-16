# Trazer os pets de cada tutor do VetSoft

## O que está acontecendo

A busca no VetSoft está funcionando: a última tentativa leu 1000 fichas de animais. Nenhuma foi salva porque o sistema procura o código do tutor num campo que não existe nessa lista — no VetSoft o tutor vem dentro de uma lista "tutores" dentro da ficha do animal. Sem o tutor identificado, todos os pets são descartados como "sem tutor".

Também vi que raça e espécie vêm dentro de um bloco separado da ficha, e o indicador de ativo/inativo do animal é diferente do usado hoje.

Hoje: 400 tutores importados, 0 pets.

## O que vou corrigir

1. Ler o tutor do animal a partir da lista de tutores da própria ficha (e dos formatos alternativos, por segurança).
2. Ler corretamente nome da raça e da espécie, sexo e data de nascimento.
3. Considerar ativo/inativo pelo campo correto, sem descartar fichas válidas.
4. Garantir que a busca percorra todas as páginas de animais, não pare nas primeiras 1000.
5. Ao final, mostrar quantos pets entraram, quantos foram atualizados e quantos pertencem a tutores que ainda não estão no sistema.

Depois disso, o botão "Importar pets" na tela de Contatos traz os animais e os nomes aparecem na ficha de cada tutor e no contador de pets da lista.

## Detalhes técnicos

- `supabase/functions/_shared/vetsoft.ts` → `normalizeAnimalRow`: extrair `client_external_id` de `tutores[0].cod_cliente` (com fallback para campos diretos), raça de `raça.nom_raca`, espécie via `raça.cod_especie`/nome de espécie quando disponível, sexo de `des_sexo` ("Macho"/"Fêmea" → M/F), filtro por `is_ativo` em vez de `sit_registro`.
- `fetchAllPages` para `/animals`: revisar a regra de parada para não interromper a paginação quando o VetSoft devolve páginas cheias.
- Rodar o modo `pets` de `vetsoft-import-clients`, conferir logs e validar com uma consulta em `animals` e no contador de pets da tela de Contatos.
- Sem alterações de banco.
