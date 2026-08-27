import { PLANOS, planoDe, planoPermite } from '../../src/webapp/planos';
import { PLANOS as PLANOS_BILLING } from '../../src/webapp/billing';
import { PLAN_LIMITS } from '../../src/webapp/middleware/rate-limiter';

/**
 * Os planos, e a contradição que eles tinham.
 *
 * Havia duas listas: `PLANOS` no billing (free, starter, pro) e `PLAN_LIMITS`
 * no rate limiter (free, starter, business, pro, enterprise). O cliente real
 * estava em `business`, que não existia na primeira: caía no fallback do
 * gratuito e recebia limite de **10 notas por mês**. Emitia até a décima e
 * parava, com "Limite de uso atingido", sem ninguém entender por quê.
 *
 * O primeiro bloco é o que impede isso de voltar.
 */

describe('uma fonte de verdade', () => {
  it('billing e rate limiter falam dos MESMOS planos', () => {
    const doCatalogo = PLANOS.map(p => p.id).sort();
    expect(PLANOS_BILLING.map(p => p.id).sort()).toEqual(doCatalogo);
    expect(Object.keys(PLAN_LIMITS).sort()).toEqual(doCatalogo);
  });

  it('o limite de notas e o mesmo nos dois lugares', () => {
    for (const p of PLANOS) {
      expect(PLANOS_BILLING.find(b => b.id === p.id)!.limiteNotas).toBe(p.limiteNotas);
      expect(PLAN_LIMITS[p.id]!.emissionsPerMonth).toBe(p.limiteNotas);
    }
  });
});

describe('nome de plano antigo continua valendo', () => {
  it.each([
    ['business', 'MAX'],
    ['free', 'PRO'],
    ['starter', 'PRO'],
    ['enterprise', 'PREMIUM'],
  ])('%s vira %s', (antigo, esperado) => {
    expect(planoDe(antigo).nome).toBe(esperado);
  });

  it('o cliente que estava em business NAO cai mais no limite do gratuito', () => {
    const p = planoDe('business');
    // O defeito era exatamente este número: 10.
    expect(p.limiteNotas).toBeGreaterThan(10);
    expect(p.limiteNotas).toBe(1_500);
  });

  it('plano desconhecido cai no mais restrito, nunca em acesso livre', () => {
    for (const v of ['inventado', '', null, undefined]) {
      const p = planoDe(v as any);
      expect(p.id).toBe('pro');
      expect(p.limiteNotas).toBeGreaterThan(0);
    }
  });
});

describe('o que cada plano permite emitir', () => {
  it('NFC-e so no PREMIUM — e questao de volume, nao de sofisticacao', () => {
    expect(planoPermite('pro', 'nfce')).toBe(false);
    expect(planoPermite('max', 'nfce')).toBe(false);
    expect(planoPermite('premium', 'nfce')).toBe(true);
  });

  it('PRO da acesso a NF-e e NFS-e, mas o cliente escolhe UM', () => {
    const p = planoDe('pro');
    expect(p.documentos).toEqual(['nfe', 'nfse']);
    expect(p.escolheUm).toBe(true);
  });

  it('MAX e o plano de quem vende produto E presta servico', () => {
    const p = planoDe('max');
    expect(p.documentos).toEqual(expect.arrayContaining(['nfe', 'nfse']));
    expect(p.escolheUm).toBe(false);
  });

  it('PREMIUM nao tem teto de notas nem de empresas', () => {
    const p = planoDe('premium');
    expect(p.limiteNotas).toBe(0);
    expect(p.empresas).toBe(0);
    expect(p.requestsPerDay).toBe(0);
  });
});

describe('os limites crescem junto com a faixa', () => {
  it('req/min sobe de PRO para MAX para PREMIUM', () => {
    expect(planoDe('pro').requestsPerMinute).toBeLessThan(planoDe('max').requestsPerMinute);
    expect(planoDe('max').requestsPerMinute).toBeLessThan(planoDe('premium').requestsPerMinute);
  });

  it('nenhum plano fica abaixo de 60 req/min — uma tela consome varias por carga', () => {
    for (const p of PLANOS) expect(p.requestsPerMinute).toBeGreaterThanOrEqual(60);
  });

  it('preco nao vive no codigo: e negociado caso a caso', () => {
    // Antes o campo existia zerado, e um campo zerado convida a preenche-lo.
    // Nao existir e mais forte: nao ha onde escrever, e o TypeScript recusa
    // quem tentar.
    for (const p of PLANOS_BILLING) {
      expect(Object.keys(p)).not.toContain('preco');
      expect(Object.keys(p)).not.toContain('precoFormatado');
    }
  });

  it('nenhum plano carrega identificador de cobranca externa', () => {
    // O checkout automatico saiu: nao ha assinatura para amarrar, e um campo
    // sobrando aqui e a porta por onde a segunda fonte da verdade volta.
    for (const p of PLANOS_BILLING) {
      for (const chave of Object.keys(p)) expect(chave).not.toMatch(/stripe/i);
    }
  });
});
