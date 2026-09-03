import { PLANOS, planoDe, divergenciaDePlano } from '../../src/webapp/planos';
import { PLANOS as PLANOS_BILLING } from '../../src/webapp/billing';
import { PLAN_LIMITS } from '../../src/webapp/middleware/rate-limiter';

/**
 * Os planos, e o que eles decidem.
 *
 * Eles decidem VOLUME, e mais nada. Quais documentos o cliente emite e o que
 * ele contratou, cadastrado em Servicos — antes as duas coisas viviam no mesmo
 * lugar ("PRO = NF-e ou NFS-e"), e mexer na faixa de preco mexia no que o
 * cliente podia emitir.
 *
 * O limite e POR SERVICO. Com um teto unico, quem vende produto de manha ficava
 * sem emitir a nota de servico da tarde, e a mensagem falava de "cota do plano"
 * sem dizer qual documento acabou.
 *
 * A lista tambem precisa continuar dizendo a MESMA coisa nos tres lugares que a
 * leem — catalogo, billing e limitador. Ja houve duas listas em paralelo, e um
 * cliente `business` que nao existia numa delas caia no limite do gratuito: dez
 * notas, e parava sem ninguem entender por que.
 */

describe('planos', () => {
  test('as tres faixas existem, na ordem em que o cliente cresce', () => {
    expect(PLANOS.map(p => p.id)).toEqual(['beta', 'pro', 'max']);
    expect(PLANOS.map(p => p.limitePorServico)).toEqual([25, 50, 0]);
  });

  test('as tres listas que leem os planos concordam', () => {
    for (const p of PLANOS) {
      expect(PLANOS_BILLING.find(b => b.id === p.id)!.limitePorServico).toBe(p.limitePorServico);
      expect(PLAN_LIMITS[p.id]!.emissionsPerMonth).toBe(p.limitePorServico);
    }
  });

  test('o MAX e sem teto, e `0` e o unico jeito de dizer isso', () => {
    // Um numero grande fingindo infinito acaba um dia, e o cliente descobre
    // emitindo. `0` e checado antes de comparar.
    expect(planoDe('max').limitePorServico).toBe(0);
  });

  test('identificador desconhecido cai no MAIS RESTRITO', () => {
    // Nunca no mais generoso: errar para cima entrega de graca o que foi
    // vendido, e ninguem percebe porque nada falha.
    expect(planoDe('inventado').id).toBe('beta');
    expect(planoDe(undefined).id).toBe('beta');
    expect(planoDe('').id).toBe('beta');
  });

  test('o PREMIUM antigo vira MAX, e nao um plano menor', () => {
    // Era o sem-teto da nomenclatura anterior, e e o que os clientes reais
    // tinham. Rebaixa-los cortaria emissao de quem ja pagou pelo ilimitado.
    expect(planoDe('premium').id).toBe('max');
    expect(planoDe('enterprise').id).toBe('max');
    expect(planoDe('ilimitado').id).toBe('max');
  });

  test('os identificadores de entrada viram BETA', () => {
    for (const antigo of ['free', 'gratuito', 'starter', 'basico']) {
      expect(planoDe(antigo).id).toBe('beta');
    }
  });

  test('nenhum plano restringe documento', () => {
    // O plano nao lista mais documentos. Se um campo assim voltar, volta junto
    // o acoplamento entre faixa de preco e o que o cliente pode emitir.
    for (const p of PLANOS) {
      expect(p).not.toHaveProperty('documentos');
      expect(p).not.toHaveProperty('escolheUm');
    }
  });

  test('nao existe mais divergencia entre plano e servicos', () => {
    // O aviso "o plano inclui NFC-e mas o cliente nao tem" perdeu sentido: o
    // plano nao inclui documento nenhum.
    expect(divergenciaDePlano('beta', ['nfe'])).toBeNull();
    expect(divergenciaDePlano('max', [])).toBeNull();
  });

  test('preco nao aparece em campo nenhum', () => {
    // Preco se negocia caso a caso. Um numero cravado aqui vira promessa que o
    // codigo faz em nome de quem vende.
    const texto = JSON.stringify(PLANOS).toLowerCase();
    for (const proibido of ['preco', 'preço', 'valor', 'r$', 'mensalidade', 'price']) {
      expect(texto).not.toContain(proibido);
    }
  });

  test('todo plano diz para QUEM ele e', () => {
    for (const p of PLANOS) {
      expect(p.perfil.length).toBeGreaterThan(20);
    }
  });
});
