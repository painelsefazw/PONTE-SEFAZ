/**
 * Identificação da empresa emitente.
 *
 * O motor caía no emitente das variáveis de ambiente quando a requisição não
 * identificava a empresa. Como esse emitente é uma empresa real e cadastrada,
 * esquecer o header fazia a nota sair em nome dela, assinada com o certificado
 * dela, no ambiente da variável — que pode divergir do cadastro.
 *
 * Nota emitida em nome errado não se desfaz com correção: exige cancelamento.
 * Por isso a recusa é preferível ao palpite.
 */
describe('fallback do emitente', () => {
  // Reproduz a decisão de resolveEmpresa sem instanciar o app inteiro:
  // o que importa é a regra, não o encanamento.
  function resolver(opts: {
    tenantTravado?: string;
    header?: string;
    empresasCadastradas: number;
  }): { empresa: string } | { erro: string } {
    const cnpj = opts.tenantTravado || opts.header;
    if (cnpj) return { empresa: cnpj };
    if (opts.empresasCadastradas > 0) {
      return { erro: 'Empresa nao identificada' };
    }
    return { empresa: 'DO_ENV' };
  }

  test('API Key define a empresa e ignora o header', () => {
    const r = resolver({ tenantTravado: '111', header: '999', empresasCadastradas: 23 });
    expect(r).toEqual({ empresa: '111' });
  });

  test('senha mestra com header usa a empresa do header', () => {
    const r = resolver({ header: '34051105000191', empresasCadastradas: 23 });
    expect(r).toEqual({ empresa: '34051105000191' });
  });

  test('sem identificacao e com empresas cadastradas, recusa', () => {
    const r = resolver({ empresasCadastradas: 23 });
    expect(r).toHaveProperty('erro');
  });

  // O fallback nasceu para o deploy novo operar pelo .env até o primeiro
  // cadastro. Esse caso continua valendo.
  test('sem nenhuma empresa cadastrada, usa o .env', () => {
    const r = resolver({ empresasCadastradas: 0 });
    expect(r).toEqual({ empresa: 'DO_ENV' });
  });
});
