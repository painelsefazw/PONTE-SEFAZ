import * as fs from 'fs';
import * as path from 'path';

/**
 * O gerador tem de continuar mandando o padrao inteiro.
 *
 * Toda vez que o template da Alianca aprende alguma coisa, o gerador precisa
 * aprender junto — senao o proximo cliente nasce com os defeitos que este ja
 * corrigiu. Ja aconteceu: IBS/CBS existia no motor havia semanas e nao era
 * mencionado UMA VEZ no texto gerado, entao todo template novo nasceria sem
 * campo nenhum e afirmando tributacao integral em produto de aliquota zero.
 *
 * Este teste nao julga a redacao. Ele so garante que os pontos que custaram
 * caro continuam escritos — cada um aqui e um defeito que aconteceu de verdade
 * e levou uma sessao para ser encontrado.
 */

const APP = path.resolve(__dirname, '../../src/webapp/app.ts');

/** O corpo da funcao que monta o texto entregue ao construtor. */
function promptDoGerador(): string {
  const src = fs.readFileSync(APP, 'utf-8');
  const i = src.indexOf('function gerarLovablePrompt');
  expect(i).toBeGreaterThan(-1);
  const fim = src.indexOf('\n}', i);
  return src.slice(i, fim);
}

const PADRAO: Array<[string, string[]]> = [
  ['IBS/CBS — o motor recusa emissao por causa desses campos', [
    'IBS/CBS', '200014', 'cClassTrib', 'pRedAliq',
  ]],
  ['Aliquota zero nao tem CST proprio', ['CST 200', '100%']],
  ['A obrigatoriedade caiu — nao pode voltar a ser afirmada', ['suspensa', '01/01/2027']],
  ['Suporte no WhatsApp, antes do e-mail', ['WhatsApp', 'wa.me', 'PRIMEIRO', 'noopener']],
  ['Relatorios sao painel ao vivo, com ambiente', ['seletor de AMBIENTE', 'refetch', 'oklch']],
  ['Selo em um componente so, com a cor certa no fundo tingido', [
    'Selos e badges', 'fundo TINGIDO', '-foreground',
  ]],
  ['Login pelo CNPJ do cliente', ['CNPJ do cliente', 'APP_USER']],
  ['Paginas que a Alianca ganhou depois', ['Destinatários', 'regras fiscais']],
  ['A marca do cliente viaja no kit', ['assets.logo']],
  ['Documento cancelado precisa parecer cancelado', ['carimbados na diagonal', 'PDF baixado']],
  ['Carta de correcao, com o que ela NAO corrige', [
    'carta-correcao', 'nSeqEvento', 'NÃO serve', 'COMPLETO',
  ]],
  ['Campos do produto que a maioria esquece', ['origem', 'cstCofins', 'cbenef']],
  ['.env.example e os segredos fora do bundle', ['.env.example', 'VITE_', 'gitignore']],
  ['Padrao e estrutura; a marca e que muda', ['Padrão é a **estrutura**', 'manifest']],
  ['Devolucao: finalidade e nota de origem', ['finalidade', 'chave da nota de', '321']],
  ['Origem no item, com o efeito na aliquota', ['nacional', '4%']],
  ['NFS-e com previa, entrega e endereco', ['E0237', 'compartilhada', 'Entrega na hora']],
];

describe('o texto gerado carrega o padrao inteiro', () => {
  const prompt = promptDoGerador();

  test('o gerador foi encontrado e tem tamanho de especificacao', () => {
    // Se a extracao falhar, os testes abaixo passariam vazios e dariam uma
    // garantia falsa — pior do que nao existir.
    expect(prompt.length).toBeGreaterThan(5_000);
  });

  test.each(PADRAO)('%s', (_titulo, termos) => {
    const faltando = termos.filter(t => !prompt.includes(t));
    expect(faltando).toEqual([]);
  });

  test('o conteudo do modelo COMPLEMENTA o padrao, nunca o substitui', () => {
    // Escolher outro modelo chegou a gerar especificacao diferente — o oposto
    // de todo cliente sair no mesmo padrao. O texto do modelo entra rotulado
    // como complemento, com o padrao vencendo em caso de conflito.
    expect(prompt).toContain('COMPLEMENTA');
    expect(prompt).toContain('o padrão vence');
  });

  test('o conteudo do template escolhido e mesmo interpolado', () => {
    // O parametro `template` era recebido e nunca lido: nem o conteudo PADRAO
    // chegava ao prompt. A especificacao ficava gravada no banco e era
    // descartada na hora de usar.
    expect(prompt).toMatch(/\$\{template\??\.content/);
  });

  test('nao promete rejeicao 1115 nem obrigatoriedade que nao existe mais', () => {
    // A frase "sem esse grupo a SEFAZ rejeita com 1115" ficou falsa em agosto
    // de 2026. Reintroduzi-la faria todo template novo mentir na interface.
    const proibidos = [
      'rejeita com cStat 1115',
      'obrigatorio desde 03/08/2026',
      'destaque na nota e obrigatorio',
    ];
    expect(proibidos.filter(p => prompt.includes(p))).toEqual([]);
  });
});
