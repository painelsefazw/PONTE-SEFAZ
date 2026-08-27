/**
 * Baixa um arquivo que veio do servidor em base64.
 *
 * O conteúdo chega por server function (JSON) porque a chave da API é
 * server-side — um link direto para a API exporia a credencial na barra de
 * endereços. Aqui ele volta a ser arquivo e o navegador salva.
 */
export function salvarArquivo(nome: string, tipo: string, base64: string): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Sem revogar, cada download deixa um blob preso na memória da aba.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
