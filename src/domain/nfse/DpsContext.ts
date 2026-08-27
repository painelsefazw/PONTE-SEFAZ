/**
 * Contexto de entrada da Declaração de Prestação de Serviços (DPS).
 *
 * Espelha o que o operador ou o ERP informa; a tradução para o XML fica no
 * DpsXmlGenerator. Mantido separado do FiscalContext da NF-e de propósito: são
 * documentos de fiscos diferentes, e misturar os dois criaria um tipo que não
 * descreve bem nenhum dos dois.
 */

/** Endereço no padrão da NFS-e (municipal, não estadual). */
export interface DpsEndereco {
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  /** Código IBGE de 7 dígitos. */
  codigoMunicipio: string;
  uf: string;
  cep: string;
}

export interface DpsPrestador {
  cnpj: string;
  /** Inscrição Municipal — emitida pela prefeitura. */
  im?: string;
  razaoSocial: string;
  endereco?: DpsEndereco;
  fone?: string;
  email?: string;
  /**
   * Opção pelo Simples Nacional: 1 = não optante, 2 = optante microempreendedor
   * individual, 3 = optante ME/EPP.
   */
  opSimplesNacional: '1' | '2' | '3';
  /** Regime de apuração do Simples — só quando optante ME/EPP. */
  regimeApuracaoSN?: '1' | '2' | '3';
  /** Regime especial de tributação: 0 = nenhum. */
  regimeEspecial: '0' | '1' | '2' | '3' | '4' | '5' | '6';
}

export interface DpsTomador {
  cnpj?: string;
  cpf?: string;
  /** Identificação de estrangeiro, quando não há CNPJ nem CPF. */
  nif?: string;
  im?: string;
  razaoSocial: string;
  endereco?: DpsEndereco;
  fone?: string;
  email?: string;
}

/** Endereço da obra — mais enxuto que o endereço comum: CEP em vez de município. */
export interface DpsEnderecoObra {
  cep: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
}

/**
 * Identificação da obra, obrigatória nos serviços de construção civil.
 *
 * A SEFIN recusa com E0370 quando o código de tributação é de obra e o grupo
 * não vem. É preciso um dos três: CNO/CEI, CIB ou o endereço da obra — o
 * endereço é a saída quando o cliente não tem cadastro de obra.
 */
export interface DpsObra {
  /** Inscrição imobiliária fiscal (a mesma do IPTU), quando a prefeitura usa. */
  inscricaoImobiliariaFiscal?: string;
  /** Cadastro Nacional de Obras (CNO) ou Cadastro Específico do INSS (CEI). */
  codigoObra?: string;
  /** Código do Cadastro Imobiliário Brasileiro (CIB). */
  codigoCIB?: string;
  endereco?: DpsEnderecoObra;
}

/**
 * Comércio exterior.
 *
 * Obrigatório quando `tributacaoISSQN` é '3' (exportação de serviço) — a SEFIN
 * recusa com E0330 sem ele.
 *
 * Todos os campos são obrigatórios no XSD, e nenhum tem padrão aqui de
 * propósito: são declarações fiscais sobre a operação, e cada tabela tem um
 * valor `0`/`00` que significa "desconhecido, não informado na nota de origem"
 * — usar isso como default seria declarar desconhecimento em nome do
 * contribuinte. Quem emite informa, com a contabilidade.
 */
export interface DpsComercioExterior {
  /**
   * Modo de prestação: 0 desconhecido, 1 transfronteiriço, 2 consumo no Brasil,
   * 3 presença comercial no exterior, 4 movimento temporário de pessoas.
   */
  modoPrestacao: '0' | '1' | '2' | '3' | '4';
  /**
   * Vínculo entre as partes: 0 sem vínculo, 1 controlada, 2 controladora,
   * 3 coligada, 4 matriz, 5 filial ou sucursal, 6 outro, 9 desconhecido.
   */
  vinculoEntrePartes: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '9';
  /** Código da moeda pela tabela do BACEN — 3 dígitos. */
  codigoMoeda: string;
  /** Valor do serviço na moeda estrangeira. */
  valorMoedaEstrangeira: string;
  /** Mecanismo de fomento usado pelo prestador — '00' a '08'. */
  mecanismoFomentoPrestador: string;
  /** Mecanismo de fomento usado pelo tomador — '00' a '26'. */
  mecanismoFomentoTomador: string;
  /**
   * Movimentação temporária de bens: 0 desconhecido, 1 não,
   * 2 vinculada a declaração de importação, 3 a declaração de exportação.
   */
  movimentacaoTemporaria: '0' | '1' | '2' | '3';
  /** Número da Declaração de Importação averbada. */
  numeroDeclaracaoImportacao?: string;
  /** Número do Registro de Exportação averbado. */
  numeroRegistroExportacao?: string;
  /** 0 = não compartilhar com o MDIC, 1 = compartilhar. */
  compartilharComMdic: '0' | '1';
}

/**
 * Atividade em evento — shows, congressos, feiras.
 *
 * Alguns municípios usam para vincular a nota ao evento e conferir a
 * arrecadação. Exige o código do evento, dado pela prefeitura, **ou** o endereço
 * onde aconteceu.
 */
export interface DpsAtividadeEvento {
  /** Nome do evento. */
  nome: string;
  /** Data de início, AAAA-MM-DD. */
  dataInicio: string;
  /** Data de fim, AAAA-MM-DD. */
  dataFim: string;
  /** Código do evento na prefeitura. Exclusivo com `endereco`. */
  codigoEvento?: string;
  /** Onde aconteceu, quando não há código. Exclusivo com `codigoEvento`. */
  endereco?: DpsEnderecoObra;
}

/**
 * Intermediário do serviço.
 *
 * Usa a mesma estrutura do tomador (`TCInfoPessoa` no XSD), então os campos são
 * os mesmos — por isso reaproveita `DpsTomador`.
 */
export type DpsIntermediario = DpsTomador;

export interface DpsServico {
  /**
   * Código de tributação nacional: 6 dígitos — 2 do item da LC 116, 2 do
   * subitem e 2 do desdobro nacional.
   */
  codigoTributacaoNacional: string;
  /** Código municipal do serviço, quando o município exigir. */
  codigoTributacaoMunicipal?: string;
  descricao: string;
  /** Nomenclatura Brasileira de Serviços — 9 dígitos. */
  codigoNBS?: string;
  /** Código interno do contribuinte para o serviço. */
  codigoInterno?: string;
  /** Município onde o serviço foi prestado (IBGE). */
  codigoMunicipioPrestacao: string;
  /** Obrigatório quando o código de tributação é de construção civil. */
  obra?: DpsObra;
  /** Obrigatório na exportação de serviço (`tributacaoISSQN` = '3'). */
  comercioExterior?: DpsComercioExterior;
  /** Evento artístico, cultural, esportivo ou congresso. */
  atividadeEvento?: DpsAtividadeEvento;
  /** Informação complementar que sai na nota. */
  informacoesComplementares?: string;
}

/**
 * PIS/COFINS sobre o serviço.
 *
 * Não confundir com o PIS/COFINS da NF-e: aqui os dois andam juntos num único
 * grupo, com um CST comum, em vez dos grupos separados por faixa de CST que o
 * XSD da NF-e exige.
 */
export interface DpsPisCofins {
  /**
   * CST do PIS/COFINS — '00' a '09'.
   * '00' = nenhum, '01' = alíquota básica, '07' = isenta, '08' = sem incidência.
   */
  cst: string;
  baseCalculo?: string;
  aliquotaPis?: string;
  aliquotaCofins?: string;
  valorPis?: string;
  valorCofins?: string;
  /** 1 = retido pelo tomador, 2 = não retido. */
  retido?: '1' | '2';
}

/**
 * Retenções federais.
 *
 * É o que separa o valor bruto do que o prestador recebe de fato quando o
 * tomador é pessoa jurídica. Sem este grupo a nota sai com o líquido errado
 * nesses casos — e a nota não se corrige, se cancela.
 */
export interface DpsTributosFederais {
  pisCofins?: DpsPisCofins;
  /** Contribuição previdenciária retida (INSS) — `vRetCP` no XSD. */
  valorRetidoINSS?: string;
  /** Imposto de renda retido na fonte. */
  valorRetidoIRRF?: string;
  /** CSLL retida. */
  valorRetidoCSLL?: string;
}

/**
 * Dedução ou redução da base de cálculo.
 *
 * Subempreitada já tributada e material aplicado saem da base do ISS. É o caso
 * comum da construção civil — os mesmos subitens que exigem o grupo de obra.
 *
 * O XSD aceita um único entre percentual, valor e lista de documentos. A lista
 * de documentos não está implementada: exige detalhar cada nota abatida, e
 * nenhum município da nossa base pede isso hoje.
 */
export interface DpsDeducaoReducao {
  /** Percentual de redução sobre o valor do serviço. */
  percentual?: string;
  /** Valor absoluto a deduzir. */
  valor?: string;
}

/**
 * Tipos de imunidade do ISSQN (`tpImunidade`).
 *
 * Obrigatório quando `tributacaoISSQN` é '2' — a SEFIN recusa com E0592 sem
 * ele. Os incisos são do art. 150, VI da Constituição.
 */
export const IMUNIDADES_ISSQN = {
  '0': 'Imunidade — tipo não informado',
  '1': 'Patrimônio, renda ou serviços, uns dos outros (CF 150, VI, a)',
  '2': 'Templos de qualquer culto (CF 150, VI, b)',
  '3': 'Partidos políticos, entidades sindicais, instituições de educação e assistência social (CF 150, VI, c)',
  '4': 'Livros, jornais, periódicos e o papel destinado à sua impressão (CF 150, VI, d)',
  '5': 'Fonogramas e videofonogramas musicais brasileiros (CF 150, VI, e)',
} as const;

export type TipoImunidade = keyof typeof IMUNIDADES_ISSQN;

/**
 * Exigibilidade suspensa — quando há decisão judicial ou processo
 * administrativo suspendendo a cobrança do ISS.
 */
export interface DpsExigibilidadeSuspensa {
  /** 1 = decisão judicial, 2 = processo administrativo. */
  tipo: '1' | '2';
  /** Número do processo — exatamente 30 dígitos no XSD. */
  numeroProcesso: string;
}

/**
 * Benefício municipal.
 *
 * O `numero` não é escolhido pelo contribuinte: é o identificador que o
 * Sistema Nacional gerou quando o município cadastrou o benefício. Consultável
 * em `GET /parametrizacao/{municipio}/{numero}/{competencia}/beneficio`.
 */
export interface DpsBeneficioMunicipal {
  /** Identificador do benefício — 14 dígitos. */
  numero: string;
  /** Redução da base por valor. Exclusivo com `percentualReducao`. */
  valorReducao?: string;
  /** Redução da base por percentual. Exclusivo com `valorReducao`. */
  percentualReducao?: string;
}

export interface DpsValores {
  /** Valor do serviço prestado. */
  valorServico: string;
  valorRecebido?: string;
  descontoIncondicionado?: string;
  descontoCondicionado?: string;
  /**
   * Tributação do ISSQN: '1' tributável, '2' imunidade, '3' exportação,
   * '4' não incidência.
   */
  tributacaoISSQN: string;
  /** Obrigatório quando `tributacaoISSQN` é '2' (a SEFIN recusa com E0592). */
  tipoImunidade?: TipoImunidade;
  /** Decisão judicial ou processo administrativo suspendendo a cobrança. */
  exigibilidadeSuspensa?: DpsExigibilidadeSuspensa;
  /** Benefício concedido pelo município, com o identificador que ele gerou. */
  beneficioMunicipal?: DpsBeneficioMunicipal;
  /** Alíquota de ISS aplicada, em percentual. */
  aliquotaISS?: string;
  /**
   * Retenção do ISSQN — `tpRetISSQN` no XSD.
   *
   * **'1' = NÃO retido, '2' = retido pelo tomador, '3' = retido pelo
   * intermediário.** A polaridade é o contrário da intuição e o contrário do
   * `issRetido` de outros emissores, onde 1 costuma significar "sim, retido".
   * Trocar os dois inverte quem paga o ISS na nota — e nota com o tributo
   * atribuído a quem não deve não se corrige, se cancela.
   *
   * Quando é '2' ou '3', o endereço nacional do tomador passa a ser
   * obrigatório (a SEFIN recusa com E0237).
   */
  issRetido?: '1' | '2' | '3';
  /** Dedução ou redução da base do ISS. */
  deducaoReducao?: DpsDeducaoReducao;
  /** PIS/COFINS, INSS, IRRF e CSLL retidos. */
  tributosFederais?: DpsTributosFederais;
}

/**
 * IBS/CBS na NFS-e (Reforma Tributária).
 *
 * Não é o mesmo grupo da NF-e. Lá o IBS/CBS vai por item, com base e alíquotas;
 * aqui vai uma vez por nota, e o que se declara é a **situação tributária** —
 * as alíquotas quem calcula é o Sistema Nacional.
 *
 * O núcleo é o par CST + cClassTrib, os mesmos códigos usados na NF-e:
 * `000` / `000001` é tributação integral, o caso da maioria.
 */
export interface DpsIbsCbs {
  /**
   * Finalidade da NFS-e. Hoje o XSD só admite '0' (NFS-e regular) — é constante,
   * mas fica exposto porque a tabela deve crescer.
   */
  finalidade?: '0';
  /**
   * Código indicador da operação de fornecimento — 6 dígitos, da tabela do
   * Anexo VII. Não há enumeração no XSD, então o schema aceita qualquer número
   * de 6 dígitos e a validação real acontece no servidor.
   */
  codigoIndicadorOperacao: string;
  /** 0 = operação normal, 1 = uso ou consumo pessoal (art. 57). */
  usoConsumoPessoal?: '0' | '1';
  /**
   * 0 = o destinatário é o próprio tomador (caso comum),
   * 1 = o destinatário é outra pessoa ou outro estabelecimento.
   */
  indicadorDestinatario?: '0' | '1';
  /** CST do IBS/CBS — 3 dígitos. Padrão '000' (tributação integral). */
  cst?: string;
  /** Classificação tributária — 6 dígitos. Padrão '000001'. */
  classificacaoTributaria?: string;
  /** Código do crédito presumido, quando houver — 2 dígitos. */
  codigoCreditoPresumido?: string;
}

/**
 * Substituição de NFS-e.
 *
 * Vai na DPS da nota **nova**, e não como evento: a SEFIN recusa o e105102 no
 * `POST /nfse/{chave}/eventos` com E1861 ("não é aceito pelo método POST da API
 * Eventos"). Quem gera o evento de cancelamento por substituição é o Sistema
 * Nacional, ao autorizar a nota que declara a substituída.
 *
 * É o caminho quando o prazo de cancelamento do município já venceu.
 */
export interface DpsSubstituicao {
  /** Chave da NFS-e que está sendo substituída — 50 dígitos. */
  chaveSubstituida: string;
  /**
   * Justificativa — dois dígitos, `TSCodJustSubst`:
   * 01 desenquadramento do Simples, 02 enquadramento no Simples,
   * 03 inclusão retroativa de imunidade/isenção, 04 exclusão retroativa,
   * 05 rejeição pelo tomador ou intermediário, 99 outros.
   */
  motivo: string;
  /** Texto do motivo. Opcional aqui; se vier, vale o mínimo de 15 caracteres. */
  descricaoMotivo?: string;
}

export interface DpsContextInput {
  /** 1 = produção, 2 = homologação. */
  ambiente: '1' | '2';
  /** Série da DPS. */
  serie: string;
  /** Número sequencial da DPS. */
  numero: string;
  /** Data de emissão, ISO 8601 com fuso. */
  dataEmissao: string;
  /** Competência (mês de referência do serviço), AAAA-MM-DD. */
  competencia: string;
  /** Município emissor (IBGE) — normalmente o do prestador. */
  codigoMunicipioEmissor: string;
  /** 1 = prestador, 2 = tomador, 3 = intermediário. */
  tipoEmitente: '1' | '2' | '3';

  /**
   * Nota que esta DPS substitui. Preenchido só quando a emissão é para
   * substituir uma nota já autorizada.
   */
  substituicao?: DpsSubstituicao;

  prestador: DpsPrestador;
  tomador: DpsTomador;
  /** Quem intermediou o negócio, quando há. */
  intermediario?: DpsIntermediario;
  servico: DpsServico;
  valores: DpsValores;

  /**
   * IBS/CBS da Reforma Tributária. Opcional no XSD, e opcional na prática: a
   * obrigatoriedade da NFS-e estava marcada para 01/10/2026, mas o Ato Técnico
   * Conjunto RFB/CGIBS 1/2026 adiou as validações de IBS/CBS nos DF-e sem data
   * nova. Na NF-e a rejeição equivalente (1115) também está desativada.
   *
   * O dever de destacar continua; o que caiu foi a recusa automática. Vale a
   * mesma inversão da NF-e: informar o grupo atrai as regras de validação dele,
   * então grupo errado rejeita e grupo ausente, não.
   */
  ibsCbs?: DpsIbsCbs;

  /** Versão do aplicativo emissor, exigida pelo schema. */
  versaoAplicativo?: string;
}
