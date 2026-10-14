import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEdge } from './support/edge-harness.mjs';

const { context } = loadEdge('_shared/ai-text.ts');
const trim = (text) => context.trimToCompleteSentence(text);

test('mensagem cortada no meio da frase volta até a última frase completa', () => {
  assert.equal(
    trim('A castração é um passo importante para a saúde dele. Como o valor da cirurgia varia bastante de acordo com o peso, sexo'),
    'A castração é um passo importante para a saúde dele.',
  );
});

test('mensagem já completa não é alterada', () => {
  assert.equal(trim('Posso agendar para amanhã às 14h? 😊'), 'Posso agendar para amanhã às 14h? 😊');
});

test('não corta no ponto decimal de um valor em reais', () => {
  assert.equal(trim('Fechado! O valor é R$ 1.500, mais'), 'Fechado!');
});

test('sem nenhum fim de frase devolve o texto como está', () => {
  assert.equal(trim('Oi, tudo bem'), 'Oi, tudo bem');
});

test('preserva emoji e parêntese colados ao ponto final', () => {
  assert.equal(trim('Tudo certo! 💙 E sobre o horário, a'), 'Tudo certo! 💙');
});
