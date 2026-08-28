import * as fs from 'fs';
import * as path from 'path';

/**
 * O painel do contador responde por EMPRESA, não em média.
 *
 * Ele era uma tabela: nome, CNPJ, UF, CRT, ambiente, certificado, notas,
 * valor. Cabia numa tela e não respondia nada. "2 notas" e "R$ 0,00" não
 * dizem se a empresa está emitindo, se o certificado vence semana que vem, ou
 * se faz um mês que ninguém emite nada por ali — e são essas três que fazem o
 * telefone tocar.
 *
 * Cada empresa virou um cartão, com o que ela TEM de um lado e o que se FAZ
 * com ela do outro. A separação é deliberada: um lado se lê, o outro se
 * clica, e misturados obrigam a procurar o botão no meio do número.
 */

const painel = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'public', 'index.html'), 'utf8');

describe('painel do contador, um cartao por empresa', () => {
  test('cada empresa e um cartao, e da para filtrar', () => {
    expect(painel).toContain('id="dashEmpresasCards"');
    expect(painel).toContain('function cartaoDaEmpresa(');
    expect(painel).toContain('id="dashBuscaEmpresa"');
    // O filtro redesenha do que ja esta em memoria: procurar empresa nao
    // deveria custar uma ida a rede a cada tecla.
    expect(painel).toContain('function filtrarCartoesDeEmpresa()');
    expect(painel).toContain('_dashEmpresas');
  });

  test('estatistica e controle sao blocos separados no cartao', () => {
    const fn = painel.slice(painel.indexOf('function cartaoDaEmpresa('));
    const corpo = fn.slice(0, fn.indexOf('\n}'));
    for (const numero of ['Autorizadas', 'Canceladas', 'Valor emitido', 'Última emissão']) {
      expect(corpo).toContain(numero);
    }
    for (const acao of ['verNotasDaEmpresa', 'exportarXmlsDaEmpresa', 'abrirEmpresa']) {
      expect(corpo).toContain(acao);
    }
    // As acoes vem DEPOIS dos numeros, com uma divisoria entre os dois.
    expect(corpo.indexOf('verNotasDaEmpresa')).toBeGreaterThan(corpo.indexOf('Autorizadas'));
    expect(corpo).toContain('border-top: 1px dashed var(--borda)'.replace(/: /g, ':'));
  });

  test('nada de `undefined` na tela quando o dado falta', () => {
    // O print que motivou isto mostrava "CRT undefined" e "undefined dias".
    // Dado que falta e uma informacao — "regime não informado", "Nunca" — e
    // nao um vazamento do nome da variavel.
    expect(painel).toContain('function regimeDaEmpresa(');
    expect(painel).toContain("return 'Regime não informado'");
    const cert = painel.slice(painel.indexOf('function estadoDoCertificado('));
    expect(cert.slice(0, 900)).toContain("if (!cert) return { texto: 'Sem certificado'");
    expect(cert.slice(0, 900)).toContain('isFinite(dias)');
  });

  test('o certificado aparece com prazo e com cor', () => {
    // Certificado vencido nao avisa: a empresa simplesmente para de emitir, e
    // quem descobre primeiro e o cliente dela no balcao.
    const cert = painel.slice(painel.indexOf('function estadoDoCertificado('));
    const corpo = cert.slice(0, 1000);
    expect(corpo).toContain("tom: 'perigo'");
    expect(corpo).toContain("tom: 'alerta'");
    expect(corpo).toContain("tom: 'sucesso'");
    expect(corpo).toMatch(/dias <= 30/);
  });

  test('exportar XML do cartao exporta a empresa DAQUELE cartao', () => {
    // O botao esta ao lado do nome de uma empresa especifica. Exportar a de
    // outra — a que estivesse selecionada no topo — seria mentira.
    const fn = painel.slice(painel.indexOf('function exportarXmlsDaEmpresa('));
    const corpo = fn.slice(0, fn.indexOf('\n}'));
    expect(corpo).toContain("getElementById('empresaSel')");
    expect(corpo).toContain('onEmpresaChange');
    expect(corpo).toContain('exportarXmls()');
  });

  test('as acoes do conjunto tem titulo proprio', () => {
    // "Limpar notas de homologação" apaga nota. Flutuando numa faixa sem
    // titulo, parecia um botao qualquer.
    expect(painel).toContain('Ações de todas as empresas');
    const secao = painel.slice(painel.indexOf('Ações de todas as empresas'));
    expect(secao.slice(0, 1200)).toContain('não têm valor');
  });
});
