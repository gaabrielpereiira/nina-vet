// Quando a IA estoura o limite de tokens (finish_reason = 'length') a resposta chega cortada
// no meio de uma frase. Em vez de mandar meia frase pro tutor, volta até a última frase completa.
// O terminador só vale se vier seguido de espaço/fim de texto, pra não cortar no meio de "R$ 1.500".
export function trimToCompleteSentence(text: string): string {
  const trimmed = (text || '').trimEnd();
  const match = trimmed.match(/^[\s\S]*[.!?…](?:["')\]”]|\s*\p{Extended_Pictographic}[️‍]*)*(?=\s|$)/u);
  return match ? match[0].trimEnd() : trimmed;
}
