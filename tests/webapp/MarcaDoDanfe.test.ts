import * as fs from 'fs';
import * as path from 'path';
import { conferirLogo, normalizarPosicao, LIMITE_DA_LOGO } from '../../src/webapp/danfe-marca';

/** Um PNG de 1x1 — bytes reais, com a assinatura que a biblioteca procura. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** Um JPEG minimo — basta comecar com FF D8 FF para o teste de formato. */
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]).toString('base64');

/**
 * A logomarca do DANFE.
 *
 * O quadro do emitente tem espaco para ela desde sempre e a biblioteca sabe
 * desenha-la; o que faltava era de onde tirar a imagem, porque o XML da NF-e
 * nao carrega figura. Toda nota de todo cliente saia com o espaco vazio —
 * justamente no documento que o cliente entrega ao cliente dele.
 */
describe('conferir a logo antes de guardar', () => {
  test('aceita PNG e JPG', () => {
    expect(conferirLogo(PNG_1X1)).toBeNull();
    expect(conferirLogo(JPG)).toBeNull();
  });

  test('aceita o prefixo data: que o navegador produz', () => {
    // `FileReader.readAsDataURL` devolve com prefixo. Exigir que a tela o
    // remova e transferir para ela um trabalho que e de uma linha aqui.
    expect(conferirLogo('data:image/png;base64,' + PNG_1X1)).toBeNull();
  });

  test('recusa vazio', () => {
    expect(conferirLogo('')!.erro).toMatch(/Nenhuma imagem/i);
    expect(conferirLogo('   ')!.erro).toBeTruthy();
  });

  test('recusa o que nao e base64', () => {
    expect(conferirLogo('isto nao e base64!!')!.erro).toMatch(/base64/i);
  });

  test('recusa SVG e WEBP, dizendo o porque', () => {
    // Nao e capricho: a biblioteca do DANFE nao desenha esses formatos, e o
    // erro que ela devolve fala de recurso de imagem, sem citar a logo.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64');
    const recusa = conferirLogo(svg)!;
    expect(recusa.erro).toMatch(/PNG ou JPG/i);
    expect(recusa.comoResolver).toMatch(/SVG/);
  });

  test('recusa imagem grande, explicando o custo', () => {
    // A logo viaja junto do XML em TODA geracao de DANFE: uma imagem de 3 MB
    // transforma cada download de nota numa transferencia de 3 MB.
    const grande = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      Buffer.alloc(LIMITE_DA_LOGO + 1),
    ]).toString('base64');
    const recusa = conferirLogo(grande)!;
    expect(recusa.erro).toMatch(/limite/i);
    expect(recusa.comoResolver).toMatch(/600x200|600×200/);
  });

  test('o limite tem folga para uma logo de verdade', () => {
    // 400 KB comporta um PNG de 600x200 com sobra — o objetivo e barrar o
    // arquivo de camera, nao a logo caprichada.
    expect(LIMITE_DA_LOGO).toBeGreaterThanOrEqual(200 * 1024);
  });
});

describe('posicao da logo no quadro', () => {
  test('aceita as tres que a biblioteca entende', () => {
    expect(normalizarPosicao('L')).toBe('L');
    expect(normalizarPosicao('c')).toBe('C');
    expect(normalizarPosicao(' r ')).toBe('R');
  });

  test('qualquer outra coisa vira esquerda, em vez de quebrar o PDF', () => {
    // A biblioteca recebe esse valor direto. Um 'X' ali produz um PDF torto,
    // que so aparece quando alguem abre a nota.
    for (const ruim of ['X', '', null, undefined, 42, 'esquerda']) {
      expect(normalizarPosicao(ruim as unknown)).toBe('L');
    }
  });
});

describe('o caminho ate o PDF', () => {
  const appTs = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'webapp', 'app.ts'), 'utf8');
  const wrapper = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'danfe-service', 'DanfePhpService.ts'), 'utf8');
  const php = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'danfe-service', 'api', 'index.php'), 'utf8');

  test('a logo sai do CNPJ que ja esta na nota, sem parametro novo', () => {
    // Fosse parametro, seriam quatro pontos de chamada para lembrar de
    // preencher — e o esquecido geraria DANFE sem logo em silencio, que e
    // exatamente o defeito que isto veio corrigir.
    expect(appTs).toMatch(/opts\.nfe\?\.emit\?\.CNPJ/);
  });

  test('falha ao buscar a logo NAO derruba a nota', () => {
    // Logo e enfeite do documento. Derrubar a emissao porque a decoracao nao
    // carregou troca um problema pequeno por um grande.
    const trecho = appTs.slice(appTs.indexOf('async function gerarDanfePdf'), appTs.indexOf('async function gerarDanfePdf') + 2200);
    expect(trecho).toMatch(/catch \{[^}]*nao vale derrubar a nota/);
  });

  test('sem logo, o corpo continua sendo XML cru', () => {
    // O servico de DANFE roda num deploy separado, que pode estar numa versao
    // anterior. Mandar sempre JSON quebraria toda a emissao ate ele subir.
    expect(wrapper).toContain("comLogo ? 'application/json' : 'application/xml'");
  });

  test('o servico PHP aceita as duas formas', () => {
    expect(php).toContain("strpos($tipo, 'application/json')");
    expect(php).toContain('logoParameters');
  });

  test('o PHP apaga o arquivo temporario da logo', () => {
    // Sem isso, cada nota emitida deixa um arquivo para tras no container.
    expect(php).toContain('finally');
    expect(php).toContain('@unlink($arquivoDaLogo)');
  });

  test('o JSON so e lido quando o cliente diz que e JSON', () => {
    // Adivinhar pelo primeiro caractere quebraria um XML que comece com espaco
    // ou BOM — e ai a nota nao sai.
    expect(php).toMatch(/CONTENT_TYPE/);
  });
});
