import { urlDeDeployNaVercel, VARIAVEIS_DO_BOTAO } from '../../src/webapp/kit-instancia';

/**
 * O link que sobe a ponte numa conta da Vercel qualquer.
 *
 * Ele existe porque a instalacao manual custou seis tentativas numa instalacao
 * real, e todas morreram no mesmo lugar: montar a connection string a mao. A
 * tela que este link abre pergunta as variaveis UMA A UMA, em campos separados,
 * onde nao ha sintaxe para quebrar.
 */
describe('botao de deploy na Vercel', () => {
  const ler = (url: string) => new URL(url).searchParams;

  test('aponta para o clone, que e o fluxo que cria repositorio e projeto', () => {
    const url = urlDeDeployNaVercel({ repositorio: 'painelsefazw/painelsefaz' });
    expect(url.startsWith('https://vercel.com/new/clone?')).toBe(true);
    expect(ler(url).get('repository-url')).toBe('https://github.com/painelsefazw/painelsefaz');
  });

  test('pede as PARTES do banco, e nunca a NFE_DB_URL', () => {
    // A URL montada a mao e o formato que quebrou seis vezes: um espaco vira
    // ENOTFOUND, um simbolo na senha vira "senha errada". Em campo separado a
    // senha vai sozinha e o codigo a codifica.
    const pedidas = ler(urlDeDeployNaVercel({ repositorio: 'dono/repo' })).get('env')!.split(',');
    expect(pedidas).toEqual(VARIAVEIS_DO_BOTAO);
    expect(pedidas).toContain('NFE_DB_PASSWORD');
    expect(pedidas).not.toContain('NFE_DB_URL');
    expect(pedidas).not.toContain('POSTGRES_URL');
  });

  test('pede tambem a senha do painel e a chave que cifra os certificados', () => {
    // Sem as duas a instalacao sobe aberta ou incapaz de guardar certificado —
    // e o operador so descobre quando for cadastrar o primeiro cliente.
    const pedidas = ler(urlDeDeployNaVercel({ repositorio: 'dono/repo' })).get('env')!;
    expect(pedidas).toContain('WEBAPP_SENHA');
    expect(pedidas).toContain('WEBAPP_MASTER_KEY');
  });

  test('a descricao avisa que trocar a MASTER_KEY inutiliza certificado guardado', () => {
    // E o unico campo desta tela cuja troca destroi dado existente.
    const d = ler(urlDeDeployNaVercel({ repositorio: 'dono/repo' })).get('envDescription')!;
    expect(d).toMatch(/ilegiveis|ilegíveis/i);
    expect(d).toMatch(/POOLER/);
  });

  test('aceita a URL do GitHub, com .git ou barra no fim', () => {
    const esperado = 'https://github.com/painelsefazw/painelsefaz';
    for (const entrada of [
      'painelsefazw/painelsefaz',
      'https://github.com/painelsefazw/painelsefaz',
      'https://github.com/painelsefazw/painelsefaz.git',
      'https://github.com/painelsefazw/painelsefaz/',
      '  painelsefazw/painelsefaz  ',
    ]) {
      expect(ler(urlDeDeployNaVercel({ repositorio: entrada })).get('repository-url')).toBe(esperado);
    }
  });

  test('recusa entrada que nao e um repositorio', () => {
    // Link para uma branch ou um arquivo nao clona, e o erro da Vercel seria
    // "repositorio nao encontrado" — que manda procurar no lugar errado.
    for (const ruim of ['', '   ', 'painelsefaz', 'https://github.com/dono/repo/tree/main',
      'https://gitlab.com/dono/repo']) {
      expect(() => urlDeDeployNaVercel({ repositorio: ruim })).toThrow(/invalido/i);
    }
  });

  test('o nome do projeto sai limpo para a Vercel', () => {
    // A Vercel so aceita minuscula, numero e hifen no nome do projeto.
    const p = ler(urlDeDeployNaVercel({ repositorio: 'dono/repo', nome: 'Ponte Fiscal DA Acao!' }));
    expect(p.get('project-name')).toBe('ponte-fiscal-da-acao');
    expect(p.get('repository-name')).toBe('ponte-fiscal-da-acao');
  });

  test('sem nome, usa o do repositorio', () => {
    expect(ler(urlDeDeployNaVercel({ repositorio: 'painelsefazw/painelsefaz' })).get('project-name'))
      .toBe('painelsefaz');
  });

  test('nome que vira vazio depois da limpeza nao produz projeto sem nome', () => {
    expect(ler(urlDeDeployNaVercel({ repositorio: 'dono/repo', nome: '!!!' })).get('project-name'))
      .toBe('ponte-fiscal');
  });

  test('o link de ajuda aponta para o INSTALACAO.md do proprio repositorio', () => {
    // Quem clica esta numa tela da Vercel, sem o painel por perto: a explicacao
    // precisa viajar junto do codigo.
    expect(ler(urlDeDeployNaVercel({ repositorio: 'dono/repo' })).get('envLink'))
      .toBe('https://github.com/dono/repo/blob/main/INSTALACAO.md');
  });
});
