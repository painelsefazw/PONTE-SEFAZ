import * as fs from 'fs';
import * as path from 'path';
import {
  conferirLogo, conferirTextoPadrao, normalizarPosicao,
  LIMITE_DA_LOGO, LIMITE_DO_TEXTO,
} from '../../src/webapp/danfe-marca';

/** PNGs de 1x1 reais — cabecalho IHDR de verdade, gerado com CRC valido. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';
/** O mesmo PNG, mas RGBA — o formato em que quase toda logo e exportada. */
const PNG_COM_ALFA =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_ENTRELACADO =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAAHncGNIAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';
const PNG_16_BITS =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABEAIAAADA54+dAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';
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
  test('aceita JPG', () => {
    expect(conferirLogo(JPG)).toBeNull();
  });

  test('aceita o prefixo data: que o navegador produz', () => {
    // `FileReader.readAsDataURL` devolve com prefixo. Exigir que a tela o
    // remova e transferir para ela um trabalho que e de uma linha aqui.
    expect(conferirLogo('data:image/jpeg;base64,' + JPG)).toBeNull();
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
    expect(recusa.erro).toMatch(/Use JPG/i);
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

  /**
   * A recusa do PNG — que so a producao ensinou.
   *
   * O runtime PHP da Vercel nao tem `gd`, e nao e configuracao: a extensao nao
   * existe em versao nenhuma do runtime. Dai eu havia deduzido que o problema
   * seriam os tres casos que o FPDF recusa (alfa, 16 bits, entrelacado), e
   * este teste recusava so esses tres. Errado: a biblioteca chama
   * `imagecreatefrompng` para TODO PNG, antes de olhar o conteudo — sem `gd`
   * isso e "Call to undefined function", nao um PNG mal formado.
   *
   * Medido contra o servico no ar: JPG devolve o PDF com a logo dentro; PNG
   * devolve 500, tenha alfa ou nao. Ou seja, um PNG comum passava por este
   * validador e perdia a logo calado — o pior modo de falhar, porque a nota
   * sai autorizada e correta, so que sem ela. Ninguem abre chamado para isso;
   * o cliente so conclui que a plataforma nao faz logo.
   */
  test('recusa PNG — qualquer PNG, porque o servico nao tem gd', () => {
    for (const png of [PNG_1X1, PNG_COM_ALFA, PNG_ENTRELACADO, PNG_16_BITS]) {
      const recusa = conferirLogo(png)!;
      expect(recusa.erro).toMatch(/PNG/);
      expect(recusa.comoResolver).toMatch(/JPG/);
    }
  });

  test('a recusa diz o motivo verdadeiro, que e o `gd` ausente', () => {
    // Sem o motivo, a mensagem vira "use JPG porque sim" — e o proximo a mexer
    // aqui tenta o PNG de novo, achando que era manha do validador.
    expect(conferirLogo(PNG_1X1)!.comoResolver).toMatch(/gd/);
  });

  test('o limite tem folga para uma logo de verdade', () => {
    // 400 KB comporta um JPG de 600x200 com sobra — o objetivo e barrar o
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

/**
 * O texto fixo da empresa.
 *
 * O outro lado do mesmo buraco: a frase que sai em toda nota — dados
 * bancarios, garantia, o aviso que a contabilidade exige — ou era redigitada a
 * cada emissao (e um dia esquecida), ou virava regra dentro do ERP do cliente,
 * que nao e lugar dela.
 */
describe('texto fixo que acompanha a nota', () => {
  test('texto normal passa', () => {
    expect(conferirTextoPadrao('Pagamento via PIX. Garantia de 90 dias.')).toBeNull();
    expect(conferirTextoPadrao('')).toBeNull();
    expect(conferirTextoPadrao(undefined)).toBeNull();
  });

  test('recusa texto acima do limite, citando a rejeicao', () => {
    // infCpl vai ate 5000 no leiaute 4.00 — passar disso e rejeicao 215 na
    // SEFAZ, e a nota nao sai. Barrar aqui e barato; descobrir na emissao nao.
    const recusa = conferirTextoPadrao('x'.repeat(LIMITE_DO_TEXTO + 1))!;
    expect(recusa.erro).toMatch(/limite/i);
    expect(recusa.comoResolver).toMatch(/215/);
  });

  test('o limite deixa espaco para o texto do pedido e o demonstrativo', () => {
    // Os 5000 caracteres nao sao so do texto fixo: dividem-se com o que vem na
    // emissao e com o destaque obrigatorio de IBS/CBS.
    expect(LIMITE_DO_TEXTO).toBeLessThan(5000);
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

  test('o texto fixo entra na nota, nao no PDF', () => {
    // O PDF e desenhado a partir do XML. Um texto injetado so na hora de
    // imprimir sairia no papel e nao no documento fiscal — dois conteudos
    // diferentes para a mesma nota, que e exatamente o que nao pode.
    expect(appTs).toMatch(/comTextoPadraoDoDanfe\(\s*[\r\n]?\s*normalizarInfoAdicionais/);
  });

  test('o texto do pedido vem antes do fixo', () => {
    // O especifico daquela nota vale mais que o recado padrao; invertido, o
    // aviso da nota fica no fim de um paragrafo que ninguem le.
    expect(appTs).toContain('doPedido ? `${doPedido} | ${padrao}` : padrao');
  });

  test('salvar so o texto nao apaga a logo', () => {
    // As duas coisas sao salvas em abas separadas. Se um corpo sem logo
    // limpasse a logo, o cliente so descobriria no DANFE seguinte.
    expect(appTs).toContain('const veioLogo =');
    expect(appTs).toMatch(/logoBase64: logo,/);
  });

  test('configurar a logo nao exige poder emitir', () => {
    // `resolveEmpresa` lanca quando falta certificado ou cadastro fiscal — e o
    // cliente recem-criado, que e quem se quer configurar, e justamente esse.
    expect(appTs).toContain('async function cnpjDosParametros');
    expect(appTs).toMatch(/if \(travado\) return String\(travado\)/);
  });

  test('as duas telas achatam a imagem antes de enviar', () => {
    // Recusar PNG no servidor protege quem chama a API, mas seria uma parede na
    // cara de quem so quer subir a logo da empresa — e a logo da empresa quase
    // sempre E um PNG. As telas convertem para JPEG sobre branco, que e a cor do
    // papel: o usuario nao precisa saber que falta um `gd` do outro lado.
    const painel = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'src', 'webapp', 'public', 'index.html'), 'utf8');
    const plataforma = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'platform-template', 'src', 'routes',
        '_painel.parametros.tsx'), 'utf8');
    for (const tela of [painel, plataforma]) {
      expect(tela).toContain('achatarParaJpeg');
      expect(tela).toMatch(/toDataURL\(['"]image\/jpeg['"]/);
      expect(tela).toMatch(/fillStyle = ['"]#ffffff['"]/);
    }
  });

  test('o health check diz QUAL versao esta no ar', () => {
    // Sem marcador, o health check respondia "ok" tanto para a versao que
    // desenha a logo quanto para a que nao sabe que ela existe — e foi assim
    // que um deploy velho ficou no ar parecendo saudavel. Agora "ja subiu?" e
    // uma pergunta com resposta.
    expect(php).toMatch(/const VERSAO = \d+/);
    expect(php).toMatch(/'versao'\s*=>\s*VERSAO/);
  });

  test('o health check informa allow_url_fopen', () => {
    // Sem `gd`, a biblioteca transforma a logo numa URL `data://` e a le de
    // volta com getimagesize. Com allow_url_fopen desligado ela le `false` e a
    // logo some calada — a mesma falha silenciosa, por outra porta.
    expect(php).toContain('allow_url_fopen');
  });

  test('o JSON so e lido quando o cliente diz que e JSON', () => {
    // Adivinhar pelo primeiro caractere quebraria um XML que comece com espaco
    // ou BOM — e ai a nota nao sai.
    expect(php).toMatch(/CONTENT_TYPE/);
  });
});
