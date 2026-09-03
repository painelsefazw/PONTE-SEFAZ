import * as fs from 'fs';
import * as path from 'path';

/**
 * A cota e POR SERVICO, e a mensagem de esgotamento tem que ser acionavel.
 *
 * Com um teto unico, quem vende produto de manha ficava sem emitir a nota de
 * servico da tarde — e a mensagem dizia "Limite de uso atingido. Faca upgrade
 * do plano", sem dizer QUAL documento acabou nem para onde ir.
 *
 * Quem recebe esse erro esta com uma venda parada. Precisa de tres coisas na
 * mesma frase: qual documento acabou (os outros continuam livres), quanto
 * emitiu, e o que existe acima do plano atual.
 */

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...p: string[]) => fs.readFileSync(path.resolve(raiz, ...p), 'utf8').replace(/\r\n/g, '\n');

const app = ler('src', 'webapp', 'app.ts');
const billing = ler('src', 'webapp', 'billing.ts');

const resposta = (() => {
  const i = app.indexOf('function respostaDeCotaEsgotada(');
  return app.slice(i, app.indexOf('\n}', i));
})();

describe('cota por servico', () => {
  test('a contagem tem uma coluna por documento', () => {
    // Um total unico nao consegue dizer qual servico acabou. A migracao roda no
    // `init` porque instalacao nenhuma tem psql a mao.
    expect(billing).toContain('ADD COLUMN IF NOT EXISTS ${coluna} INTEGER NOT NULL DEFAULT 0');
    expect(billing).toContain("nfe: 'notas_nfe', nfce: 'notas_nfce', nfse: 'notas_nfse'");
  });

  test('o virar do mes zera TODAS as colunas', () => {
    // Deixar uma para tras faria o cliente entrar no mes novo ja no limite de
    // um documento so — e so daquele, o que e ainda mais dificil de entender.
    const fn = billing.slice(billing.indexOf('async obterOuCriar('));
    expect(fn.slice(0, 2000)).toMatch(/notas_mes = 0, notas_nfe = 0, notas_nfce = 0,\s*\n?\s*notas_nfse = 0/);
  });

  test('estourar um servico nao para os outros', () => {
    // A comparacao e contra o contador DAQUELE documento, nao contra o total.
    const fn = billing.slice(billing.indexOf('async incrementarUso('));
    const corpo = fn.slice(0, fn.indexOf('\n  }'));
    expect(corpo).toContain('billing.porServico[documento]');
    expect(corpo).toContain('usadoNoServico >= plano.limitePorServico');
  });

  test('os tres documentos consomem cotas separadas', () => {
    for (const doc of ['nfe', 'nfce', 'nfse']) {
      expect(app).toContain(`verificarBilling(emp.cnpj, '${doc}')`);
    }
  });

  test('a mensagem diz QUAL documento acabou', () => {
    expect(resposta).toContain('NOME_DO_DOCUMENTO');
    expect(resposta).toContain('Limite de ${doc} atingido no plano');
    // E avisa que o resto continua funcionando — o pior mal-entendido aqui e o
    // cliente achar que o sistema inteiro parou.
    expect(resposta).toContain('continuam liberados');
  });

  test('a mensagem lista os planos ACIMA do atual', () => {
    expect(resposta).toContain('planosDisponiveis');
    expect(resposta).toContain('p.limitePorServico > atual.limitePorServico');
    // Sem teto entra sempre: `0` nao e maior que numero nenhum.
    expect(resposta).toContain('p.limitePorServico === 0');
    // E o plano atual sai da lista: oferecer o que ele ja tem e ruido.
    expect(resposta).toContain('p.id !== atual.id');
  });

  test('a mensagem manda falar com o suporte, e nao cita preco', () => {
    expect(resposta).toContain('suporte');
    for (const proibido of ['R$', 'preco', 'preço', 'mensalidade']) {
      expect(resposta).not.toContain(proibido);
    }
  });

  test('previa NAO consome cota', () => {
    // `verificarBilling` INCREMENTA. Cobrar pelo ensaio faria a conta fechar
    // com um numero que o historico nao explica.
    expect(app).toMatch(/if \(ambiente === '1' && !simulando\) \{\s*\n\s*const billing = await verificarBilling/);
  });
});
