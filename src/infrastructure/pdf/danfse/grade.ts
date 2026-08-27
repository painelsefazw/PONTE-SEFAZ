/**
 * Grade do DANFSe v2.0 — transcrição da NT nº 008/2026, item 2.4.5.
 *
 * O documento original está em `docs/nfse/NT-008-2026-DANFSe-v2.0.pdf`.
 *
 * A NT dá altura, largura e as coordenadas (esquerda/superior) de cada campo em
 * **centímetros**, medidas a partir do canto superior esquerdo do papel. Este
 * arquivo é essa tabela e nada mais: sem cálculo de leiaute, sem "onde couber".
 * Quem for conferir se o PDF está certo compara com o PDF da NT, campo a campo.
 *
 * Duas coisas que a tabela da NT deixa implícitas e custaram sobreposição na
 * primeira versão:
 *
 *  1. O **título do bloco é uma célula da coluna 1**, na mesma linha do
 *     primeiro campo, com os mesmos 5,09 cm de largura — não é uma faixa acima
 *     do bloco. Só CABEÇALHO, DADOS DA NFS-e, INFORMAÇÕES COMPLEMENTARES e
 *     CANHOTO têm largura 20,40, e esses sim são caixas envolventes.
 *  2. As linhas **não** têm passo constante: o prestador vai de 5,62 para 6,28
 *     (0,66) enquanto de 4,34 para 4,98 são 0,64. Derivar por soma erra.
 *
 * Por isso cada célula está escrita aqui com a coordenada literal da NT.
 */

/** Uma célula posicionada, em centímetros. */
export interface Campo {
  /** Rótulo impresso (item 2.4.2 — negrito, 6 pt). */
  label: string;
  alt: number;
  larg: number;
  esq: number;
  sup: number;
  /** Limite de caracteres antes das reticências, quando a NT o define. */
  limite?: number;
  /** Célula que é título de bloco: caixa alta, 7 pt, fundo cinza. */
  titulo?: boolean;
}

/** As quatro colunas em que a NT dispõe os campos. */
export const COL = { c1: 0.30, c2: 5.41, c3: 10.51, c4: 15.62 } as const;

/** A4 retrato (item 2.2.1) com margem de 0,30 cm (item 2.2.2). */
export const PAPEL = { largura: 21.0, altura: 29.7, margem: 0.30 } as const;

/** Larguras: uma coluna, duas colunas, largura cheia. */
export const LARG = { campo: 5.09, duplo: 10.19, cheio: 20.40 } as const;

/** Alturas recorrentes. */
export const ALT = { campo: 0.63, total: 0.67, ident: 0.67, titulo: 0.39 } as const;

/** Espessuras do item 2.2.3, em pontos. */
export const TRACO = { linha: 0.5, borda: 1 } as const;
/** Sombreamento cinza claro, 5% de densidade (item 2.2.3). */
export const CINZA_5 = '#F2F2F2';

/** Fontes do item 2.4. */
export const FONTE = {
  tituloBloco: 7, labelCampo: 6, labelIdent: 7, conteudo: 7,
  cabecalho: 9, municipio: 8, ambiente: 6, qrNota: 6, marcaDagua: 50,
} as const;

/** Caixas envolventes de largura cheia. */
export const BLOCOS = {
  cabecalho:      { alt: 1.16, larg: LARG.cheio, esq: 0.30, sup: 0.30 },
  dadosNfse:      { alt: 2.84, larg: LARG.cheio, esq: 0.30, sup: 1.48 },
  infoCompl:      { alt: 0.39, larg: LARG.cheio, esq: 0.30, sup: 22.27 },
  infoComplTexto: { alt: 0.39, larg: LARG.cheio, esq: 0.30, sup: 22.68 },
  canhoto:        { alt: 0.67, larg: LARG.cheio, esq: 0.30, sup: 28.10 },
} as const;

/** QR Code (item 2.4.3): dimensão e posição fixas. */
export const QRCODE = {
  lado: 1.52, esq: 17.48, sup: 1.67,
  base: 'https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=',
  nota: { larg: 4.72, alt: 0.68, esq: 15.80, sup: 3.36 },
  texto: 'A autenticidade desta NFS-e pode ser verificada pela leitura deste '
    + 'código QR ou pela consulta da chave de acesso no portal nacional da NFS-e',
} as const;

const t = (label: string, esq: number, sup: number): Campo =>
  ({ label, alt: ALT.campo, larg: LARG.campo, esq, sup, titulo: true });
const c = (label: string, esq: number, sup: number,
  larg: number = LARG.campo, limite?: number): Campo =>
  ({ label, alt: ALT.campo, larg, esq, sup, limite });

/** Bloco "DADOS DA NFS-e" (item 2.1.2) — rótulos em caixa alta, 7 pt. */
export const CAMPOS_IDENT: Campo[] = [
  { label: 'Chave de Acesso da NFS-e', alt: 0.77, larg: 15.30, esq: COL.c1, sup: 1.48, limite: 50 },
  { label: 'Número da NFS-e', alt: ALT.ident, larg: LARG.campo, esq: COL.c1, sup: 2.27, limite: 13 },
  { label: 'Competência da NFS-e', alt: ALT.ident, larg: LARG.campo, esq: COL.c2, sup: 2.27, limite: 10 },
  { label: 'Data e Hora da Emissão da NFS-e', alt: ALT.ident, larg: LARG.campo, esq: COL.c3, sup: 2.27, limite: 19 },
  { label: 'Número da DPS', alt: ALT.ident, larg: LARG.campo, esq: COL.c1, sup: 2.96, limite: 15 },
  { label: 'Série da DPS', alt: ALT.ident, larg: LARG.campo, esq: COL.c2, sup: 2.96, limite: 5 },
  { label: 'Data e Hora da Emissão da DPS', alt: ALT.ident, larg: LARG.campo, esq: COL.c3, sup: 2.96, limite: 19 },
  { label: 'Emitente da NFS-e', alt: ALT.ident, larg: LARG.campo, esq: COL.c1, sup: 3.65, limite: 13 },
  { label: 'Situação da NFS-e', alt: ALT.ident, larg: LARG.campo, esq: COL.c2, sup: 3.65, limite: 40 },
  { label: 'Finalidade', alt: ALT.ident, larg: LARG.campo, esq: COL.c3, sup: 3.65, limite: 40 },
];

/**
 * Blocos de parte. O prestador tem duas linhas a mais (Simples Nacional e
 * regime de apuração); o destinatário não tem inscrição municipal — a NT não a
 * lista no item 2.1.5.
 */
export const CAMPOS_PRESTADOR: Campo[] = [
  t('Prestador / Fornecedor', COL.c1, 4.34),
  c('CNPJ / CPF / NIF', COL.c2, 4.34, LARG.campo, 40),
  c('Indicador Municipal (Inscrição)', COL.c3, 4.34, LARG.campo, 15),
  c('Telefone', COL.c4, 4.34, LARG.campo, 20),
  c('Nome / Nome Empresarial', COL.c1, 4.98, LARG.duplo, 80),
  c('Município / Sigla UF', COL.c3, 4.98, LARG.campo, 37),
  c('Código IBGE / CEP', COL.c4, 4.98, LARG.campo, 21),
  c('Endereço', COL.c1, 5.62, LARG.duplo, 80),
  c('E-mail', COL.c3, 5.62, LARG.duplo, 80),
  c('Simples Nacional na Data de Competência', COL.c1, 6.28, LARG.campo, 40),
  c('Regime de Apuração Tributária pelo SN', COL.c3, 6.28, LARG.duplo, 80),
];

export const CAMPOS_TOMADOR: Campo[] = [
  t('Tomador / Adquirente', COL.c1, 6.92),
  c('CNPJ / CPF / NIF', COL.c2, 6.92, LARG.campo, 40),
  c('Indicador Municipal (Inscrição)', COL.c3, 6.92, LARG.campo, 15),
  c('Telefone', COL.c4, 6.92, LARG.campo, 20),
  c('Nome / Nome Empresarial', COL.c1, 7.56, LARG.duplo, 80),
  c('Município / Sigla UF', COL.c3, 7.56, LARG.campo, 37),
  c('Código IBGE / CEP', COL.c4, 7.56, LARG.campo, 21),
  c('Endereço', COL.c1, 8.22, LARG.duplo, 80),
  c('E-mail', COL.c3, 8.22, LARG.duplo, 80),
];

export const CAMPOS_DESTINATARIO: Campo[] = [
  t('Destinatário da Operação', COL.c1, 8.86),
  c('CNPJ / CPF / NIF', COL.c2, 8.86, LARG.campo, 40),
  c('Telefone', COL.c4, 8.86, LARG.campo, 20),
  c('Nome / Nome Empresarial', COL.c1, 9.50, LARG.duplo, 80),
  c('Município / Sigla UF', COL.c3, 9.50, LARG.campo, 37),
  c('Código IBGE / CEP', COL.c4, 9.50, LARG.campo, 21),
  c('Endereço', COL.c1, 10.16, LARG.duplo, 80),
  c('E-mail', COL.c3, 10.16, LARG.duplo, 80),
];

export const CAMPOS_INTERMEDIARIO: Campo[] = [
  t('Intermediário da Operação', COL.c1, 10.80),
  c('CNPJ / CPF / NIF', COL.c2, 10.80, LARG.campo, 40),
  c('Indicador Municipal (Inscrição)', COL.c3, 10.80, LARG.campo, 15),
  c('Telefone', COL.c4, 10.80, LARG.campo, 20),
  c('Nome / Nome Empresarial', COL.c1, 11.44, LARG.duplo, 80),
  c('Município / Sigla UF', COL.c3, 11.44, LARG.campo, 37),
  c('Código IBGE / CEP', COL.c4, 11.44, LARG.campo, 21),
  c('Endereço', COL.c1, 12.09, LARG.duplo, 80),
  c('E-mail', COL.c3, 12.09, LARG.duplo, 80),
];

/** Bloco "SERVIÇO PRESTADO" (item 2.1.7). */
export const CAMPOS_SERVICO: Campo[] = [
  t('Serviço Prestado', COL.c1, 12.74),
  c('Código de Tributação Nacional / Municipal', COL.c2, 12.74),
  c('Código da NBS', COL.c3, 12.74),
  c('Local da Prestação / Sigla UF / País', COL.c4, 12.74),
  { label: 'Descrição do Código de Tributação Nacional / Municipal',
    alt: 0.38, larg: LARG.cheio, esq: COL.c1, sup: 13.39 },
  { label: 'Descrição do Serviço', alt: 0.63, larg: LARG.cheio, esq: COL.c1, sup: 13.79 },
];

/** Bloco "TRIBUTAÇÃO MUNICIPAL (ISSQN)" (item 2.1.8). */
export const CAMPOS_ISSQN: Campo[] = [
  t('Tributação Municipal (ISSQN)', COL.c1, 14.43),
  c('Tipo de Tributação do ISSQN', COL.c2, 14.43, LARG.duplo),
  c('Município / UF de Incidência do ISSQN', COL.c4, 14.43),
  c('Regime Especial de Tributação', COL.c1, 15.08),
  c('Tipo de Imunidade do ISSQN', COL.c2, 15.08),
  c('Suspensão da Exigibilidade', COL.c3, 15.08),
  c('Número Processo Suspensão', COL.c4, 15.08, LARG.campo, 30),
  c('Benefício Municipal', COL.c1, 15.73),
  c('Cálculo do BM', COL.c2, 15.73),
  c('Total Deduções/Reduções', COL.c3, 15.73),
  c('Desconto Incondicionado', COL.c4, 15.73),
  c('BC ISSQN', COL.c1, 16.37),
  c('Alíquota Aplicada', COL.c2, 16.37),
  c('Retenção do ISSQN', COL.c3, 16.37),
  c('ISSQN Apurado', COL.c4, 16.37),
];

/** Bloco "TRIBUTAÇÃO FEDERAL (EXCETO CBS)" (item 2.1.9) — só até 2026 (nota 6). */
export const CAMPOS_FEDERAL: Campo[] = [
  t('Tributação Federal (Exceto CBS)', COL.c1, 17.02),
  c('IRRF', COL.c2, 17.02),
  c('Contribuição Previdenciária - Retida', COL.c3, 17.02),
  c('Contribuições Sociais - Retidas', COL.c4, 17.02),
  c('PIS - Débito Apuração Própria', COL.c1, 17.67),
  c('COFINS - Débito Apuração Própria', COL.c2, 17.67),
  c('Descrição das Contribuições Sociais - Retidas', COL.c3, 17.67, LARG.duplo),
];

/** Bloco "TRIBUTAÇÃO IBS / CBS" (item 2.1.10) — o que não existia no DANFSe antigo. */
export const CAMPOS_IBSCBS: Campo[] = [
  t('Tributação IBS / CBS', COL.c1, 18.32),
  c('CST / cClassTrib', COL.c2, 18.32, LARG.campo, 12),
  c('Ind. Operação / Cód. IBGE Incidência / Município / UF', COL.c3, 18.32, LARG.duplo, 56),
  c('Exclusões e Reduções da Base de Cálculo', COL.c1, 18.96),
  c('Base de Cálculo Após Exclusões e Reduções', COL.c2, 18.96),
  c('Red. Alíquota IBS / Red. Alíquota CBS', COL.c3, 18.96),
  c('Alíquota - IBS UF / IBS Mun', COL.c4, 18.96),
  c('Alíq. Efetiva Municipal - IBS', COL.c1, 19.61),
  c('Valor Apurado Municipal - IBS', COL.c2, 19.61),
  c('Alíq. Efetiva Estadual - IBS', COL.c3, 19.61),
  c('Valor Apurado Estadual - IBS', COL.c4, 19.61),
  c('Valor Total Apurado - IBS', COL.c1, 20.26),
  c('Alíquota - CBS', COL.c2, 20.26),
  c('Alíquota Efetiva - CBS', COL.c3, 20.26),
  c('Valor Total Apurado - CBS', COL.c4, 20.26),
];

/** Bloco "VALOR TOTAL DA NFS-E" (item 2.1.11). */
export const CAMPOS_TOTAIS: Campo[] = [
  { label: 'Valor Total da NFS-e', alt: ALT.total, larg: LARG.campo, esq: COL.c1, sup: 20.90, titulo: true },
  { label: 'Valor da Operação / Serviço', alt: ALT.total, larg: LARG.campo, esq: COL.c2, sup: 20.90 },
  { label: 'Desconto Incondicionado', alt: ALT.total, larg: LARG.campo, esq: COL.c3, sup: 20.90 },
  { label: 'Desconto Condicionado', alt: ALT.total, larg: LARG.campo, esq: COL.c4, sup: 20.90 },
  { label: 'Total das Retenções (ISSQN / Federais)', alt: ALT.total, larg: LARG.campo, esq: COL.c1, sup: 21.59 },
  { label: 'Valor Líquido da NFS-e', alt: ALT.total, larg: LARG.campo, esq: COL.c2, sup: 21.59 },
  { label: 'Total do IBS/CBS', alt: ALT.total, larg: LARG.campo, esq: COL.c3, sup: 21.59 },
  { label: 'Valor Líquido da NFS-e + IBS/CBS', alt: ALT.total, larg: LARG.campo, esq: COL.c4, sup: 21.59 },
];

/** Bloco "CANHOTO" (item 2.1.13) — opcional, nota 11. */
export const CAMPOS_CANHOTO: Campo[] = [
  { label: 'Data de Cientificação', alt: ALT.total, larg: LARG.campo, esq: COL.c1, sup: 28.10 },
  { label: 'Identificação e Assinatura', alt: ALT.total, larg: LARG.campo, esq: COL.c2, sup: 28.10 },
  { label: 'Nº NFS-e / Chave NFS-e', alt: ALT.total, larg: LARG.duplo, esq: COL.c3, sup: 28.10, limite: 66 },
];

/**
 * Faixa que substitui um bloco de parte sem dados (notas 2 a 4): altura mínima
 * de 0,32 cm e largura cheia, no lugar de repetir campos vazios.
 */
export const FAIXA_AUSENTE = { alt: 0.32, larg: LARG.cheio, esq: COL.c1 } as const;

/** Campo vazio vira traço — nota 12. Branco esconderia "não informado". */
export const VAZIO = '-';

/** Linha obrigatória da Lei 12.741/2012 (nota 10). */
export function linhaTotaisAproximados(fed: string, est: string, mun: string): string {
  return `Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: Federais: ${fed}`
    + ` ; Estaduais: ${est} ; Municipais: ${mun}`;
}
