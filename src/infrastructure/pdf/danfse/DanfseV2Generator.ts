/**
 * DANFSe v2.0 — Nota Técnica nº 008/2026 (SE/CGNFS-e), de 05/05/2026.
 *
 * Contexto: até 1º de julho de 2026 quem gerava o PDF era a API do ambiente
 * nacional (`adn.nfse.gov.br/danfse`). A NT sobrestou essa API — desde então,
 * gerar o documento é obrigação de quem emite.
 *
 * O desenho é por coordenada absoluta, lida de `grade.ts`, que é a transcrição
 * literal da tabela do item 2.4.5. **Nada de posição é calculado aqui**: cada
 * célula sai onde a NT manda. A primeira versão deste arquivo derivava as
 * linhas por soma (`sup + 0,64`) e desenhava os títulos de bloco como faixa
 * acima do bloco — as duas coisas produziram campos sobrepostos, porque as
 * linhas da NT não têm passo constante e o título é célula da coluna 1.
 *
 * Duas regras da NT que atravessam o arquivo:
 *
 *  - "Não poderão ser impressas informações que não constem do arquivo da
 *    NFS-e" (item 2.1). Nada é apurado aqui; o que falta vira traço.
 *  - "O DANFSe deverá ser impresso, obrigatoriamente, em uma única página"
 *    (item 2.2). Texto longo é truncado com reticências, como a NT manda.
 */

import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import {
  ALT, BLOCOS, CAMPOS_CANHOTO, CAMPOS_DESTINATARIO, CAMPOS_FEDERAL,
  CAMPOS_IBSCBS, CAMPOS_IDENT, CAMPOS_INTERMEDIARIO, CAMPOS_ISSQN,
  CAMPOS_PRESTADOR, CAMPOS_SERVICO, CAMPOS_TOMADOR, CAMPOS_TOTAIS,
  CINZA_5, COL, FAIXA_AUSENTE, FONTE, LARG, PAPEL, QRCODE, TRACO, VAZIO,
  linhaTotaisAproximados, type Campo,
} from './grade';
import { lerDanfse, type DanfseDados, type Parte } from './LeitorDanfse';
import { municipioUf } from '../../../domain/ibge';

/** Centímetro para ponto — a unidade do PDF. A NT mede tudo em cm. */
const cm = (v: number): number => (v * 72) / 2.54;

/**
 * Arial e Microsoft Sans Serif são fontes da Microsoft e não existem no Linux
 * onde isto roda. Helvetica é a substituta métrica do Arial e está embutida em
 * todo leitor de PDF, o que mantém o texto com a mesma caixa sem depender de
 * arquivo de fonte externo.
 */
const FONTE_NORMAL = 'Helvetica';
const FONTE_NEGRITO = 'Helvetica-Bold';

/** Altura abaixo da qual rótulo e conteúdo não cabem empilhados, em cm. */
const ALTURA_MINIMA_EMPILHADO = 0.50;

export interface DanfseV2Opcoes {
  /**
   * Canhoto de recebimento. A NT o define como opcional (nota 11); desligado,
   * o espaço volta para as informações complementares.
   */
  canhoto?: boolean;
  /** Logomarca oficial da NFS-e (PNG), se disponível. */
  logo?: Buffer;
}

export class DanfseV2Generator {
  async generate(xml: string, opcoes: DanfseV2Opcoes = {}): Promise<Buffer> {
    const d = lerDanfse(xml);
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const pronto = new Promise<Buffer>(res => doc.on('end', () => res(Buffer.concat(chunks))));

    // Borda da página: 1 ponto (item 2.2.3).
    doc.lineWidth(TRACO.borda)
      .rect(cm(PAPEL.margem), cm(PAPEL.margem),
        cm(PAPEL.largura - 2 * PAPEL.margem), cm(PAPEL.altura - 2 * PAPEL.margem))
      .stroke();

    await this.cabecalho(doc, d, opcoes.logo);
    this.preencher(doc, CAMPOS_IDENT, this.valoresIdent(d), { labelIdent: true });
    this.blocoParte(doc, CAMPOS_PRESTADOR, this.valoresPrestador(d));
    this.blocoParte(doc, CAMPOS_TOMADOR, this.valoresParte(d.tomador),
      d.tomador?.documento ? undefined : 'TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e');
    this.blocoParte(doc, CAMPOS_DESTINATARIO, this.valoresDestinatario(d),
      d.destinatario?.documento ? undefined : 'DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e');
    this.blocoParte(doc, CAMPOS_INTERMEDIARIO, this.valoresParte(d.intermediario),
      d.intermediario?.documento ? undefined : 'INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e');
    this.preencher(doc, CAMPOS_SERVICO, this.valoresServico(d));
    this.blocoIssqn(doc, d);
    this.blocoFederal(doc, d);
    this.preencher(doc, CAMPOS_IBSCBS, this.valoresIbsCbs(d));
    this.preencher(doc, CAMPOS_TOTAIS, this.valoresTotais(d), { destacarUltimo: true });
    this.informacoesComplementares(doc, d, opcoes.canhoto === true);
    if (opcoes.canhoto) this.preencher(doc, CAMPOS_CANHOTO, this.valoresCanhoto(d));

    // Marca d'água por último, para ficar sobre o conteúdo (item 2.5).
    if (d.cancelada) this.marcaDagua(doc, 'CANCELADA');
    else if (d.substituida) this.marcaDagua(doc, 'SUBSTITUÍDA');

    doc.end();
    return pronto;
  }

  // -------------------------------------------------------------------------
  // Desenho
  // -------------------------------------------------------------------------

  /** Caixa com linha de 0,5 pt (item 2.2.3) e sombreamento opcional. */
  private caixa(doc: PDFKit.PDFDocument, c: { esq: number; sup: number; larg: number; alt: number }, cinza = false) {
    doc.lineWidth(TRACO.linha).rect(cm(c.esq), cm(c.sup), cm(c.larg), cm(c.alt));
    if (cinza) doc.fillAndStroke(CINZA_5, '#000000');
    else doc.stroke();
    doc.fillColor('#000000');
  }

  /**
   * Desenha uma tabela de campos com os valores na mesma ordem.
   *
   * Célula de título sai em caixa alta com fundo cinza (item 2.4.1) e não
   * recebe valor — o rótulo é o próprio conteúdo.
   */
  private preencher(doc: PDFKit.PDFDocument, campos: Campo[], valores: (string | undefined)[],
    opts: { labelIdent?: boolean; destacarUltimo?: boolean } = {}) {
    campos.forEach((c, n) => {
      if (c.titulo) return this.celulaTitulo(doc, c);
      const destaque = opts.destacarUltimo === true && n === campos.length - 1;
      this.celula(doc, c, valores[n], { labelIdent: opts.labelIdent, cinza: destaque });
    });
  }

  private celulaTitulo(doc: PDFKit.PDFDocument, c: Campo) {
    this.caixa(doc, c, true);
    doc.font(FONTE_NEGRITO).fontSize(FONTE.tituloBloco)
      .text(c.label.toUpperCase(), cm(c.esq) + cm(0.08), cm(c.sup) + cm(0.18),
        { width: cm(c.larg) - cm(0.16), lineBreak: false, ellipsis: true });
  }

  /**
   * Campo: rótulo em cima, conteúdo embaixo, dentro da caixa.
   *
   * Campo sem dado recebe traço (nota 12) — em branco esconderia do leitor a
   * diferença entre "zero" e "não informado".
   */
  private celula(doc: PDFKit.PDFDocument, c: Campo, valor?: string,
    opts: { cinza?: boolean; labelIdent?: boolean } = {}) {
    this.caixa(doc, c, opts.cinza);
    const padX = cm(0.07);
    const larg = cm(c.larg) - 2 * padX;
    const label = opts.labelIdent ? c.label.toUpperCase() : c.label;
    const tamLabel = opts.labelIdent ? FONTE.labelIdent : FONTE.labelCampo;
    const texto = this.textoOuTraco(valor, c.limite);

    // Rótulo de 6 pt sobre conteúdo de 7 pt pede ~0,46 cm. A NT tem linhas mais
    // baixas que isso (a descrição do código de tributação tem 0,38), onde
    // empilhar faz o valor encostar no rótulo. Nessas, os dois dividem a linha.
    if (c.alt < ALTURA_MINIMA_EMPILHADO) {
      const y = cm(c.sup) + cm(c.alt) / 2 - cm(0.10);
      doc.font(FONTE_NEGRITO).fontSize(tamLabel)
        .text(`${label}: `, cm(c.esq) + padX, y, { width: larg, lineBreak: false, continued: true })
        .font(FONTE_NORMAL).fontSize(FONTE.conteudo)
        .text(texto, { lineBreak: false, ellipsis: true });
      return;
    }

    doc.font(FONTE_NEGRITO).fontSize(tamLabel)
      .text(label, cm(c.esq) + padX, cm(c.sup) + cm(0.05),
        { width: larg, lineBreak: false, ellipsis: true });

    doc.font(FONTE_NORMAL).fontSize(FONTE.conteudo)
      .text(texto, cm(c.esq) + padX, cm(c.sup) + cm(c.alt) - cm(0.26),
        { width: larg, lineBreak: false, ellipsis: true });
  }

  /**
   * Bloco de parte. Sem documento identificado, a NT (notas 2 e 3) manda
   * imprimir só a frase de ausência numa faixa de 0,32 cm, em vez de repetir
   * campos vazios.
   */
  private blocoParte(doc: PDFKit.PDFDocument, campos: Campo[],
    valores: (string | undefined)[], ausente?: string) {
    const titulo = campos.find(c => c.titulo)!;
    if (!ausente) return this.preencher(doc, campos, valores);

    this.celulaTitulo(doc, titulo);
    const faixa = { ...FAIXA_AUSENTE, sup: titulo.sup + (titulo.alt - FAIXA_AUSENTE.alt) / 2,
      esq: COL.c2, larg: LARG.cheio - (COL.c2 - COL.c1) };
    this.caixa(doc, faixa);
    doc.font(FONTE_NEGRITO).fontSize(FONTE.labelCampo)
      .text(ausente, cm(faixa.esq) + cm(0.08), cm(faixa.sup) + cm(0.09),
        { width: cm(faixa.larg) - cm(0.16), lineBreak: false, ellipsis: true });

    // As linhas seguintes do bloco ficam em branco, mas continuam desenhadas
    // para o documento não abrir buraco no meio da folha.
    for (const c of campos) {
      if (c.titulo || c.sup === titulo.sup) continue;
      this.caixa(doc, c);
    }
  }

  private textoOuTraco(valor?: string, limite?: number): string {
    const v = (valor ?? '').trim();
    if (!v) return VAZIO;
    return limite && v.length > limite ? v.slice(0, limite - 3) + '...' : v;
  }

  // -------------------------------------------------------------------------
  // Cabeçalho e QR Code
  // -------------------------------------------------------------------------

  private async cabecalho(doc: PDFKit.PDFDocument, d: DanfseDados, logo?: Buffer) {
    this.caixa(doc, BLOCOS.cabecalho, true);

    if (logo) {
      try { doc.image(logo, cm(0.49), cm(0.44), { fit: [cm(4.0), cm(0.85)] }); } catch { /* segue sem logo */ }
    }

    const homologacao = d.tipoAmbiente === '2';
    // Em homologação o aviso entra abaixo do subtítulo, então o par sobe para
    // os três caberem no 1,16 cm do cabeçalho (item 2.4.3, observação).
    const yTitulo = homologacao ? 0.33 : 0.42;
    doc.font(FONTE_NEGRITO).fontSize(FONTE.cabecalho)
      .text('DANFSe v2.0', cm(5.41), cm(yTitulo), { width: cm(LARG.duplo), align: 'center' })
      .text('Documento Auxiliar da NFS-e', cm(5.41), cm(yTitulo + 0.30),
        { width: cm(LARG.duplo), align: 'center' });

    if (homologacao) {
      doc.fillColor('#FF0000')
        .text('NFS-e SEM VALIDADE JURÍDICA', cm(5.41), cm(yTitulo + 0.60),
          { width: cm(LARG.duplo), align: 'center' })
        .fillColor('#000000');
    }

    // Canto direito: município, ambiente gerador e tipo de ambiente.
    doc.font(FONTE_NORMAL).fontSize(FONTE.municipio)
      .text(`Município: ${this.textoOuTraco(d.municipioEmissor)}`, cm(COL.c4), cm(0.37),
        { width: cm(LARG.campo), lineBreak: false, ellipsis: true });
    doc.fontSize(FONTE.ambiente)
      // ambGer 1 = sistema do próprio município, 2 = SEFIN Nacional. A ordem é
      // essa e não a intuitiva: a maioria das notas vem do sistema municipal e
      // é transcrita para o modelo nacional (tpEmis 2).
      .text(`Ambiente Gerador: ${this.descrever(d.ambienteGerador,
        { '1': 'Sistema Próprio do Município', '2': 'SEFIN Nacional NFS-e' }) ?? VAZIO}`,
      cm(COL.c4), cm(0.97),
        { width: cm(LARG.campo), lineBreak: false, ellipsis: true })
      .text(`Tipo de Ambiente: ${homologacao ? 'Homologação' : 'Produção'}`,
        cm(COL.c4), cm(1.22), { width: cm(LARG.campo), lineBreak: false, ellipsis: true });

    await this.qrCode(doc, d);
  }

  private async qrCode(doc: PDFKit.PDFDocument, d: DanfseDados) {
    if (!d.chaveAcesso) return;
    const png = await QRCode.toBuffer(QRCODE.base + d.chaveAcesso, {
      type: 'png', errorCorrectionLevel: 'M', margin: 0, scale: 8,
    });
    doc.image(png, cm(QRCODE.esq), cm(QRCODE.sup),
      { width: cm(QRCODE.lado), height: cm(QRCODE.lado) });

    doc.font(FONTE_NORMAL).fontSize(FONTE.qrNota)
      .text(QRCODE.texto, cm(QRCODE.nota.esq), cm(QRCODE.nota.sup),
        { width: cm(QRCODE.nota.larg), align: 'center', height: cm(QRCODE.nota.alt) });
  }

  // -------------------------------------------------------------------------
  // Valores, na ordem das tabelas da grade
  // -------------------------------------------------------------------------

  private valoresIdent(d: DanfseDados): (string | undefined)[] {
    return [
      d.chaveAcesso,
      d.numero,
      this.data(d.competencia),
      this.dataHora(d.dataProcessamento),
      d.numeroDps,
      d.serieDps,
      this.dataHora(d.dataEmissaoDps),
      this.descrever(d.tipoEmitente, { '1': 'Prestador', '2': 'Tomador', '3': 'Intermediário' }),
      this.descrever(d.situacao, { '100': 'NFS-e emitida', '101': 'NFS-e cancelada', '102': 'NFS-e substituída' }),
      this.descrever(d.finalidade, { '0': 'NFS-e regular', '1': 'NFS-e complementar',
        '3': 'NFS-e de ajuste', '4': 'NFS-e de devolução' }),
    ];
  }

  private valoresParte(p?: Parte): (string | undefined)[] {
    return [
      undefined,                                   // célula de título
      p?.documento, p?.im, p?.fone,
      p?.nome, this.municipioUf(p), this.juntar(' / ', p?.municipio, this.cep(p?.cep)),
      p?.endereco, p?.email,
    ];
  }

  private valoresPrestador(d: DanfseDados): (string | undefined)[] {
    return [
      ...this.valoresParte(d.prestador),
      this.descrever(d.prestador.optanteSimples,
        { '1': 'Não Optante', '2': 'Optante — MEI', '3': 'Optante — ME/EPP' }),
      d.prestador.regimeApuracaoSN,
    ];
  }

  /** O destinatário não tem inscrição municipal — a NT não a lista (item 2.1.5). */
  private valoresDestinatario(d: DanfseDados): (string | undefined)[] {
    const p = d.destinatario;
    return [
      undefined,
      p?.documento, p?.fone,
      p?.nome, this.municipioUf(p), this.juntar(' / ', p?.municipio, this.cep(p?.cep)),
      p?.endereco, p?.email,
    ];
  }

  private valoresServico(d: DanfseDados): (string | undefined)[] {
    return [
      undefined,
      d.servico.codigoTributacaoNacional,
      d.servico.codigoNbs,
      d.servico.localPrestacao,
      d.servico.descricaoTributacao,
      d.servico.descricao,
    ];
  }

  private blocoIssqn(doc: PDFKit.PDFDocument, d: DanfseDados) {
    const i = d.issqn;
    // Sem incidência de ISSQN, a NT (nota 4) troca o bloco por uma frase.
    if (!i.baseCalculo && !i.apurado) {
      return this.blocoParte(doc, CAMPOS_ISSQN, [],
        'TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN');
    }
    this.preencher(doc, CAMPOS_ISSQN, [
      undefined,
      this.descrever(i.tipoTributacao, { '1': 'Operação tributável', '2': 'Exportação de serviço',
        '3': 'Não incidência', '4': 'Imunidade' }),
      i.municipioIncidencia,
      i.regimeEspecial, i.imunidade, i.suspensao, i.processoSuspensao,
      i.beneficioMunicipal, undefined, this.numero(i.totalDeducoes), this.numero(i.descontoIncondicionado),
      this.numero(i.baseCalculo), this.pct(i.aliquota),
      // 1 = NÃO retido. A polaridade é contraintuitiva e já causou erro aqui.
      this.descrever(i.retencao, { '1': 'Não retido', '2': 'Retido pelo tomador',
        '3': 'Retido pelo intermediário' }),
      this.numero(i.apurado),
    ]);
  }

  private blocoFederal(doc: PDFKit.PDFDocument, d: DanfseDados) {
    // Nota 6: bloco impresso só para competência até o fim de 2026.
    const ano = Number((d.competencia ?? '').slice(0, 4));
    if (ano && ano > 2026) return;
    const f = d.federal;
    this.preencher(doc, CAMPOS_FEDERAL, [
      undefined,
      this.numero(f.irrf), this.numero(f.previdenciaria), this.numero(f.sociaisRetidas),
      this.numero(f.pis), this.numero(f.cofins), undefined,
    ]);
  }

  private valoresIbsCbs(d: DanfseDados): (string | undefined)[] {
    const i = d.ibscbs;
    return [
      undefined,
      this.juntar(' / ', i.cst, i.cClassTrib),
      this.juntar(' / ', i.indicadorOperacao, i.codigoIncidencia, i.municipioIncidencia),
      this.numero(i.exclusoesReducoes),
      this.numero(i.baseCalculo),
      this.pct(i.redAliqIBSUF, i.redAliqIBSMun, i.redAliqCBS),
      this.pct(i.aliqIBSUF, i.aliqIBSMun),
      this.pct(i.aliqEfetivaMun),
      this.numero(i.valorIBSMun),
      this.pct(i.aliqEfetivaUF),
      this.numero(i.valorIBSUF),
      this.numero(i.valorIBSTotal),
      this.pct(i.aliqCBS),
      this.pct(i.aliqEfetivaCBS),
      this.numero(i.valorCBS),
    ];
  }

  private valoresTotais(d: DanfseDados): (string | undefined)[] {
    const t = d.totais;
    return [
      undefined,
      this.numero(t.valorServico), this.numero(t.descontoIncondicionado),
      this.numero(t.descontoCondicionado), this.numero(t.totalRetencoes),
      this.numero(t.liquido), this.numero(t.totalIbsCbs), this.numero(t.liquidoMaisIbsCbs),
    ];
  }

  private valoresCanhoto(d: DanfseDados): (string | undefined)[] {
    return [undefined, undefined, this.juntar(' / ', d.numero, d.chaveAcesso)];
  }

  private informacoesComplementares(doc: PDFKit.PDFDocument, d: DanfseDados, comCanhoto: boolean) {
    this.caixa(doc, BLOCOS.infoCompl, true);
    doc.font(FONTE_NEGRITO).fontSize(FONTE.tituloBloco)
      .text('INFORMAÇÕES COMPLEMENTARES', cm(COL.c1) + cm(0.08), cm(BLOCOS.infoCompl.sup) + cm(0.10),
        { width: cm(LARG.cheio), lineBreak: false });

    const t = d.totais;
    const un = (v?: string) => t.percentualTributos
      ? `${this.numero(v) ?? '0,00'}%` : `R$ ${this.numero(v) ?? '0,00'}`;
    // Linha fixa da Lei 12.741/2012 (nota 10): nunca é cortada.
    const fixa = linhaTotaisAproximados(un(t.tribFederais), un(t.tribEstaduais), un(t.tribMunicipais));

    const LIMITE = 1997;
    const livre = d.informacoesComplementares.join(' | ');
    const texto = livre.length > LIMITE ? livre.slice(0, LIMITE - 3) + '...' : livre;

    // Sem canhoto o quadro se estende até onde ele começaria (item 2.3.3).
    const fim = comCanhoto ? BLOCOS.canhoto.sup - 0.10 : PAPEL.altura - PAPEL.margem - 0.10;
    const alt = fim - BLOCOS.infoComplTexto.sup;
    this.caixa(doc, { ...BLOCOS.infoComplTexto, alt });
    doc.font(FONTE_NORMAL).fontSize(FONTE.conteudo)
      .text([texto, fixa].filter(Boolean).join('\n'),
        cm(COL.c1) + cm(0.08), cm(BLOCOS.infoComplTexto.sup) + cm(0.08),
        { width: cm(LARG.cheio) - cm(0.16), height: cm(alt) - cm(0.16), ellipsis: true });
  }

  // -------------------------------------------------------------------------
  // Formatação
  // -------------------------------------------------------------------------

  private descrever(v: string | undefined, mapa: Record<string, string>): string | undefined {
    return v === undefined ? undefined : (mapa[v] ?? v);
  }

  private juntar(sep: string, ...v: (string | undefined)[]): string | undefined {
    const t = v.map(x => (x ?? '').trim()).filter(Boolean);
    return t.length ? t.join(sep) : undefined;
  }

  /**
   * "Município / Sigla UF" — a NT manda usar a *descrição* do código IBGE, não
   * o código. O endereço externo (`endExt`) já traz a cidade escrita; o
   * nacional traz só `cMun`, que vira nome pela tabela do IBGE.
   */
  private municipioUf(p?: Parte): string | undefined {
    if (p?.municipioNome) return this.juntar(' / ', p.municipioNome, p.uf);
    return municipioUf(p?.municipio, p?.uf);
  }

  private cep(v?: string): string | undefined {
    if (!v) return undefined;
    const n = v.replace(/\D/g, '');
    return n.length === 8 ? `${n.slice(0, 2)}.${n.slice(2, 5)}-${n.slice(5)}` : v;
  }

  private data(v?: string): string | undefined {
    if (!v) return undefined;
    const [a, m, dia] = v.slice(0, 10).split('-');
    return dia ? `${dia}/${m}/${a}` : v;
  }

  private dataHora(v?: string): string | undefined {
    if (!v) return undefined;
    const hora = v.slice(11, 19);
    return hora ? `${this.data(v)} ${hora}` : this.data(v);
  }

  /**
   * Número no formato brasileiro: milhar com ponto, decimal com vírgula.
   *
   * O XML guarda "291.00" porque o schema exige ponto decimal; o documento
   * impresso é para leitura humana no Brasil. É a mesma informação em outra
   * notação — não é dado novo, que a NT proíbe, nem arredondamento.
   */
  private numero(v?: string): string | undefined {
    if (v === undefined || v === '') return undefined;
    const n = Number(v);
    if (Number.isNaN(n)) return v;
    const [i, dec] = Math.abs(n).toFixed(2).split('.');
    return `${n < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
  }

  private pct(...v: (string | undefined)[]): string | undefined {
    const t = v.filter(x => x !== undefined && x !== '').map(x => `${this.numero(x)}%`);
    return t.length ? t.join(' / ') : undefined;
  }

  /** Diagonal, 50 pt mínimo, cinza K35 (itens 2.5.1 e 2.5.2). */
  private marcaDagua(doc: PDFKit.PDFDocument, texto: string) {
    doc.save()
      .fillColor('#A6A6A6')
      .font(FONTE_NEGRITO).fontSize(FONTE.marcaDagua)
      .rotate(-45, { origin: [cm(PAPEL.largura / 2), cm(PAPEL.altura / 2)] })
      .text(texto, 0, cm(PAPEL.altura / 2) - cm(1), { width: cm(PAPEL.largura), align: 'center' })
      .restore()
      .fillColor('#000000');
  }
}
