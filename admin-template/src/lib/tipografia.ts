/**
 * O padrão de caixa alta desta interface, em um lugar só.
 *
 * A regra do produto é: todo rótulo curto de identificação — título de página,
 * item de menu, label de campo, botão, aba, cabeçalho de tabela, badge, status
 * — aparece em CAIXA ALTA. Texto que se lê como frase (ajuda, explicação,
 * mensagem de erro, parágrafo) permanece em escrita normal, porque caixa alta
 * em frase longa cansa e derruba a velocidade de leitura.
 *
 * Por que uma constante e não `text-transform` espalhado pelas telas:
 *
 * - **Acento sobrevive.** A transformação é do CSS, não do texto. O código
 *   continua com "Visão geral" e a tela mostra "VISÃO GERAL" — com o til. Se
 *   as strings fossem escritas em maiúscula na mão, mais cedo ou mais tarde
 *   alguém digitaria "VISAO" e o acento sumiria da interface para sempre.
 * - **Um lugar para mudar de ideia.** Se um dia o padrão virar outro, muda
 *   aqui e a interface inteira acompanha.
 * - **Sem briga de especificidade.** São utilitários do Tailwind, na mesma
 *   camada de tudo o mais; uma classe local ainda sobrepõe quando precisar.
 *
 * O peso e o espaçamento não são enfeite: maiúscula sem `letter-spacing`
 * empasta as letras, e 0.03em é o suficiente para arejar sem soletrar.
 */
export const CAPS = "uppercase tracking-[0.03em] font-semibold";

/**
 * A mesma caixa alta para texto pequeno de apoio (rodapé de card, legenda de
 * indicador), onde o peso cheio pesaria demais.
 */
export const CAPS_SUAVE = "uppercase tracking-[0.04em] font-medium";

/**
 * A saída da caixa alta, para o que não pode ser maiúsculo.
 *
 * "NF-e", "NFS-e" e "NFC-e" são os nomes oficiais dos documentos, e a norma os
 * escreve exatamente assim — com o "e" minúsculo. Passados pela regra geral
 * viram "NF-E", que não é o nome de nada. O mesmo vale para qualquer marca ou
 * identificador técnico que apareça dentro de um botão, aba ou rótulo.
 *
 * `tracking-normal` também volta: o espaçamento existe para arejar maiúscula,
 * e em texto normal ele só afasta as letras sem motivo.
 */
export const SEM_CAPS = "normal-case tracking-normal";
