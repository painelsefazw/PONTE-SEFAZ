/**
 * NF-e 4.00 — Gerador da Chave de Acesso (44 dígitos)
 *
 * Formato:
 *   cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + serie(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1) = 44
 */

export interface AccessKeyInput {
  cUF: string;
  dhEmi: string;   // ISO 8601, e.g. "2024-05-10T10:00:00-03:00"
  cnpj: string;
  mod: string;     // '55' for NF-e
  serie: string;
  nNF: string;
  tpEmis: string;  // TipoEmissao value
  cNF: string;     // 8-digit random code
}

export interface AccessKeyResult {
  chave: string;
  cDV: string;
}

/**
 * Nomes dos campos, para a mensagem de recusa.
 *
 * Sem isto o erro diria "valor nao cabe", e numa chave de 8 campos numericos
 * isso manda procurar.
 */
const ROTULO: Record<string, string> = {
  cUF: 'codigo da UF', cnpj: 'CNPJ', mod: 'modelo',
  serie: 'serie', nNF: 'numero da nota', tpEmis: 'tipo de emissao',
  cNF: 'codigo numerico',
};

/**
 * Completa com zeros a esquerda — e RECUSA o que nao couber.
 *
 * O `.slice(-length)` que existia aqui CORTAVA em vez de reclamar, e o corte
 * produzia uma chave que mente: com `serie: "1500"` a chave levava '500' e o XML
 * levava 1500. O Id assinado deixa de corresponder a concatenacao dos campos e a
 * SEFAZ recusa por erro na chave (502) — sem dizer qual campo.
 *
 * Pior que a rejeicao: a previa devolvia essa chave com ar de correta, e o
 * operador conferia na tela um numero que nao existe.
 *
 * O `.replace(/\D/g,'')` tambem apagava caractere nao numerico em silencio:
 * `serie: "A1"` virava '001' na chave e continuava 'A1' no XML. Agora um valor
 * com letra e recusado nomeando o que veio.
 */
function pad(value: string, length: number, campo: string): string {
  const bruto = String(value ?? '').trim();
  // Pontuacao de documento e FORMATACAO, e some sem reclamar — CNPJ colado de
  // tela vem "50.229.544/0001-06" e sempre funcionou assim. O que nao pode
  // passar e caractere que muda o significado: `serie: "A1"` virava '001' na
  // chave e continuava 'A1' no XML.
  const semFormatacao = bruto.replace(/[.\-/()\s]/g, '');
  const digitos = semFormatacao.replace(/\D/g, '');

  if (digitos !== semFormatacao) {
    throw new Error(
      `O ${ROTULO[campo] ?? campo} "${bruto}" tem caractere que nao e digito. `
      + 'A chave de acesso e so numerica — corrigir aqui evita uma chave que discorda do XML.',
    );
  }
  if (digitos.length > length) {
    throw new Error(
      `O ${ROTULO[campo] ?? campo} "${bruto}" nao cabe na chave de acesso: `
      + `sao ${digitos.length} digitos e o campo tem ${length}. `
      + 'Cortar produziria uma chave diferente do XML, e a SEFAZ recusaria sem dizer qual campo.',
    );
  }
  return digitos.padStart(length, '0');
}

/**
 * Computes the modulo-11 check digit (cDV) for 43 digits.
 *
 * Algorithm:
 *  - Walk from rightmost digit, multiplying by weights cycling 2..9
 *  - Sum all products
 *  - remainder = sum % 11
 *  - If remainder < 2 → cDV = 0; else cDV = 11 - remainder
 */
function computeCDV(digits43: string): string {
  const weights = [2, 3, 4, 5, 6, 7, 8, 9];
  let sum = 0;

  for (let i = digits43.length - 1, w = 0; i >= 0; i--, w++) {
    sum += parseInt(digits43[i], 10) * weights[w % weights.length];
  }

  const remainder = sum % 11;
  const cdv = remainder < 2 ? 0 : 11 - remainder;
  return String(cdv);
}

/**
 * Generates the 44-digit NF-e access key.
 */
export function generateAccessKey(input: AccessKeyInput): AccessKeyResult {
  // Extract AAMM from dhEmi (e.g. "2024-05-10T..." → "2405")
  const dateMatch = input.dhEmi.match(/^(\d{4})-(\d{2})/);
  if (!dateMatch) {
    throw new Error(`Invalid dhEmi format: ${input.dhEmi}`);
  }
  const aamm = dateMatch[1].slice(2) + dateMatch[2]; // YY + MM

  const parts = [
    pad(input.cUF, 2, 'cUF'),
    aamm,
    pad(input.cnpj, 14, 'cnpj'),
    pad(input.mod, 2, 'mod'),
    pad(input.serie, 3, 'serie'),
    pad(input.nNF, 9, 'nNF'),
    pad(input.tpEmis, 1, 'tpEmis'),
    pad(input.cNF, 8, 'cNF'),
  ];

  const digits43 = parts.join('');

  if (digits43.length !== 43) {
    throw new Error(`Expected 43 digits before cDV, got ${digits43.length}`);
  }

  const cDV = computeCDV(digits43);
  const chave = digits43 + cDV;

  return { chave, cDV };
}
