import * as fs from 'fs';
import * as path from 'path';

const raiz = path.resolve(__dirname, '..', '..');
const funcoes = fs.readFileSync(
  path.join(raiz, 'admin-template', 'src', 'lib', 'admin.functions.ts'), 'utf8');

/**
 * O console tem que dar conta do cliente inteiro.
 *
 * Antes ele cobria cadastro, chaves, servicos e publicacao da plataforma — e
 * parava exatamente antes da primeira nota, porque nao subia certificado. Quem
 * operasse por ele tinha que voltar ao painel embutido para o passo final, o
 * que derrota o proposito de ter um console proprio.
 *
 * Estes testes olham a FONTE em vez de rodar o app: o console e um projeto
 * TanStack separado, que nao compila nesta suite. O que da para garantir daqui
 * e que cada capacidade da ponte tem uma funcao correspondente — e e
 * justamente o esquecimento de uma delas que passa despercebido.
 */
describe('o console cobre o que a ponte oferece', () => {
  const temFuncao = (nome: string) =>
    new RegExp(`export const ${nome}\\b`).test(funcoes);

  test('o basico continua: clientes, chaves, servicos, plataforma', () => {
    for (const f of ['listarClientes', 'obterCliente', 'criarCliente', 'mudarStatusDoCliente',
      'listarChaves', 'gerarChave', 'revogarChave', 'ativarServico', 'desativarServico',
      'gerarPlataforma', 'publicarPlataforma']) {
      expect(temFuncao(f)).toBe(true);
    }
  });

  test('certificado A1 — sem ele o cliente nao emite', () => {
    // E o unico passo entre "cadastrado" e "emitindo".
    expect(temFuncao('enviarCertificado')).toBe(true);
    expect(temFuncao('verCertificado')).toBe(true);
  });

  test('dados fiscais — o CRT decide CST ou CSOSN, o endereco decide o CFOP', () => {
    expect(temFuncao('obterFiscal')).toBe(true);
    expect(temFuncao('salvarFiscal')).toBe(true);
  });

  test('white-label — e o que o cliente ve na plataforma dele', () => {
    expect(temFuncao('obterWhiteLabel')).toBe(true);
    expect(temFuncao('salvarWhiteLabel')).toBe(true);
  });

  test('webhooks: listar, ver entregas, ligar/desligar e reprocessar', () => {
    // "Nao recebi" so vira acao quando se sabe se saiu e quantas vezes tentou.
    for (const f of ['listarWebhooks', 'listarEntregas', 'alternarWebhook', 'reprocessarWebhooks']) {
      expect(temFuncao(f)).toBe(true);
    }
  });

  test('auditoria — responder "quem revogou aquela chave"', () => {
    expect(temFuncao('listarAuditoria')).toBe(true);
  });

  test('toda funcao exige sessao antes de falar com a ponte', () => {
    // Uma funcao de servidor sem `requireAuth` e a ponte inteira aberta para
    // quem descobrir a URL do console.
    const blocos = funcoes.split('export const ').slice(1);
    const semAuth = blocos
      .filter(b => b.includes('createServerFn'))
      .filter(b => !b.includes('requireAuth'))
      .map(b => b.slice(0, b.indexOf(' ')));
    expect(semAuth).toEqual([]);
  });

  test('a chave da ponte nunca chega ao navegador', () => {
    // Nada com prefixo VITE_ : o que leva esse prefixo vai para o pacote do
    // navegador, e a chave administrativa ali e o sistema inteiro exposto.
    expect(funcoes).not.toContain('VITE_');
    expect(funcoes).not.toContain('EMISSOR_ADMIN_KEY');
  });
});
