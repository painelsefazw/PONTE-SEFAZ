import { cfopDeCadastro } from '../../src/webapp/app';

/**
 * Campo de CFOP de SAIDA nao guarda CFOP de entrada.
 *
 * Isto veio de uma pergunta simples: o operador olhou a tela e viu CFOP 1102
 * numa venda. O motor ja corrigia — `corrigirSentidoCfop` troca o primeiro
 * digito antes de montar o XML, e a nota saia com 5102. Justamente por isso o
 * defeito era invisivel: a nota nascia certa e o CADASTRO ficava errado para
 * sempre, mostrando um CFOP que nunca era o que ia na nota.
 *
 * Corrige e conta, em vez de recusar: catalogo importado de outro sistema chega
 * torto com frequencia, e travar a importacao inteira por causa do primeiro
 * digito seria pior. O que nao pode e a correcao ser muda.
 */

describe('CFOP de cadastro vem sempre no sentido de saida', () => {
  test('1102 (compra para comercializacao) vira 5102 (venda)', () => {
    // O caso real: banana cadastrada com o CFOP da compra.
    expect(cfopDeCadastro('1102')).toEqual({
      cfop: '5102',
      ajuste: { de: '1102', para: '5102' },
    });
  });

  test('a natureza da operacao nao se perde — so o sentido muda', () => {
    // Os tres ultimos digitos sao decisao de quem cadastrou; nao se mexe neles.
    expect(cfopDeCadastro('1556').cfop).toBe('5556');
    expect(cfopDeCadastro('1949').cfop).toBe('5949');
  });

  test('entrada interestadual vira saida interestadual, nao interna', () => {
    // 2xxx -> 6xxx. Mandar tudo para 5xxx apagaria a informacao de que a
    // operacao cruza a fronteira do estado.
    expect(cfopDeCadastro('2102')).toEqual({
      cfop: '6102',
      ajuste: { de: '2102', para: '6102' },
    });
  });

  test('importacao vira exportacao, que e a saida correspondente', () => {
    expect(cfopDeCadastro('3102').cfop).toBe('7102');
  });

  test('CFOP que ja e de saida passa intacto e sem ajuste', () => {
    // Sem `ajuste` a resposta nao mostra aviso nenhum — corrigir o que ja esta
    // certo poluiria a tela em todo salvamento.
    expect(cfopDeCadastro('5102')).toEqual({ cfop: '5102' });
    expect(cfopDeCadastro('6102')).toEqual({ cfop: '6102' });
    expect(cfopDeCadastro('7102')).toEqual({ cfop: '7102' });
  });

  test('lixo nao vira CFOP inventado', () => {
    // Campo vazio ou malformado e assunto da validacao de schema, que tem
    // mensagem propria. Completar aqui esconderia o erro de quem digitou.
    expect(cfopDeCadastro('')).toEqual({ cfop: '' });
    expect(cfopDeCadastro(undefined)).toEqual({ cfop: '' });
    expect(cfopDeCadastro('11')).toEqual({ cfop: '11' });
    expect(cfopDeCadastro('9102')).toEqual({ cfop: '9102' });
  });

  test('separador nao atrapalha', () => {
    expect(cfopDeCadastro('1.102').cfop).toBe('5102');
  });
});
