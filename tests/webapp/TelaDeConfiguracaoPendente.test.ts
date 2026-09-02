import * as fs from 'fs';
import * as path from 'path';

/**
 * Quem abre esta tela esta configurando o servidor — mostre TUDO.
 *
 * A tela listava duas variaveis obrigatorias e dobrava as outras tres atras de
 * um "estas voce nao precisa cadastrar". Quem esta configurando um servidor nao
 * quer saber o que e dispensavel: quer saber o que existe e o que cada uma faz
 * quando fica em branco.
 *
 * A que mais custou foi a `FISCAL_API_URL`. O texto dizia "usa o endereco
 * padrao" sem dizer QUAL, e o padrao era um dominio cravado no codigo: a
 * plataforma de um cliente cadastrado numa instalacao foi bater noutra, e a
 * resposta foi um 401 identico ao de chave revogada. Horas de caca por uma
 * frase que escondia o unico dado que importava.
 */

const raiz = path.resolve(__dirname, '..', '..', 'platform-template', 'src');
const ler = (...p: string[]) => fs.readFileSync(path.resolve(raiz, ...p), 'utf8').replace(/\r\n/g, '\n');

const tela = ler('routes', 'index.tsx');
const config = ler('lib', 'config.ts');

describe('tela de configuracao pendente', () => {
  test('as opcionais aparecem SEM precisar abrir nada', () => {
    // `<details>` fechado e o mesmo que nao mostrar, para quem esta com um
    // erro na mao e procurando o que falta.
    const bloco = tela.slice(tela.indexOf('VARIAVEIS_OPCIONAIS'));
    expect(tela).not.toContain('<details');
    expect(tela).not.toContain('Estas você não precisa cadastrar');
    expect(bloco.length).toBeGreaterThan(0);
  });

  test('cada opcional diz o que vale em branco', () => {
    expect(tela).toContain('Em branco vale:');
    expect(tela).toContain('{v.padrao}');
    // E o valor sai do manifest, nao de um texto escrito a mao que envelhece.
    expect(config).toContain('manifest.api?.baseUrl');
  });

  test('o endereco da ponte aparece ESCRITO, e nao como "o padrao"', () => {
    // Este e o campo que custou a tarde: saber para onde as notas vao antes de
    // emitir a primeira.
    // Sem os comentarios: o comentario da entrada CITA a frase antiga para
    // explicar por que ela saiu, e o teste acusaria a propria documentacao do
    // conserto. Ja aconteceu duas vezes hoje.
    const i = config.indexOf('nome: "FISCAL_API_URL"');
    const bloco = config.slice(i, config.indexOf('\n  },', i)).replace(/\/\/[^\n]*/g, '');
    expect(bloco).toContain('padrao:');
    expect(bloco).not.toContain('usa o endereco padrao');
    // Sem manifest, diz que NAO ha padrao em vez de fingir que ha.
    expect(bloco).toContain('NAO DEFINIDO');
  });

  test('as tres opcionais continuam listadas', () => {
    for (const nome of ['APP_USER', 'SESSION_SECRET', 'FISCAL_API_URL']) {
      expect(config).toContain(`nome: "${nome}"`);
    }
  });

  test('as obrigatorias continuam em primeiro, com marcador de pendencia', () => {
    expect(tela).toContain('VARIAVEIS_OBRIGATORIAS.map');
    expect(tela).toContain('bg-destructive');
    expect(tela).toContain('já configurada');
    expect(tela.indexOf('VARIAVEIS_OBRIGATORIAS.map'))
      .toBeLessThan(tela.indexOf('VARIAVEIS_OPCIONAIS.map'));
  });
});
