import { create } from 'xmlbuilder2';
import {
  DpsBeneficioMunicipal, DpsComercioExterior, DpsContextInput, DpsDeducaoReducao,
  DpsEndereco, DpsExigibilidadeSuspensa, DpsIbsCbs, DpsObra, DpsTributosFederais,
  DpsAtividadeEvento, DpsSubstituicao, DpsTomador, DpsValores,
  IMUNIDADES_ISSQN,
} from '../../domain/nfse/DpsContext';
import { MOTIVOS_SUBSTITUICAO } from './EventoNfseXmlGenerator';
import { validarServico } from '../../domain/nfse/RegrasServico';

const NFSE_NS = 'http://www.sped.fazenda.gov.br/nfse';
const VERSAO_DPS = '1.01';

/**
 * Situação tributária padrão do IBS/CBS: tributação integral.
 *
 * Mesmos códigos usados na NF-e (`FiscalContext`), porque a tabela é a mesma —
 * o que muda entre os dois documentos é onde o grupo entra e o que mais vai
 * com ele, não a classificação.
 */
export const IBSCBS_NFSE_PADRAO = {
  cst: '000',
  cClassTrib: '000001',
} as const;

/**
 * Gera o XML da Declaração de Prestação de Serviços (DPS).
 *
 * A ordem dos elementos segue o TCInfDPS do XSD oficial (tiposComplexos_v1.01):
 *
 *   tpAmb dhEmi verAplic serie nDPS dCompet tpEmit
 *   [cMotivoEmisTI] [chNFSeRej] cLocEmi
 *   [subst] prest toma [interm] serv valores [IBSCBS]
 *
 * Ordem trocada é rejeitada por schema, e a mensagem da SEFIN não aponta o
 * campo — mesma armadilha que a NF-e tem com o grupo IBS/CBS.
 *
 * A assinatura vai sobre `infDPS`, como na NF-e vai sobre `infNFe`. O Id do
 * infDPS é a referência da assinatura e também o identificador consultado em
 * `HEAD /dps/{id}` para saber se a nota já foi emitida.
 */
/**
 * Margem aplicada à data de emissão.
 *
 * A SEFIN recusa com E0008 quando a emissão é posterior ao processamento, e a
 * comparação não tolera o tempo de rede: enviar o instante exato falha mesmo
 * com o relógio local correto. Comprovado contra a produção restrita — sem
 * margem rejeita, com 60 s passa.
 */
const MARGEM_EMISSAO_MS = 60_000;

/**
 * Fuso em que a data de emissão é expressa.
 *
 * A SEFIN **ignora o rótulo de fuso** e compara a hora de parede como se fosse
 * de Brasília. Comprovado enviando o mesmo instante com dois rótulos: com
 * `+00:00` ela recusa por E0008 (emissão "no futuro"), com `-03:00` aceita.
 *
 * Isso torna o fuso do servidor relevante: o mesmo código que funciona numa
 * máquina em UTC-3 quebra em produção no Vercel, que roda em UTC. Por isso a
 * hora é convertida para Brasília aqui, e não tirada do relógio local.
 *
 * Usa a zona IANA em vez de fixar -03:00 para que uma eventual volta do horário
 * de verão seja tratada sem alterar código.
 */
const FUSO_NFSE = 'America/Sao_Paulo';

/** Componentes da hora de parede naquele fuso. */
function partesNoFuso(d: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_NFSE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const partes: Record<string, string> = {};
  for (const { type, value } of fmt.formatToParts(d)) partes[type] = value;
  return partes;
}

/** Deslocamento do fuso, em minutos, no instante dado. */
function offsetNoFuso(d: Date): number {
  const p = partesNoFuso(d);
  const comoSeFosseUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour), Number(p.minute), Number(p.second),
  );
  // Descarta os milissegundos do lado direito: Date.UTC acima não os tem.
  return Math.round((comoSeFosseUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/**
 * Data e hora de emissão no formato que a SEFIN aceita.
 *
 * Duas armadilhas, ambas confirmadas contra o ambiente real:
 *
 * 1. A hora tem que ser a de Brasília, porque a SEFIN não honra o rótulo de
 *    fuso — ver o comentário de `FUSO_NFSE`.
 * 2. Mesmo com o horário certo, o instante exato é recusado. Daí a margem.
 */
export function gerarDhEmiDps(referencia: Date = new Date()): string {
  const agora = new Date(referencia.getTime() - MARGEM_EMISSAO_MS);
  const p = partesNoFuso(agora);
  const off = offsetNoFuso(agora);
  const sinal = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sinal}${hh}:${mm}`;
}

/**
 * Valor decimal no formato que o XSD aceita.
 *
 * Os tipos `TSDec15V2`, `TSDec2V2` e companhia não são "número com casas
 * decimais": o padrão é `0|0\.[0-9]{2}|[1-9]{1}[0-9]{0,N}(\.[0-9]{2})?`. Isso
 * recusa três coisas que aparecem naturalmente em dado de ERP —
 * `100.5` (uma casa só), `0100.00` (zero à esquerda) e `100.567` (três casas).
 * A recusa vem como E1235, que não diz o campo.
 *
 * Aceita vírgula decimal porque é o que o operador digita, e arredonda a
 * terceira casa em vez de truncar: truncar perde centavo, e centavo perdido em
 * nota fiscal é divergência de conciliação.
 */
export function decimalDps(valor: unknown, campo = 'valor'): string | undefined {
  if (valor === undefined || valor === null || String(valor).trim() === '') return undefined;

  let s = String(valor).trim();
  // "1.234,56" e "1234,56" viram "1234.56"; ponto sozinho já é decimal.
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');

  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(
      `NFSE_VALOR_INVALIDO: ${campo} = "${valor}" — informe um número positivo, `
      + 'com ponto ou vírgula decimal. Valor negativo não existe no DPS.',
    );
  }

  const [inteiraCru, decimalCru = ''] = s.split('.');

  // Arredonda para 2 casas sem passar por float, que perderia precisão em
  // valores grandes.
  let inteira = inteiraCru;
  let centavos = (decimalCru + '00').slice(0, 2);
  const terceira = decimalCru.charAt(2);
  if (terceira && Number(terceira) >= 5) {
    const somado = String(Number(inteira) * 100 + Number(centavos) + 1).padStart(3, '0');
    inteira = somado.slice(0, -2);
    centavos = somado.slice(-2);
  }

  inteira = inteira.replace(/^0+(?=\d)/, '');
  if (inteira.length > 15) {
    throw new Error(`NFSE_VALOR_INVALIDO: ${campo} = "${valor}" — no máximo 15 dígitos na parte inteira.`);
  }

  return `${inteira}.${centavos}`;
}

/**
 * Competência é o primeiro dia do mês de referência do serviço.
 *
 * Também no fuso de Brasília: num servidor em UTC, as 21h do último dia do mês
 * já são o dia 1º do mês seguinte, e a nota sairia com a competência errada —
 * o que joga o ISS para a apuração do mês que não é.
 */
export function gerarCompetencia(agora: Date = new Date()): string {
  const p = partesNoFuso(agora);
  return `${p.year}-${p.month}-01`;
}

/**
 * Série e número só existem como dígitos.
 *
 * O Id do infDPS sempre foi montado com os não-dígitos removidos; se `nDPS` e
 * `serie` saíssem crus, o identificador da nota e o corpo dela poderiam
 * discordar — e um valor inválido só apareceria como E1235 lá na SEFIN, que não
 * diz qual campo está errado. Normaliza uma vez e usa nos dois lugares.
 */
function soDigitos(valor: string): string {
  return String(valor ?? '').replace(/\D/g, '');
}

/**
 * Número da DPS — dígitos, sem zero à esquerda.
 *
 * `TSNumDPS` é `[1-9]{1}[0-9]{0,14}`: "00123" é recusado por schema, e o
 * E1235 que volta não diz qual campo. O Id do infDPS continua com o número
 * preenchido em 15 posições, que é outro formato — por isso a normalização
 * acontece aqui e o preenchimento lá.
 */
function normalizarNumeroDps(valor: string): string {
  const n = soDigitos(valor).replace(/^0+/, '');
  if (!n) {
    throw new Error(
      `NFSE_NUMERO_INVALIDO: "${valor}" — o número da DPS vai de 1 a 999999999999999, sem zero à esquerda.`,
    );
  }
  if (n.length > 15) {
    throw new Error(`NFSE_NUMERO_INVALIDO: "${valor}" — o número da DPS tem no máximo 15 dígitos.`);
  }
  return n;
}

/**
 * Série — dígitos, mas nunca só zeros.
 *
 * `TSSerieDPS` aceita zero à esquerda (`001` é válido) e proíbe o valor
 * inteiramente zerado. É a regra oposta à do número, no campo ao lado.
 */
function normalizarSerie(valor: string): string {
  const s = soDigitos(valor);
  if (!s || !/[1-9]/.test(s)) {
    throw new Error(`NFSE_SERIE_INVALIDA: "${valor}" — a série tem de 1 a 5 dígitos e não pode ser zero.`);
  }
  if (s.length > 5) {
    throw new Error(`NFSE_SERIE_INVALIDA: "${valor}" — a série tem no máximo 5 dígitos.`);
  }
  return s;
}

export class DpsXmlGenerator {
  /**
   * Monta o Id do infDPS conforme a regra do Sistema Nacional:
   * 'DPS' + código do município (7) + tipo de inscrição (1) + inscrição (14,
   * à esquerda com zeros) + série (5) + número (15).
   */
  static montarId(input: DpsContextInput): string {
    const cnpj = soDigitos(input.prestador.cnpj);
    const tipoInscricao = cnpj.length === 14 ? '2' : '1';
    return 'DPS'
      + soDigitos(input.codigoMunicipioEmissor).padStart(7, '0')
      + tipoInscricao
      + cnpj.padStart(14, '0')
      + normalizarSerie(input.serie).padStart(5, '0')
      + normalizarNumeroDps(input.numero).padStart(15, '0');
  }

  gerar(input: DpsContextInput): string {
    const id = DpsXmlGenerator.montarId(input);

    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('DPS', { xmlns: NFSE_NS, versao: VERSAO_DPS });

    const inf = doc.ele('infDPS', { Id: id });

    inf.ele('tpAmb').txt(input.ambiente).up();
    inf.ele('dhEmi').txt(input.dataEmissao).up();
    inf.ele('verAplic').txt(input.versaoAplicativo || 'NFeEngine-1.0').up();
    inf.ele('serie').txt(normalizarSerie(input.serie)).up();
    inf.ele('nDPS').txt(normalizarNumeroDps(input.numero)).up();
    inf.ele('dCompet').txt(input.competencia).up();
    inf.ele('tpEmit').txt(input.tipoEmitente).up();
    inf.ele('cLocEmi').txt(input.codigoMunicipioEmissor).up();

    // subst vem depois de cLocEmi e antes de prest (TCInfDPS).
    this.addSubstituicao(inf, input.substituicao);
    this.addPrestador(inf, input);
    this.addTomador(inf, input);
    // interm vem entre toma e serv (TCInfDPS).
    this.addIntermediario(inf, input.intermediario);
    this.addServico(inf, input);
    this.addValores(inf, input);
    this.addIbsCbs(inf, input.ibsCbs);

    inf.up();
    return doc.end({ prettyPrint: false });
  }

  /**
   * `subst` — a nota que esta DPS substitui.
   *
   * A substituição não é um evento que se envia: a SEFIN recusa o e105102 no
   * POST de eventos com E1861. Declara-se aqui, na nota nova, e o Sistema
   * Nacional gera o evento de cancelamento por substituição ao autorizar.
   */
  private addSubstituicao(parent: any, s?: DpsSubstituicao): void {
    if (!s) return;

    const chave = String(s.chaveSubstituida ?? '').replace(/\D/g, '');
    if (chave.length !== 50) {
      throw new Error(
        `NFSE_SUBSTITUIDA_INVALIDA: "${s.chaveSubstituida}" — a chave da NFS-e substituída tem `
        + `50 dígitos (a da NF-e tem 44). Recebida com ${chave.length}.`,
      );
    }
    if (!(s.motivo in MOTIVOS_SUBSTITUICAO)) {
      throw new Error(
        `NFSE_MOTIVO_SUBST_INVALIDO: "${s.motivo}" — os códigos de substituição têm dois dígitos, `
        + `diferente do cancelamento comum. Opções: ${
          Object.entries(MOTIVOS_SUBSTITUICAO).map(([k, d]) => `${k} = ${d}`).join('; ')}`,
      );
    }

    const texto = (s.descricaoMotivo || '').trim();
    if (texto && texto.length < 15) {
      throw new Error(
        `NFSE_MOTIVO_SUBST_CURTO: a descrição do motivo tem ${texto.length} caracteres e o mínimo `
        + 'é 15. Deixe vazio se não quiser descrever — o campo é opcional.',
      );
    }

    const el = parent.ele('subst');
    el.ele('chSubstda').txt(chave).up();
    el.ele('cMotivo').txt(s.motivo).up();
    if (texto) el.ele('xMotivo').txt(texto).up();
    el.up();
  }

  /** `prest` — quem presta o serviço. CNPJ/CPF/NIF são um choice: só um. */
  private addPrestador(parent: any, input: DpsContextInput): void {
    const p = input.prestador;
    const el = parent.ele('prest');

    el.ele('CNPJ').txt(p.cnpj.replace(/\D/g, '')).up();
    this.addOpt(el, 'IM', p.im);
    this.addOpt(el, 'xNome', p.razaoSocial);
    if (p.endereco) this.addEndereco(el, p.endereco);
    this.addOpt(el, 'fone', p.fone?.replace(/\D/g, ''));
    this.addOpt(el, 'email', p.email);

    // regTrib é obrigatório: sem ele o schema recusa mesmo com todo o resto certo.
    const reg = el.ele('regTrib');
    reg.ele('opSimpNac').txt(p.opSimplesNacional).up();
    // Regime de apuração só se aplica a optante ME/EPP (opSimpNac = 3).
    if (p.opSimplesNacional === '3') {
      this.addOpt(reg, 'regApTribSN', p.regimeApuracaoSN || '1');
    }
    reg.ele('regEspTrib').txt(p.regimeEspecial).up();
    reg.up();

    el.up();
  }

  /** `toma` — quem recebe o serviço. */
  private addTomador(parent: any, input: DpsContextInput): void {
    this.addPessoa(parent, 'toma', input.tomador);
  }

  /**
   * `interm` — quem intermediou o negócio.
   *
   * Mesma estrutura do tomador: os dois são `TCInfoPessoa` no XSD.
   */
  private addIntermediario(parent: any, i?: DpsTomador): void {
    if (!i) return;
    this.addPessoa(parent, 'interm', i);
  }

  /** Estrutura comum de tomador e intermediário (`TCInfoPessoa`). */
  private addPessoa(parent: any, tag: string, t: DpsTomador): void {
    const el = parent.ele(tag);

    if (t.cnpj) el.ele('CNPJ').txt(t.cnpj.replace(/\D/g, '')).up();
    else if (t.cpf) el.ele('CPF').txt(t.cpf.replace(/\D/g, '')).up();
    else if (t.nif) el.ele('NIF').txt(t.nif).up();

    this.addOpt(el, 'IM', t.im);
    el.ele('xNome').txt(t.razaoSocial).up();
    if (t.endereco) this.addEndereco(el, t.endereco);
    this.addOpt(el, 'fone', t.fone?.replace(/\D/g, ''));
    this.addOpt(el, 'email', t.email);

    el.up();
  }

  /**
   * Endereço: o choice endNac/endExt vem ANTES de logradouro, número e bairro.
   * Colocar o município depois do logradouro — que é a ordem intuitiva — é
   * rejeitado.
   */
  private addEndereco(parent: any, e: DpsEndereco): void {
    const el = parent.ele('end');
    const nac = el.ele('endNac');
    nac.ele('cMun').txt(e.codigoMunicipio.replace(/\D/g, '')).up();
    nac.ele('CEP').txt(e.cep.replace(/\D/g, '')).up();
    nac.up();

    el.ele('xLgr').txt(e.logradouro).up();
    el.ele('nro').txt(e.numero).up();
    this.addOpt(el, 'xCpl', e.complemento);
    el.ele('xBairro').txt(e.bairro).up();
    el.up();
  }

  /** `serv` — o que foi prestado e onde. */
  private addServico(parent: any, input: DpsContextInput): void {
    const s = input.servico;
    validarServico(s.codigoTributacaoNacional, Boolean(s.obra));

    // Exportação de serviço exige o grupo de comércio exterior. Sem isso a
    // SEFIN recusa com E0330, e o operador que escolheu "Exportação" na tela
    // não tem como adivinhar o que faltou.
    if (input.valores.tributacaoISSQN === '3' && !s.comercioExterior) {
      throw new Error(
        'NFSE_EXPORTACAO_SEM_COMEXT: exportação de serviço (tributacaoISSQN "3") exige o grupo '
        + 'de comércio exterior em servico.comercioExterior. A SEFIN recusa com E0330.',
      );
    }
    if (input.valores.tributacaoISSQN !== '3' && s.comercioExterior) {
      throw new Error(
        `NFSE_COMEXT_INDEVIDO: o grupo de comércio exterior só vale na exportação `
        + `(tributacaoISSQN "3"); veio "${input.valores.tributacaoISSQN}".`,
      );
    }

    const el = parent.ele('serv');

    const loc = el.ele('locPrest');
    loc.ele('cLocPrestacao').txt(s.codigoMunicipioPrestacao.replace(/\D/g, '')).up();
    loc.up();

    const c = el.ele('cServ');
    c.ele('cTribNac').txt(s.codigoTributacaoNacional.replace(/\D/g, '')).up();
    if (s.codigoTributacaoMunicipal) {
      c.ele('cTribMun').txt(s.codigoTributacaoMunicipal.replace(/\D/g, '')).up();
    }
    c.ele('xDescServ').txt(s.descricao).up();
    // cNBS é obrigatório no schema, mesmo quando o município não usa.
    c.ele('cNBS').txt((s.codigoNBS || '').replace(/\D/g, '') || '000000000').up();
    this.addOpt(c, 'cIntContrib', s.codigoInterno);
    c.up();

    // Ordem do TCServ em produção: locPrest, cServ, comExt, obra, atvEvento,
    // infoCompl.
    //
    // O XSD publicado traz também `explRod` (pedágio), mas o schema em produção
    // não conhece o elemento: ele lista os aceitos na mensagem de erro e
    // `explRod` não está lá. Chegou a ser implementado e foi removido — deixar
    // um campo que garante rejeição é pior do que não ter o campo.
    if (s.comercioExterior) this.addComercioExterior(el, s.comercioExterior);
    if (s.obra) this.addObra(el, s.obra);
    this.addAtividadeEvento(el, s.atividadeEvento);

    if (s.informacoesComplementares) {
      const ic = el.ele('infoCompl');
      ic.ele('xInfComp').txt(s.informacoesComplementares).up();
      ic.up();
    }

    el.up();
  }

  /**
   * `comExt` — comércio exterior, obrigatório na exportação de serviço.
   *
   * Todos os campos do grupo são obrigatórios no XSD. Ordem: mdPrestacao,
   * vincPrest, tpMoeda, vServMoeda, mecAFComexP, mecAFComexT, movTempBens,
   * [nDI], [nRE], mdic.
   */
  private addComercioExterior(parent: any, ce: DpsComercioExterior): void {
    const faltando = ([
      ['modoPrestacao', ce.modoPrestacao],
      ['vinculoEntrePartes', ce.vinculoEntrePartes],
      ['codigoMoeda', ce.codigoMoeda],
      ['valorMoedaEstrangeira', ce.valorMoedaEstrangeira],
      ['mecanismoFomentoPrestador', ce.mecanismoFomentoPrestador],
      ['mecanismoFomentoTomador', ce.mecanismoFomentoTomador],
      ['movimentacaoTemporaria', ce.movimentacaoTemporaria],
      ['compartilharComMdic', ce.compartilharComMdic],
    ] as const).filter(([, valor]) => valor === undefined || valor === null || String(valor).trim() === '')
      .map(([nome]) => nome);

    if (faltando.length) {
      throw new Error(
        `NFSE_COMEXT_INCOMPLETO: o grupo de comércio exterior exige todos os campos. `
        + `Faltando: ${faltando.join(', ')}.`,
      );
    }

    const moeda = String(ce.codigoMoeda).replace(/\D/g, '');
    if (moeda.length !== 3) {
      throw new Error(
        `NFSE_MOEDA_INVALIDA: "${ce.codigoMoeda}" — o código da moeda tem 3 dígitos `
        + '(tabela do BACEN; dólar dos EUA é 220).',
      );
    }

    const el = parent.ele('comExt');
    el.ele('mdPrestacao').txt(ce.modoPrestacao).up();
    el.ele('vincPrest').txt(ce.vinculoEntrePartes).up();
    el.ele('tpMoeda').txt(moeda).up();
    el.ele('vServMoeda').txt(decimalDps(ce.valorMoedaEstrangeira, 'valorMoedaEstrangeira')!).up();
    el.ele('mecAFComexP').txt(String(ce.mecanismoFomentoPrestador).padStart(2, '0')).up();
    el.ele('mecAFComexT').txt(String(ce.mecanismoFomentoTomador).padStart(2, '0')).up();
    el.ele('movTempBens').txt(ce.movimentacaoTemporaria).up();
    this.addOpt(el, 'nDI', ce.numeroDeclaracaoImportacao);
    this.addOpt(el, 'nRE', ce.numeroRegistroExportacao);
    el.ele('mdic').txt(ce.compartilharComMdic).up();
    el.up();
  }

  /**
   * `atvEvento` — atividade em evento artístico, cultural ou esportivo.
   *
   * O XSD exige o código do evento na prefeitura **ou** o endereço onde
   * aconteceu, nunca os dois.
   */
  private addAtividadeEvento(parent: any, a?: DpsAtividadeEvento): void {
    if (!a) return;

    for (const [campo, valor] of [['nome', a.nome], ['dataInicio', a.dataInicio], ['dataFim', a.dataFim]]) {
      if (!String(valor ?? '').trim()) {
        throw new Error(`NFSE_EVENTO_INCOMPLETO: informe ${campo} na atividade de evento.`);
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(a.dataFim)) {
      throw new Error(
        'NFSE_EVENTO_DATA_INVALIDA: as datas do evento vão no formato AAAA-MM-DD.',
      );
    }
    if (a.dataFim < a.dataInicio) {
      throw new Error(
        `NFSE_EVENTO_PERIODO_INVALIDO: o fim (${a.dataFim}) é anterior ao início (${a.dataInicio}).`,
      );
    }
    if (!a.codigoEvento && !a.endereco) {
      throw new Error(
        'NFSE_EVENTO_SEM_IDENTIFICACAO: informe o código do evento na prefeitura ou o endereço '
        + 'onde ele aconteceu. O XSD exige um dos dois.',
      );
    }
    if (a.codigoEvento && a.endereco) {
      throw new Error(
        'NFSE_EVENTO_AMBIGUO: informe o código do evento OU o endereço, não os dois.',
      );
    }

    const el = parent.ele('atvEvento');
    el.ele('xNome').txt(a.nome).up();
    el.ele('dtIni').txt(a.dataInicio).up();
    el.ele('dtFim').txt(a.dataFim).up();

    if (a.codigoEvento) {
      el.ele('idAtvEvt').txt(a.codigoEvento).up();
    } else {
      const e = el.ele('end');
      e.ele('CEP').txt(a.endereco!.cep.replace(/\D/g, '')).up();
      e.ele('xLgr').txt(a.endereco!.logradouro).up();
      e.ele('nro').txt(a.endereco!.numero).up();
      this.addOpt(e, 'xCpl', a.endereco!.complemento);
      e.ele('xBairro').txt(a.endereco!.bairro).up();
      e.up();
    }
    el.up();
  }

  /**
   * `obra` — identificação da obra nos serviços de construção civil.
   *
   * O XSD exige exatamente um entre cObra, cCIB e end. Quando a obra não tem
   * cadastro, o endereço resolve — e é o caso comum de quem presta serviço em
   * residência. Note que aqui o endereço é o TCEnderObraEvento, que começa pelo
   * CEP e não tem município: é mais enxuto que o endereço das pessoas.
   */
  private addObra(parent: any, o: DpsObra): void {
    const el = parent.ele('obra');
    this.addOpt(el, 'inscImobFisc', o.inscricaoImobiliariaFiscal);

    if (o.codigoObra) {
      el.ele('cObra').txt(o.codigoObra.replace(/\D/g, '')).up();
    } else if (o.codigoCIB) {
      el.ele('cCIB').txt(o.codigoCIB.replace(/\D/g, '')).up();
    } else if (o.endereco) {
      const e = el.ele('end');
      e.ele('CEP').txt(o.endereco.cep.replace(/\D/g, '')).up();
      e.ele('xLgr').txt(o.endereco.logradouro).up();
      e.ele('nro').txt(o.endereco.numero).up();
      this.addOpt(e, 'xCpl', o.endereco.complemento);
      e.ele('xBairro').txt(o.endereco.bairro).up();
      e.up();
    } else {
      throw new Error(
        'NFSE_OBRA_INCOMPLETA: informe o CNO/CEI, o CIB ou o endereço da obra. '
        + 'Serviços de construção civil são recusados sem um deles (E0370).',
      );
    }

    el.up();
  }

  /**
   * `valores` — o quanto, e como é tributado.
   *
   * Ordem do TCInfoValores: vServPrest, vDescCondIncond, vDedRed, trib.
   * Dentro de `trib`: tribMun, tribFed, totTrib.
   */
  private addValores(parent: any, input: DpsContextInput): void {
    const v = input.valores;
    const el = parent.ele('valores');

    const vs = el.ele('vServPrest');
    this.addOpt(vs, 'vReceb', decimalDps(v.valorRecebido, 'valorRecebido'));
    vs.ele('vServ').txt(decimalDps(v.valorServico, 'valorServico')!).up();
    vs.up();

    if (v.descontoIncondicionado || v.descontoCondicionado) {
      const d = el.ele('vDescCondIncond');
      this.addOpt(d, 'vDescIncond', decimalDps(v.descontoIncondicionado, 'descontoIncondicionado'));
      this.addOpt(d, 'vDescCond', decimalDps(v.descontoCondicionado, 'descontoCondicionado'));
      d.up();
    }

    this.addDeducaoReducao(el, v.deducaoReducao);

    const trib = el.ele('trib');

    // tpRetISSQN: 1 = NÃO retido (padrão), 2 = retido pelo tomador,
    // 3 = retido pelo intermediário. A polaridade é contra-intuitiva.
    const retencao = v.issRetido || '1';
    if (!['1', '2', '3'].includes(retencao)) {
      throw new Error(
        `NFSE_RETENCAO_ISS_INVALIDA: "${retencao}" — use "1" para NÃO retido, `
        + '"2" para retido pelo tomador ou "3" para retido pelo intermediário.',
      );
    }
    // Retido exige o endereço do tomador. Barrar aqui evita o E0237, que fala
    // de retenção e por isso confunde quem não pediu retenção nenhuma.
    if (retencao !== '1' && !input.tomador.endereco) {
      throw new Error(
        'NFSE_TOMADOR_SEM_ENDERECO: com ISSQN retido (issRetido "2" ou "3") o endereço '
        + 'nacional do tomador é obrigatório. A SEFIN recusa com E0237.',
      );
    }

    this.addTribMunicipal(trib, v, retencao);

    this.addTributosFederais(trib, v.tributosFederais);

    // totTrib é um choice. indTotTrib = 0 declara que o total de tributos não
    // está sendo informado — permitido pela Lei 12.741 quando não há apuração.
    const tot = trib.ele('totTrib');
    tot.ele('indTotTrib').txt('0').up();
    tot.up();

    trib.up();
    el.up();
  }

  /**
   * `tribMun` — o ISSQN propriamente dito.
   *
   * Ordem do TCTribMunicipal: tribISSQN, [cPaisResult], [tpImunidade],
   * [exigSusp], [BM], tpRetISSQN, [pAliq]. Note que a retenção vem **depois**
   * dos grupos opcionais, e não logo após a tributação.
   */
  private addTribMunicipal(parent: any, v: DpsValores, retencao: string): void {
    const el = parent.ele('tribMun');
    el.ele('tribISSQN').txt(v.tributacaoISSQN).up();

    // Imunidade sem o tipo é recusada com E0592 — e o tipo em operação
    // tributável também, porque o campo é "somente para o caso de imunidade".
    if (v.tributacaoISSQN === '2') {
      if (!v.tipoImunidade) {
        throw new Error(
          'NFSE_IMUNIDADE_SEM_TIPO: com tributacaoISSQN "2" (imunidade) o tipo é obrigatório. '
          + `Informe tipoImunidade de "0" a "5" — a SEFIN recusa com E0592. Opções: ${
            Object.entries(IMUNIDADES_ISSQN).map(([k, d]) => `${k} = ${d}`).join('; ')}`,
        );
      }
      if (!IMUNIDADES_ISSQN[v.tipoImunidade]) {
        throw new Error(`NFSE_IMUNIDADE_INVALIDA: "${v.tipoImunidade}" — use "0" a "5".`);
      }
      el.ele('tpImunidade').txt(v.tipoImunidade).up();
    } else if (v.tipoImunidade) {
      throw new Error(
        `NFSE_IMUNIDADE_INDEVIDA: tipoImunidade só vale com tributacaoISSQN "2"; `
        + `veio "${v.tributacaoISSQN}".`,
      );
    }

    this.addExigibilidadeSuspensa(el, v.exigibilidadeSuspensa);
    this.addBeneficioMunicipal(el, v.beneficioMunicipal);

    el.ele('tpRetISSQN').txt(retencao).up();
    this.addOpt(el, 'pAliq', decimalDps(v.aliquotaISS, 'aliquotaISS'));
    el.up();
  }

  /** `exigSusp` — suspensão da cobrança por decisão judicial ou processo. */
  private addExigibilidadeSuspensa(parent: any, e?: DpsExigibilidadeSuspensa): void {
    if (!e) return;

    if (e.tipo !== '1' && e.tipo !== '2') {
      throw new Error(
        `NFSE_EXIGSUSP_TIPO_INVALIDO: "${e.tipo}" — use "1" para decisão judicial `
        + 'ou "2" para processo administrativo.',
      );
    }
    // TSNumProcExigSuspensa é [0-9]{30}, exatamente. Número de processo do CNJ
    // tem 20 dígitos, então costuma faltar preenchimento à esquerda.
    const processo = String(e.numeroProcesso ?? '').replace(/\D/g, '');
    if (!processo || processo.length > 30) {
      throw new Error(
        `NFSE_EXIGSUSP_PROCESSO_INVALIDO: "${e.numeroProcesso}" — o número do processo tem `
        + '30 dígitos no XSD. O número do CNJ tem 20 e é completado com zeros à esquerda.',
      );
    }

    const el = parent.ele('exigSusp');
    el.ele('tpSusp').txt(e.tipo).up();
    el.ele('nProcesso').txt(processo.padStart(30, '0')).up();
    el.up();
  }

  /**
   * `BM` — benefício municipal.
   *
   * O número não é escolhido pelo contribuinte: é o identificador que o Sistema
   * Nacional gerou quando o município cadastrou o benefício. A redução é um
   * choice — valor ou percentual, nunca os dois.
   */
  private addBeneficioMunicipal(parent: any, b?: DpsBeneficioMunicipal): void {
    if (!b) return;

    const numero = String(b.numero ?? '').replace(/\D/g, '');
    if (numero.length !== 14) {
      throw new Error(
        `NFSE_BENEFICIO_INVALIDO: "${b.numero}" — o identificador do benefício municipal tem `
        + '14 dígitos e é gerado pelo Sistema Nacional, não escolhido pelo emitente. '
        + 'Consulte em GET /parametrizacao/{municipio}/{numero}/{competencia}/beneficio.',
      );
    }

    const valor = decimalDps(b.valorReducao, 'beneficioMunicipal.valorReducao');
    const pct = decimalDps(b.percentualReducao, 'beneficioMunicipal.percentualReducao');
    if (valor && pct) {
      throw new Error(
        'NFSE_BENEFICIO_AMBIGUO: informe valorReducao OU percentualReducao no benefício '
        + 'municipal, não os dois. O XSD aceita apenas um.',
      );
    }

    const el = parent.ele('BM');
    el.ele('nBM').txt(numero).up();
    if (valor) el.ele('vRedBCBM').txt(valor).up();
    else if (pct) el.ele('pRedBCBM').txt(pct).up();
    el.up();
  }

  /**
   * `vDedRed` — dedução ou redução da base.
   *
   * O XSD é um choice: percentual OU valor, nunca os dois. Enviar ambos é
   * rejeitado por schema, então recusa aqui, onde a mensagem diz o motivo.
   */
  private addDeducaoReducao(parent: any, d?: DpsDeducaoReducao): void {
    if (!d) return;

    const pct = decimalDps(d.percentual, 'deducaoReducao.percentual');
    const val = decimalDps(d.valor, 'deducaoReducao.valor');
    if (!pct && !val) return;

    if (pct && val) {
      throw new Error(
        'NFSE_DEDUCAO_AMBIGUA: informe percentual OU valor na dedução/redução, não os dois. '
        + 'O XSD aceita apenas um.',
      );
    }

    const el = parent.ele('vDedRed');
    if (pct) el.ele('pDR').txt(pct).up();
    else el.ele('vDR').txt(val!).up();
    el.up();
  }

  /**
   * `tribFed` — retenções federais.
   *
   * Ordem: piscofins, vRetCP, vRetIRRF, vRetCSLL. O `vRetCP` é a contribuição
   * previdenciária (INSS) — o nome no XSD não deixa isso óbvio.
   *
   * PIS e COFINS andam juntos num grupo único com CST comum, diferente da NF-e,
   * onde cada um tem o seu grupo e o CST decide qual estrutura usar.
   */
  private addTributosFederais(parent: any, f?: DpsTributosFederais): void {
    if (!f) return;

    const inss = decimalDps(f.valorRetidoINSS, 'valorRetidoINSS');
    const irrf = decimalDps(f.valorRetidoIRRF, 'valorRetidoIRRF');
    const csll = decimalDps(f.valorRetidoCSLL, 'valorRetidoCSLL');
    if (!f.pisCofins && !inss && !irrf && !csll) return;

    const el = parent.ele('tribFed');

    if (f.pisCofins) {
      const p = f.pisCofins;
      if (!/^0[0-9]$/.test(p.cst)) {
        throw new Error(
          `NFSE_CST_PISCOFINS_INVALIDO: "${p.cst}" — o CST do PIS/COFINS vai de "00" a "09", `
          + 'com dois dígitos. Use "00" quando não houver incidência a declarar.',
        );
      }
      const g = el.ele('piscofins');
      g.ele('CST').txt(p.cst).up();
      this.addOpt(g, 'vBCPisCofins', decimalDps(p.baseCalculo, 'pisCofins.baseCalculo'));
      this.addOpt(g, 'pAliqPis', decimalDps(p.aliquotaPis, 'pisCofins.aliquotaPis'));
      this.addOpt(g, 'pAliqCofins', decimalDps(p.aliquotaCofins, 'pisCofins.aliquotaCofins'));
      this.addOpt(g, 'vPis', decimalDps(p.valorPis, 'pisCofins.valorPis'));
      this.addOpt(g, 'vCofins', decimalDps(p.valorCofins, 'pisCofins.valorCofins'));
      this.addOpt(g, 'tpRetPisCofins', p.retido);
      g.up();
    }

    this.addOpt(el, 'vRetCP', inss);
    this.addOpt(el, 'vRetIRRF', irrf);
    this.addOpt(el, 'vRetCSLL', csll);

    el.up();
  }

  /**
   * `IBSCBS` — Reforma Tributária, último elemento do infDPS.
   *
   * Estrutura bem diferente da NF-e: lá o grupo vai por item com base e
   * alíquotas; aqui vai uma vez por nota e declara só a situação tributária —
   * quem calcula é o Sistema Nacional.
   *
   * Ordem do TCRTCInfoIBSCBS: finNFSe, [indFinal], cIndOp, [tpOper],
   * [gRefNFSe], [tpEnteGov], indDest, [dest], [imovel], valores.
   */
  private addIbsCbs(parent: any, g?: DpsIbsCbs): void {
    if (!g) return;

    const cIndOp = String(g.codigoIndicadorOperacao ?? '').replace(/\D/g, '');
    if (cIndOp.length !== 6) {
      throw new Error(
        `NFSE_CINDOP_INVALIDO: "${g.codigoIndicadorOperacao}" — o código indicador da operação `
        + 'tem 6 dígitos e vem da tabela do Anexo VII.',
      );
    }

    const cst = (g.cst ?? IBSCBS_NFSE_PADRAO.cst).replace(/\D/g, '');
    const cClassTrib = (g.classificacaoTributaria ?? IBSCBS_NFSE_PADRAO.cClassTrib).replace(/\D/g, '');
    if (cst.length !== 3) {
      throw new Error(`NFSE_CST_IBSCBS_INVALIDO: "${g.cst}" — o CST do IBS/CBS tem 3 dígitos.`);
    }
    if (cClassTrib.length !== 6) {
      throw new Error(
        `NFSE_CCLASSTRIB_INVALIDO: "${g.classificacaoTributaria}" — a classificação tributária tem 6 dígitos.`,
      );
    }

    const el = parent.ele('IBSCBS');
    el.ele('finNFSe').txt(g.finalidade ?? '0').up();
    this.addOpt(el, 'indFinal', g.usoConsumoPessoal);
    el.ele('cIndOp').txt(cIndOp).up();
    el.ele('indDest').txt(g.indicadorDestinatario ?? '0').up();

    const valores = el.ele('valores');
    const trib = valores.ele('trib');
    const gIbsCbs = trib.ele('gIBSCBS');
    gIbsCbs.ele('CST').txt(cst).up();
    gIbsCbs.ele('cClassTrib').txt(cClassTrib).up();
    this.addOpt(gIbsCbs, 'cCredPres', g.codigoCreditoPresumido);
    gIbsCbs.up();
    trib.up();
    valores.up();

    el.up();
  }

  private addOpt(parent: any, nome: string, valor?: string): void {
    if (valor !== undefined && valor !== null && String(valor).trim() !== '') {
      parent.ele(nome).txt(String(valor)).up();
    }
  }
}
