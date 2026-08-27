import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Eye, Loader2, Plus, Trash2, Users } from "lucide-react";
import {
  RETENCOES_FEDERAIS,
  type PayloadNfse,
  emitirDocumento,
  duplicarDocumento,
  listarServicosNfse,
  previaNfse,
  previaNota,
  proximoNumero,
  statusFiscal,
  classificarNcm,
  buscarNcm,
  buscarProdutos,
  type Ambiente,
  type DocumentoFiscal,
  type PreviaNota,
  type ServicoNfse,
  type SugestaoNcm,
  type ProdutoCatalogo,
  type NotaDuplicada,
} from "@/lib/fiscal.functions";
import { BaixarDocumento } from "@/components/app/BaixarDocumento";
import { BotaoSalvarDestinatario, SeletorDestinatario } from "@/components/app/SeletorDestinatario";
import { destinatarios } from "@/lib/cadastros";
import { manifest } from "@/lib/manifest";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Série reservada para a emissão pela plataforma.
 *
 * O contador da SEFAZ é por (CNPJ, série): usar a mesma série do sistema próprio
 * do cliente faria os dois disputarem a numeração e sairiam notas com o mesmo
 * número. As séries baixas (1-100) são as que a empresa costuma já usar.
 *
 * Não usar 890 ou acima: a SEFAZ reserva a faixa 890-999 para contingência e
 * recusa emissão normal com cStat 244. O limite é 889.
 */
const SERIE_PADRAO = "880";

/** Códigos da SEFAZ para meio de pagamento (tag tPag). */
const FORMAS_PAGAMENTO = [
  { valor: "01", texto: "Dinheiro" },
  { valor: "03", texto: "Cartao de credito" },
  { valor: "04", texto: "Cartao de debito" },
  { valor: "15", texto: "Boleto bancario" },
  { valor: "17", texto: "PIX" },
  { valor: "99", texto: "Outros" },
  { valor: "90", texto: "Sem pagamento" },
];

/**
 * O CFOP e o indicador de IE do destinatário precisam combinar, senão a SEFAZ
 * rejeita com mensagem que não explica a causa (ex.: cStat 232, "IE do
 * destinatário não informada"). Perguntamos o que o operador sabe responder.
 */
const TIPOS_DESTINATARIO = [
  { valor: "1", texto: "Contribuinte de ICMS (tem Inscricao Estadual)" },
  { valor: "2", texto: "Contribuinte isento de Inscricao Estadual" },
  { valor: "9", texto: "Nao contribuinte (consumidor final)" },
];

const TIPOS_OPERACAO = [
  { valor: "1", texto: "Saida — venda ao cliente" },
  { valor: "0", texto: "Entrada — compra de fornecedor ou produtor" },
];

type Item = {
  id: number;
  codigo: string;
  descricao: string;
  ncm: string;
  unidade: string;
  quantidade: string;
  valorUnitario: string;
  desconto: string;
  // Preenchidos pela classificação; ficam editáveis mas fora do caminho.
  cfop?: string | undefined;
  cstIcms?: string | undefined;
  aliqIcms?: string | undefined;
  cstIpi?: string | undefined;
  aliqIpi?: string | undefined;
  cest?: string | undefined;
  // A classificacao devolve estes e eles mudam imposto. Guardar sem enviar seria
  // consultar o tratamento fiscal certo e emitir sem ele.
  origem?: string | undefined;
  cBenef?: string | undefined;
  redBcIcms?: string | undefined;
  mva?: string | undefined;
  aliqIcmsSt?: string | undefined;
  // IBS/CBS da Reforma. Vazio = tributação integral (CST 000 / 000001), que é o
  // padrão do motor. Produto com tratamento próprio precisa trazer o seu par —
  // sem isto a nota afirma "tributação integral" sobre um produto de alíquota
  // zero, que foi como a banana saiu.
  ibscbsCst?: string | undefined;
  ibscbsCclasstrib?: string | undefined;
  ibscbsPRedAliq?: string | undefined;
  fonteClassificacao?: string | undefined;
};

let proximoId = 1;
const itemVazio = (): Item => ({
  id: proximoId++,
  codigo: "",
  descricao: "",
  ncm: "",
  unidade: "UN",
  quantidade: "",
  valorUnitario: "",
  desconto: "",
});

/** Espelha a conversao do servidor: 5102 numa nota de entrada vira 1102. */
function cfopNoSentido(cfop: string, entrada: boolean): string {
  const d = String(cfop ?? "").replace(/[^0-9]/g, "");
  if (d.length !== 4) return "";
  const mapa = entrada
    ? { "5": "1", "6": "2" } as Record<string, string>
    : { "1": "5", "2": "6" } as Record<string, string>;
  return (mapa[d[0]!] ?? d[0]!) + d.slice(1);
}

/**
 * O que um produto do catálogo preenche num item.
 *
 * Vive fora dos formulários porque a NF-e e o cupom usam o mesmo catálogo: duas
 * cópias deste mapeamento significariam que um campo novo no cadastro de produto
 * chega numa tela e não na outra — e o operador do balcão veria o item entrar
 * sem a tributação que a contabilidade cadastrou.
 */
function camposDoProduto(p: ProdutoCatalogo, it: Item): Partial<Item> {
  return {
    codigo: p.codigo ?? it.codigo,
    descricao: p.descricao ?? it.descricao,
    ncm: p.ncm ?? it.ncm,
    unidade: p.unidade ?? it.unidade,
    valorUnitario: p.valorUnitario ?? it.valorUnitario,
    cfop: p.cfop ?? it.cfop,
    cstIcms: p.cstCsosn ?? it.cstIcms,
    aliqIcms: p.aliqIcms ?? it.aliqIcms,
    cstIpi: p.cstIpi ?? it.cstIpi,
    aliqIpi: p.aliqIpi ?? it.aliqIpi,
    cest: p.cest ?? it.cest,
    // A ORIGEM tem de vir junto com o produto.
    //
    // O cadastro ja perguntava a origem e a emissao ja tinha o seletor, mas o
    // catalogo nao levava o valor de um para o outro: escolher um produto
    // importado deixava o item em 0 (nacional). Isso e declaracao falsa no XML e
    // muda a aliquota interestadual — importada e 4%, nao 7% nem 12%. Quem
    // cadastrou certo emitia errado, e sem nenhum aviso.
    origem: p.origem ?? it.origem,
    // Mesma historia: sao decisoes da contabilidade que estavam guardadas no
    // cadastro e nao chegavam ao item.
    redBcIcms: p.redBcIcms ?? it.redBcIcms,
    mva: p.mva ?? it.mva,
    aliqIcmsSt: p.aliqIcmsSt ?? it.aliqIcmsSt,
    cBenef: p.cbenef ?? it.cBenef,
    // O catálogo é onde a decisão da contabilidade mora; se ela não vier junto
    // com o produto, o item volta ao padrão sem avisar.
    ibscbsCst: p.ibscbsCst ?? it.ibscbsCst,
    ibscbsCclasstrib: p.ibscbsCclasstrib ?? it.ibscbsCclasstrib,
    ibscbsPRedAliq: p.ibscbsPRedAliq ?? it.ibscbsPRedAliq,
    fonteClassificacao: "catalogo",
  };
}

const num = (v: string) => Number(String(v ?? "").replace(",", ".")) || 0;
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function EmissaoForm({
  tipo, duplicarDe,
}: {
  tipo: "nfe" | "nfce" | "nfse";
  /** Chave de uma nota anterior para trazer os dados. Vem de `?de=` na URL. */
  duplicarDe?: string | undefined;
}) {
  if (tipo === "nfse") return <EmissaoNfse />;
  if (tipo === "nfce") return <EmissaoNfce />;
  return <EmissaoNfe duplicarDe={duplicarDe} />;
}

// ─────────────────────────────── NF-e ───────────────────────────────

function EmissaoNfe({ duplicarDe }: { duplicarDe?: string | undefined }) {
  const emitir = useServerFn(emitirDocumento);
  const verPrevia = useServerFn(previaNota);
  const pegarNumero = useServerFn(proximoNumero);
  const pegarStatus = useServerFn(statusFiscal);
  const classificar = useServerFn(classificarNcm);
  const router = useRouter();
  const qc = useQueryClient();

  const [serie, setSerie] = useState(SERIE_PADRAO);
  const [numero, setNumero] = useState("");
  // O ambiente nao e mais um campo: vem do BOTAO clicado. Continua em estado
  // porque a confirmacao e a tela de sucesso precisam saber qual foi.
  const [ambiente, setAmbiente] = useState<Ambiente>("1");
  const [ambientePermitido, setAmbientePermitido] = useState<string | null>(null);
  const [tipoOperacao, setTipoOperacao] = useState("1");
  const [naturezaOperacao, setNaturezaOperacao] = useState("");
  // Finalidade e nota referenciada nao existiam na tela, e sem as duas NAO HA
  // DEVOLUCAO: a devolucao e uma nota de entrada com finalidade 4 apontando a
  // chave da nota original. Sem elas o operador so conseguia emitir venda.
  const [finalidade, setFinalidade] = useState("1");
  const [notaReferenciada, setNotaReferenciada] = useState("");
  const [dest, setDest] = useState({
    nome: "", documento: "", email: "", tipo: "9", ie: "",
    logradouro: "", numero: "", bairro: "", municipio: "", codigoMunicipio: "", uf: "", cep: "",
  });
  const [itens, setItens] = useState<Item[]>([itemVazio()]);
  const [descontoNota, setDescontoNota] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("01");
  const [observacoes, setObservacoes] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const [previa, setPrevia] = useState<PreviaNota | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [emitida, setEmitida] = useState<DocumentoFiscal | null>(null);
  const [buscandoDest, setBuscandoDest] = useState(false);
  const [recuperada, setRecuperada] = useState<string | null>(null);
  const [faltaNome, setFaltaNome] = useState(false);
  // Guardado para contar o uso quando a nota sair: e o que ordena a lista pelo
  // cliente de sempre, em vez de pela ordem alfabetica.
  const [destEscolhido, setDestEscolhido] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // O que a credencial aceita. Oferecer um ambiente que devolve 403 é pior do
  // que não oferecer nenhum, então o seletor só aparece se ela permitir os dois.
  useEffect(() => {
    let ativo = true;
    pegarStatus({})
      .then((r) => {
        if (!ativo || !r.ok) return;
        const permitido = r.data.ambientePermitido ?? null;
        setAmbientePermitido(permitido);
        // Credencial restrita: a tela ADOTA o ambiente que ela permite. Ficar em
        // produção com uma chave de homologação faz toda chamada devolver 403 —
        // e o formulário engolia isso: o número nunca chegava, o campo ficava
        // "buscando..." para sempre e nada dizia por quê.
        if (permitido === "homologacao") setAmbiente("2");
        if (permitido === "producao") setAmbiente("1");
      })
      .catch(() => { /* sem resposta, o seletor fica escondido e emite em produção */ });
    return () => { ativo = false; };
  }, [pegarStatus]);

  // A numeração vem da API: sem isso toda nota sairia como número 1. Refaz ao
  // trocar de ambiente, porque produção e homologação contam separado.
  useEffect(() => {
    let ativo = true;
    setNumero("");
    pegarNumero({ data: { serie, ambiente } })
      .then((r) => {
        if (!ativo) return;
        if (r.ok) { setNumero(String(r.data.numero)); return; }
        // Falhar calado deixava o campo em "buscando..." para sempre, sem o
        // operador saber que a credencial foi recusada. O campo segue editável,
        // mas o motivo aparece.
        setErro(`Nao consegui buscar o proximo numero: ${r.error}`);
      })
      .catch(() => {
        if (ativo) setErro("Nao consegui buscar o proximo numero. Informe manualmente.");
      });
    return () => { ativo = false; };
  }, [serie, ambiente, pegarNumero]);

  // Qualquer mudança no formulário invalida a prévia: conferir uma nota e emitir
  // outra é exatamente o erro que a prévia existe para evitar.
  useEffect(() => {
    setPrevia(null);
  }, [serie, numero, ambiente, tipoOperacao, naturezaOperacao, finalidade, notaReferenciada, dest, itens,
      descontoNota, formaPagamento, observacoes]);

  const alterarItem = (id: number, campo: keyof Item, valor: string) =>
    setItens((lista) => lista.map((it) => (it.id === id ? { ...it, [campo]: valor } : it)));

  /** NCM completo dispara a classificação e preenche o resto do item. */
  async function aoCompletarNcm(id: number, ncm: string) {
    const limpo = ncm.replace(/\D/g, "");
    if (limpo.length !== 8) return;
    const r = await classificar({
      data: {
        ncm: limpo,
        uf: dest.uf || undefined,
        operacao: undefined,
        // O sentido decide o primeiro digito do CFOP. Sem ele, uma nota de
        // entrada recebe 5102 e a SEFAZ recusa com cStat 519.
        entrada: tipoOperacao === "0",
        interestadual: Boolean(dest.uf) && dest.uf !== manifest.company.uf,
      },
    }).catch(() => null);
    if (!r || !r.ok) return;
    const c = r.data;
    setItens((lista) =>
      lista.map((it) =>
        it.id !== id
          ? it
          : {
              ...it,
              cfop: c.cfop ?? it.cfop,
              cstIcms: c.cstCsosn ?? it.cstIcms,
              aliqIcms: c.aliqIcms ?? it.aliqIcms,
              cstIpi: c.cstIpi ?? it.cstIpi,
              aliqIpi: c.aliqIpi ?? it.aliqIpi,
              cest: c.cest ?? it.cest,
              redBcIcms: c.redBcIcms ?? it.redBcIcms,
              mva: c.mva ?? it.mva,
              aliqIcmsSt: c.aliqIcmsSt ?? it.aliqIcmsSt,
              cBenef: c.cbenef ?? it.cBenef,
              fonteClassificacao: c.fonte,
            },
      ),
    );
  }

  function usarProduto(id: number, p: ProdutoCatalogo) {
    setItens((lista) =>
      lista.map((it) => (it.id !== id ? it : { ...it, ...camposDoProduto(p, it) })),
    );
  }

  const totalProdutos = itens.reduce((n, it) => n + num(it.quantidade) * num(it.valorUnitario), 0);
  // Desconto do item nunca passa do próprio item; o da nota entra por cima.
  const descontoItens = itens.reduce(
    (n, it) => n + Math.min(num(it.desconto), num(it.quantidade) * num(it.valorUnitario)),
    0,
  );
  // Bruto para validar, limitado para exibir: mostrar "-R$ 100.700" sobre uma
  // nota de R$ 4.077 confunde, mas o aviso de desconto abusivo precisa do
  // valor real, senao ele nunca dispara e o absurdo vai para a API.
  const descontoBruto = descontoItens + num(descontoNota);
  const totalDesconto = Math.min(descontoBruto, totalProdutos);
  const totalNota = Math.max(0, totalProdutos - totalDesconto);

  /**
   * A nota no formato que as duas ações usam. Conferir e emitir partem daqui
   * para que o que aparece na prévia seja literalmente o que é enviado.
   */
  // A chave vem digitada ou colada, com espaços e pontos. A API quer 44 dígitos.
  const chaveReferenciada = notaReferenciada.replace(/\D/g, "");

  function montarNota() {
    return {
      serie,
      numero,
      tipoOperacao,
      naturezaOperacao,
      finalidade,
      // A API aceita uma ou varias; a tela trata o caso comum, que e uma so.
      ...(chaveReferenciada ? { notasReferenciadas: [chaveReferenciada] } : {}),
      destinatario: dest,
      itens: itens
        .filter((it) => it.descricao.trim() && num(it.quantidade) > 0)
        .map((it) => ({
          codigo: it.codigo,
          descricao: it.descricao,
          ncm: it.ncm,
          unidade: it.unidade,
          quantidade: it.quantidade,
          valorUnitario: it.valorUnitario,
          desconto: it.desconto,
          cfop: it.cfop,
          cstIcms: it.cstIcms,
          aliqIcms: it.aliqIcms,
          cstIpi: it.cstIpi,
          aliqIpi: it.aliqIpi,
          cest: it.cest,
          origem: it.origem,
          cBenef: it.cBenef,
          redBcIcms: it.redBcIcms,
          mva: it.mva,
          aliqIcmsSt: it.aliqIcmsSt,
          ibscbsCst: it.ibscbsCst,
          ibscbsCclasstrib: it.ibscbsCclasstrib,
          ibscbsPRedAliq: it.ibscbsPRedAliq,
        })),
      desconto: descontoNota,
      formaPagamento,
      observacoes,
    };
  }

  /** Só o que impede de sair da tela. O resto quem reprova é a SEFAZ. */
  function validar(): string | null {
    if (!itens.some((it) => it.descricao.trim() && num(it.quantidade) > 0)) {
      return "Adicione ao menos um item com descricao e quantidade.";
    }
    if (descontoBruto > totalProdutos) {
      return "O desconto nao pode ser maior que o total dos produtos.";
    }
    return null;
  }

  /**
   * Prévia: monta e valida contra o schema da SEFAZ sem emitir nada e sem gastar
   * número da série. Pode ser repetida à vontade.
   */
  async function conferir() {
    const problema = validar();
    setErro(problema);
    if (problema) return;

    setConferindo(true);
    setPrevia(null);
    try {
      // Confere a nota que vai VALER: sem isto, cancelar um "emitir em teste"
      // deixava a previa conferindo homologacao, calada.
      const res = await verPrevia({ data: { nota: montarNota(), ambiente: podeValer ? "1" : "2" } });
      if (res.ok) {
        setPrevia(res.data);
        toast.success("Previa gerada. Nenhuma nota foi emitida.");
      } else {
        setErro(res.error);
        toast.error(res.error);
      }
    } catch {
      setErro("Nao foi possivel gerar a previa.");
    } finally {
      setConferindo(false);
    }
  }

  /**
   * Emitir nunca dispara direto: abre a confirmação. Em produção a nota não se
   * apaga — só se cancela, e o cancelamento tem prazo.
   */
  /**
   * Traz os dados de uma nota anterior para o formulario.
   *
   * Resolve o caso mais comum de todos: a nota saiu em teste, foi conferida, e
   * agora precisa sair valendo. Sem isto o operador redigita destinatario, itens
   * e pagamento — e o erro que ele acabou de corrigir volta na digitacao.
   *
   * Serie e numero NAO vem da nota antiga, de proposito: numero repetido e
   * duplicidade (cStat 539). O numero continua sendo buscado do zero.
   */
  const aplicarDuplicata = useCallback((d: NotaDuplicada) => {
    const dest0 = d.destinatario;
    const end0 = dest0?.endereco;

    /**
     * Em homologacao a SEFAZ EXIGE que a razao social seja o texto
     * "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL" — ela recusa
     * o nome verdadeiro. Entao a nota de teste guarda esse texto no lugar do
     * cliente.
     *
     * Trazer isso de volta era o pior desfecho possivel: o operador reaproveita
     * o teste, clica em emitir, e a nota REAL sai no nome do aviso de
     * homologacao. Nao ha rejeicao — a SEFAZ aceita qualquer nome em producao.
     *
     * O campo volta vazio, e o aviso na tela diz por que. O resto da nota
     * (documento, endereco, itens) e verdadeiro e vem inteiro.
     */
    const nomeVeio = dest0?.razaoSocial ?? "";
    const nomeEhDeHomologacao = /HOMOLOGA[CÇ]A?O/i.test(nomeVeio) && /SEM VALOR FISCAL/i.test(nomeVeio);
    if (nomeEhDeHomologacao) setFaltaNome(true);

    if (dest0) {
      setDest({
        nome: nomeEhDeHomologacao ? "" : nomeVeio,
        documento: dest0.cnpj ?? dest0.cpf ?? "",
        email: dest0.email ?? "",
        tipo: dest0.indIEDest ?? "9",
        ie: dest0.ie ?? "",
        logradouro: end0?.logradouro ?? "",
        numero: end0?.numero ?? "",
        bairro: end0?.bairro ?? "",
        municipio: end0?.nomeMunicipio ?? end0?.municipio ?? "",
        codigoMunicipio: end0?.codigoMunicipio ?? "",
        uf: end0?.uf ?? "",
        cep: end0?.cep ?? "",
      });
    }

    if (d.itens?.length) {
      setItens(d.itens.map((it) => ({
        ...itemVazio(),
        codigo: it.codigo ?? "",
        descricao: it.descricao ?? "",
        ncm: it.ncm ?? "",
        unidade: it.unidade ?? "UN",
        quantidade: String(it.quantidade ?? "1"),
        valorUnitario: String(it.valorUnitario ?? ""),
        desconto: it.desconto ? String(it.desconto) : "",
        cfop: it.cfop,
        cstIcms: it.cstIcms,
        aliqIcms: it.aliqIcms,
        cstIpi: it.cstIpi,
        aliqIpi: it.aliqIpi,
        cest: it.cest,
        origem: it.origem,
        redBcIcms: it.redBcIcms,
        mva: it.mva,
        aliqIcmsSt: it.aliqIcmsSt,
        ibscbsCst: it.ibscbsCst,
        ibscbsCclasstrib: it.ibscbsCclasstrib,
        ibscbsPRedAliq: it.ibscbsPRedAliq,
        // A origem do dado importa: veio de uma nota que a SEFAZ aceitou, que e
        // fonte melhor que a classificacao automatica.
        fonteClassificacao: "nota anterior",
      })));
    }

    if (d.naturezaOperacao) setNaturezaOperacao(d.naturezaOperacao);
    if (d.tipoOperacao) setTipoOperacao(d.tipoOperacao);
    const forma = d.pagamento?.formas?.[0]?.tipo;
    if (forma) setFormaPagamento(forma);
    if (d.informacoesAdicionais?.complementar) {
      setObservacoes(d.informacoesAdicionais.complementar);
    }
    setRecuperada(d.origem?.numero ? `${d.origem.numero}/${d.origem.serie ?? ""}` : "anterior");
  }, []);

  const trazerNota = useServerFn(duplicarDocumento);
  useEffect(() => {
    if (!duplicarDe) return;
    let ativo = true;
    trazerNota({ data: { chave: duplicarDe } })
      .then((r) => {
        if (!ativo) return;
        if (r.ok) { aplicarDuplicata(r.data); toast.success("Dados da nota anterior carregados."); }
        else setErro(r.error);
      })
      .catch(() => setErro("Nao foi possivel carregar a nota anterior."));
    return () => { ativo = false; };
  }, [duplicarDe, trazerNota, aplicarDuplicata]);

  // Chave restrita nao pode oferecer um botao que ela nao consegue usar: o
  // clique voltaria 403 depois de a pessoa preencher a nota inteira.
  const podeValer = ambientePermitido !== "homologacao";
  const podeTestar = ambientePermitido !== "producao";

  /** Abre a confirmacao ja sabendo o ambiente do botao clicado. */
  function pedirConfirmacao(alvo: Ambiente) {
    const problema = validar();
    setErro(problema);
    if (problema) return;
    setAmbiente(alvo);
    setConfirmando(true);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // O submit e o botao "Emitir NF-e": producao. Antes ele usava o ambiente do
    // seletor, entao o MESMO botao emitia teste ou nota valendo dependendo de um
    // campo que ficava longe dele.
    pedirConfirmacao(podeValer ? "1" : "2");
  }

  async function confirmarEmissao() {
    setConfirmando(false);
    setEnviando(true);
    setErro(null);
    try {
      const res = await emitir({ data: { tipo: "nfe", nota: montarNota(), ambiente } });
      if (res.ok) {
        toast.success(
          ambiente === "1"
            ? "Nota autorizada."
            : "Nota autorizada em homologacao — teste, sem valor fiscal.",
        );
        qc.invalidateQueries({ queryKey: ["docs", "nfe"] });
        if (destEscolhido) destinatarios.registrarUso(destEscolhido).catch(() => {});
        // Não navega embora: a resposta traz o documento, e sair daqui sem
        // entregá-lo obriga o operador a uma segunda busca que ele nem sabe que
        // existe. Ele vai para a lista quando quiser, pelo botão.
        setEmitida(res.data);
      } else {
        setErro(res.error);
        toast.error(res.error);
      }
    } catch {
      setErro("Nao foi possivel emitir o documento.");
    } finally {
      setEnviando(false);
    }
  }

  // Emitida: a tela vira entrega do documento. O PDF chega uma vez so, nesta
  // resposta — mostrar "autorizada" e sumir com ele seria emitir pela metade.
  if (emitida) {
    return (
      <NotaEmitida
        doc={emitida}
        ambiente={ambiente}
        onNova={() => { setEmitida(null); setPrevia(null); setItens([itemVazio()]); }}
        onLista={() => router.navigate({ to: "/nfe" })}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {ambiente === "2" && (
        <p className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            <strong>Modo teste (homologacao).</strong> A SEFAZ valida a nota de
            verdade, mas ela nao tem valor fiscal e nao consome numero da serie
            real. Volte para producao quando for emitir valendo.
          </span>
        </p>
      )}

      <section className="space-y-4 rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-muted-foreground">Dados da nota</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <Campo label="Serie">
            <Input value={serie} onChange={(e) => setSerie(e.target.value)} />
          </Campo>
          <Campo label="Numero" dica="Sugerido pela API; edite se precisar.">
            <Input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="buscando..." />
          </Campo>
          <Campo label="Tipo de operacao" span>
            <Selecao value={tipoOperacao} onChange={setTipoOperacao} opcoes={TIPOS_OPERACAO} />
          </Campo>
          <Campo label="Finalidade" span>
            <Selecao
              value={finalidade}
              onChange={setFinalidade}
              opcoes={[
                { valor: "1", texto: "Normal" },
                { valor: "2", texto: "Complementar" },
                { valor: "3", texto: "Ajuste" },
                { valor: "4", texto: "Devolucao de mercadoria" },
              ]}
            />
          </Campo>
          <Campo label="Natureza da operacao" span={2}>
            <Input
              value={naturezaOperacao}
              onChange={(e) => setNaturezaOperacao(e.target.value)}
              placeholder={
                finalidade === "4" ? "Devolucao de venda"
                  : tipoOperacao === "0" ? "Compras para comercializacao"
                    : "Venda de mercadoria"
              }
            />
          </Campo>

          {/* Complementar e devolução EXIGEM a nota de origem (rejeição 321).
              Sem este campo a plataforma simplesmente não conseguia devolver. */}
          {(finalidade === "2" || finalidade === "4") && (
            <Campo
              label="Chave da nota de origem"
              span={4}
              dica={
                chaveReferenciada.length === 44
                  ? "Chave completa."
                  : `44 digitos — faltam ${44 - chaveReferenciada.length}. Esta na nota que voce esta devolvendo.`
              }
            >
              <Input
                value={notaReferenciada}
                onChange={(e) => setNotaReferenciada(e.target.value)}
                placeholder="Cole a chave de acesso da nota original"
              />
            </Campo>
          )}
        </div>

        {finalidade === "4" && (
          <p className="text-xs text-muted-foreground">
            Devolucao normalmente e nota de <strong>entrada</strong>: confira o tipo de operacao
            acima, porque e ele que decide o sentido do CFOP.
          </p>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {tipoOperacao === "0" ? "Fornecedor" : "Destinatario"}
          </h2>
          {/* Buscar e salvar ficam aqui, junto dos campos: o momento de guardar
              o cadastro e agora, com os dados conferidos na mao para emitir. */}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setBuscandoDest(true)}>
              <Users className="size-4" /> Buscar cadastrado
            </Button>
            <BotaoSalvarDestinatario dados={dest} />
          </div>
        </div>

        <SeletorDestinatario
          aberto={buscandoDest}
          onFechar={() => setBuscandoDest(false)}
          onEscolher={(d) => {
            // Preenche tudo de uma vez, inclusive o codigo IBGE — que e o que a
            // SEFAZ confere e o que ninguem sabe de cabeca.
            setDest({
              nome: d.nome,
              documento: d.documento,
              email: d.email ?? "",
              tipo: d.indIEDest,
              ie: d.ie ?? "",
              logradouro: d.logradouro,
              numero: d.numero,
              bairro: d.bairro,
              municipio: d.municipio,
              codigoMunicipio: d.codigoMunicipio,
              uf: d.uf,
              cep: d.cep,
            });
            setDestEscolhido(d.id);
            toast.success(`${d.nome} carregado.`);
          }}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Campo label="Nome / Razao social" span={2}>
            <Input required value={dest.nome} onChange={(e) => setDest({ ...dest, nome: e.target.value })} />
          </Campo>
          <Campo label="CPF / CNPJ">
            <Input required value={dest.documento} onChange={(e) => setDest({ ...dest, documento: e.target.value })} />
          </Campo>
          <Campo label="Tipo" span={2}>
            <Selecao value={dest.tipo} onChange={(v) => setDest({ ...dest, tipo: v })} opcoes={TIPOS_DESTINATARIO} />
          </Campo>
          <Campo label="Inscricao Estadual" dica={dest.tipo === "1" ? "Obrigatoria para contribuinte." : "So para contribuinte."}>
            <Input
              value={dest.ie}
              disabled={dest.tipo !== "1"}
              onChange={(e) => setDest({ ...dest, ie: e.target.value })}
            />
          </Campo>
          <Campo label="Logradouro" span={2}>
            <Input required value={dest.logradouro} onChange={(e) => setDest({ ...dest, logradouro: e.target.value })} />
          </Campo>
          <Campo label="Numero">
            <Input value={dest.numero} placeholder="S/N" onChange={(e) => setDest({ ...dest, numero: e.target.value })} />
          </Campo>
          <Campo label="Bairro">
            <Input required value={dest.bairro} onChange={(e) => setDest({ ...dest, bairro: e.target.value })} />
          </Campo>
          <Campo label="Municipio">
            <Input required value={dest.municipio} onChange={(e) => setDest({ ...dest, municipio: e.target.value })} />
          </Campo>
          <Campo label="Codigo IBGE">
            <Input required value={dest.codigoMunicipio} placeholder="3135050" onChange={(e) => setDest({ ...dest, codigoMunicipio: e.target.value })} />
          </Campo>
          <Campo label="UF">
            <Input required value={dest.uf} placeholder={manifest.company.uf} onChange={(e) => setDest({ ...dest, uf: e.target.value.toUpperCase() })} />
          </Campo>
          <Campo label="CEP">
            <Input required value={dest.cep} placeholder="39508000" onChange={(e) => setDest({ ...dest, cep: e.target.value })} />
          </Campo>
          <Campo label="E-mail">
            <Input type="email" value={dest.email} onChange={(e) => setDest({ ...dest, email: e.target.value })} />
          </Campo>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Itens</h2>
          <Button type="button" variant="outline" size="sm" onClick={() => setItens((l) => [...l, itemVazio()])}>
            <Plus className="size-4" /> Adicionar item
          </Button>
        </div>

        {itens.map((it, i) => (
          <LinhaItem
            key={it.id}
            indice={i + 1}
            item={it}
            podeRemover={itens.length > 1}
            onAlterar={(campo, valor) => alterarItem(it.id, campo, valor)}
            entrada={tipoOperacao === "0"}
            onNcmCompleto={(ncm) => aoCompletarNcm(it.id, ncm)}
            onUsarProduto={(p) => usarProduto(it.id, p)}
            onRemover={() => setItens((l) => l.filter((x) => x.id !== it.id))}
          />
        ))}

        <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
          <Campo label="Desconto da nota (R$)" dica="Rateado entre os itens pela API.">
            <Input value={descontoNota} onChange={(e) => setDescontoNota(e.target.value)} placeholder="0,00" />
          </Campo>
          <Campo label="Forma de pagamento">
            <Selecao value={formaPagamento} onChange={setFormaPagamento} opcoes={FORMAS_PAGAMENTO.map((f) => ({ valor: f.valor, texto: f.texto }))} />
          </Campo>
          <div className="flex flex-col justify-end gap-1 text-right text-sm">
            <div className="text-muted-foreground">Produtos: {brl(totalProdutos)}</div>
            {totalDesconto > 0 && <div className="text-muted-foreground">Desconto: −{brl(totalDesconto)}</div>}
            <div className="text-lg font-semibold">Total: {brl(totalNota)}</div>
          </div>
        </div>
      </section>

      <QuadroTributos itens={itens} entrada={tipoOperacao === "0"} />

      <section className="space-y-2 rounded-xl border border-border bg-card p-6">
        <Label htmlFor="observacoes">Informacoes complementares</Label>
        <Textarea id="observacoes" rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
      </section>

      {recuperada && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <p>
            Dados trazidos da nota <strong className="text-foreground">{recuperada}</strong>.
            Confira antes de emitir — <strong>a numeracao e nova</strong>, o resto veio como estava.
          </p>
          {faltaNome && (
            <p className="text-amber-700 dark:text-amber-400">
              <strong>Preencha o nome do destinatario.</strong> A nota de origem era de
              homologacao, onde a SEFAZ exige o texto de aviso no lugar da razao
              social — esse texto nao foi trazido, para a nota real nao sair com ele.
            </p>
          )}
        </div>
      )}

      {erro && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}

      {previa && <PainelPrevia previa={previa} />}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={conferindo || enviando} onClick={conferir}>
          {conferindo ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
          Ver previa
        </Button>
        {podeTestar && (
          <Button
            type="button"
            variant="secondary"
            disabled={enviando || conferindo}
            onClick={() => pedirConfirmacao("2")}
          >
            Emitir em teste
          </Button>
        )}
        {podeValer && (
          <Button type="submit" disabled={enviando || conferindo}>
            {enviando && <Loader2 className="size-4 animate-spin" />}
            Emitir NF-e
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => router.navigate({ to: "/nfe" })}>
          Cancelar
        </Button>
        <span className="text-xs text-muted-foreground">
          {podeTestar
            ? "A previa nao emite nada. “Emitir em teste” vai para a SEFAZ de homologacao e fica salvo para reaproveitar."
            : "A previa nao emite nada e nao gasta numeracao."}
        </span>
      </div>

      {confirmando && (
        <ConfirmacaoEmissao
          ambiente={ambiente}
          serie={serie}
          numero={numero}
          destinatario={dest.nome}
          total={totalNota}
          conferida={previa !== null}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={confirmarEmissao}
        />
      )}
    </form>
  );
}

/**
 * Depois de autorizada: a entrega do documento.
 *
 * A tela antes navegava para a lista com um "Nota autorizada." e pronto — e o
 * `danfePdf` que veio na resposta era descartado. O operador ficava com uma
 * confirmação e sem o documento, tendo que descobrir sozinho que existe onde
 * buscá-lo.
 *
 * O XML é o documento fiscal; o PDF é a representação gráfica. Os dois ficam
 * aqui, em destaque, antes de qualquer navegação.
 */
function NotaEmitida({
  doc, ambiente, onNova, onLista,
}: {
  doc: DocumentoFiscal;
  ambiente: Ambiente;
  onNova: () => void;
  onLista: () => void;
}) {
  const chave = String(doc.chave ?? "");
  const avisos = Array.isArray(doc["avisos"]) ? (doc["avisos"] as string[]) : [];
  const ajustes = Array.isArray(doc["cfopAjustado"])
    ? (doc["cfopAjustado"] as Array<{ item: number; de: string; para: string }>)
    : [];

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-6">
        <div>
          <h2 className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">
            {ambiente === "1" ? "Nota autorizada pela SEFAZ" : "Nota autorizada em homologacao"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {ambiente === "1"
              ? "Documento fiscal valido. Guarde o XML — e ele que vale, e e o que a contabilidade pede."
              : "Teste: a SEFAZ validou tudo, mas o documento nao existe fiscalmente."}
          </p>
        </div>

        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Nota</dt>
            <dd className="font-medium">{String(doc.numero ?? "?")} / serie {String(doc.serie ?? "?")}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Protocolo</dt>
            <dd className="font-medium">{String(doc.protocolo ?? "-")}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Destinatario</dt>
            <dd className="truncate font-medium">{String(doc.destinatario ?? "-")}</dd>
          </div>
        </dl>

        {chave && (
          <div>
            <p className="text-xs uppercase text-muted-foreground">Chave de acesso</p>
            <p className="break-all font-mono text-sm">{chave}</p>
          </div>
        )}

        {chave && (
          <div className="border-t border-emerald-500/30 pt-4">
            <p className="mb-3 text-sm font-medium">Baixe os arquivos desta nota</p>
            <BaixarDocumento tipo="nfe" chave={chave} />
          </div>
        )}
      </section>

      {ajustes.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <div className="mb-1 font-medium">CFOP corrigido pelo sentido da nota</div>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {ajustes.map((c) => (
              <li key={c.item}>Item {c.item}: {c.de} → <strong>{c.para}</strong></li>
            ))}
          </ul>
        </section>
      )}

      {avisos.length > 0 && (
        <section className="space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-700 dark:text-amber-400">
          {avisos.map((a, i) => (
            <p key={i} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{a}</span>
            </p>
          ))}
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={onNova}>Emitir outra nota</Button>
        <Button type="button" variant="outline" onClick={onLista}>Ver todas as notas</Button>
      </div>
    </div>
  );
}

/**
 * O resultado da prévia.
 *
 * Mostra os totais que vieram do objeto montado pela API, não uma conta da tela
 * — se a prévia recalculasse por conta, poderia exibir um valor e enviar outro,
 * que é justamente o erro que ela deveria pegar.
 */
function PainelPrevia({ previa }: { previa: PreviaNota }) {
  const nfe = (previa.nfe ?? {}) as Record<string, any>;
  const total = nfe["total"]?.["ICMSTot"] ?? nfe["total"] ?? {};

  // Produtos e total aparecem sempre; os demais só quando têm valor, senão a
  // conferência vira uma parede de R$ 0,00 e o que importa se perde no meio.
  const linhas: Array<[string, number]> = [];
  const incluir = (rotulo: string, campo: string, sempre = false) => {
    const bruto = total[campo];
    if (bruto === undefined || bruto === null) return;
    const v = Number(bruto);
    if (Number.isFinite(v) && (sempre || v !== 0)) linhas.push([rotulo, v]);
  };
  incluir("Produtos", "vProd", true);
  incluir("Desconto", "vDesc");
  incluir("Frete", "vFrete");
  incluir("ICMS", "vICMS");
  incluir("IPI", "vIPI");
  incluir("Total da nota", "vNF", true);

  return (
    <section className="space-y-4 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-6">
      {/* A frase anterior dizia "passou na validacao da SEFAZ", e era falsa duas
          vezes: a previa nao fala com a SEFAZ (ela monta o XML e confere contra
          o schema oficial, aqui mesmo) e schema so ve FORMA. CSOSN errado numa
          mercadoria isenta passa com folga — e um codigo valido no lugar valido.
          Dizer o que foi conferido, e o que nao foi, vale mais que um selo. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          Previa montada — a estrutura do XML esta correta
        </h2>
        <span className="text-xs text-muted-foreground">
          Nota {previa.numero}/{previa.serie} ·{" "}
          {previa.ambiente === "1" ? "producao" : "homologacao"} · nada foi emitido
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Conferido contra o schema oficial da NF-e: campos, formatos e ordem. Isso
        nao diz que o <strong>enquadramento tributario</strong> esta certo — CFOP,
        CST/CSOSN, NCM e classificacao de IBS/CBS passam no schema mesmo quando
        estao errados para o produto. Quem responde por eles e a contabilidade.
      </p>

      {linhas.length > 0 && (
        <div className="grid gap-4 text-sm sm:grid-cols-3">
          {linhas.map(([rotulo, valor]) => (
            <div key={rotulo}>
              <div className="text-xs uppercase text-muted-foreground">{rotulo}</div>
              <div className={rotulo === "Total da nota" ? "text-lg font-semibold" : "font-medium"}>
                {brl(valor)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* O servidor corrigiu o CFOP. Esconder isso trocaria uma rejeicao visivel
          por uma nota diferente da que o operador pediu, sem ele saber. */}
      {previa.cfopAjustado?.length ? (
        <div className="rounded-md border border-border bg-background/60 p-3 text-sm">
          <div className="mb-1 font-medium">CFOP corrigido pelo sentido da nota</div>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {previa.cfopAjustado.map((c) => (
              <li key={c.item}>
                Item {c.item}: <span className="line-through">{c.de}</span> → <strong>{c.para}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Defaults fiscais aplicados por falta de informacao. Um default que
          ninguem ve e indistinguivel de uma decisao consciente. */}
      {previa.avisos?.length ? (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          {previa.avisos.map((a, i) => (
            <p key={i} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{a}</span>
            </p>
          ))}
        </div>
      ) : null}

      {previa.schemaValidado === false && (
        <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          A conferencia contra o schema oficial da SEFAZ nao pode ser executada.
          Isto significa "nao deu para conferir", nao "esta tudo certo".
        </p>
      )}

      {previa.chaveAcesso && (
        <p className="break-all text-xs text-muted-foreground">
          Chave provisoria da previa: {previa.chaveAcesso} — a nota emitida tera outra.
        </p>
      )}
    </section>
  );
}

/**
 * Confirmação antes de emitir.
 *
 * Existe porque a nota de produção não se apaga: uma vez autorizada, só o
 * cancelamento a desfaz — e o cancelamento tem prazo. O passo separa "terminei
 * de preencher" de "assumo este documento".
 */
function ConfirmacaoEmissao({
  ambiente, serie, numero, destinatario, total, conferida, onCancelar, onConfirmar,
}: {
  ambiente: Ambiente;
  serie: string;
  numero: string;
  destinatario: string;
  total: number;
  conferida: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const producao = ambiente === "1";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancelar}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-xl border border-border bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">
          {producao ? "Emitir a nota valendo?" : "Emitir em teste?"}
        </h2>

        <p className={producao ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {producao
            ? "Esta nota tera valor fiscal e juridico. Depois de autorizada ela nao pode ser apagada — apenas cancelada, e o cancelamento tem prazo."
            : "Nota de homologacao: a SEFAZ valida tudo, mas o documento nao existe fiscalmente e nao consome numero da serie real."}
        </p>

        <dl className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Nota</dt>
            <dd className="font-medium">{numero || "?"} / serie {serie}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Destinatario</dt>
            <dd className="truncate font-medium">{destinatario || "-"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Total</dt>
            <dd className="font-medium">{brl(total)}</dd>
          </div>
        </dl>

        {producao && !conferida && (
          <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Voce ainda nao gerou a previa desta nota. Conferir antes nao custa nada
            e nao gasta numeracao.
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onCancelar}>
            Voltar
          </Button>
          <Button
            type="button"
            variant={producao ? "destructive" : "default"}
            onClick={onConfirmar}
          >
            {producao ? "Emitir valendo" : "Emitir teste"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Conferência de tributos.
 *
 * Não é campo de digitação: é o que o contador olha antes de autorizar, e onde
 * um item sem ST ou com base errada aparece. Fica recolhido porque quem só
 * fatura não precisa abrir.
 *
 * Os valores são estimativa da tela, calculada com o que a classificação
 * devolveu. Quem fecha a conta é a SEFAZ — por isso o aviso no rodapé.
 */
function QuadroTributos({ itens, entrada }: { itens: Item[]; entrada: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<"tributos" | "ibscbs">("tributos");

  const calculados = itens
    .filter((it) => num(it.quantidade) > 0)
    .map((it) => {
      const bruto = num(it.quantidade) * num(it.valorUnitario);
      const base = Math.max(0, bruto - Math.min(num(it.desconto), bruto));
      // Só CST que efetivamente tributa gera ICMS; no Simples (CSOSN) não há
      // destaque na nota.
      const tributaIcms = ["00", "10", "20", "70"].includes(String(it.cstIcms ?? ""));
      const vICMS = tributaIcms ? (base * num(it.aliqIcms ?? "0")) / 100 : 0;
      const vIPI = (base * num(it.aliqIpi ?? "0")) / 100;

      // IBS/CBS: a tela imprimia CST 000 fixo e sempre 0,1% e 0,9%, fosse qual
      // fosse o produto. Numa banana — alíquota zero pelo Anexo XV — mostrava
      // tributo a pagar. O CST manda no valor, aqui como no motor: fora da
      // tributação integral não há valor destacado, e o CST 200 (alíquota
      // reduzida) paga o que sobra depois da redução.
      const cstIbs = it.ibscbsCst || "000";
      const reduz = cstIbs === "200";
      // A redução vem do cadastro ou da tabela oficial; o único código que o
      // motor traz embutido é o 200014 (hortícolas, frutas e ovos, 100%). Fora
      // dele o motor RECUSA a emissão em vez de chutar — então assumir 100% aqui
      // faria a tela prometer R$ 0,00 numa nota que nem vai sair. Sem saber a
      // redução, a estimativa é desconhecida, não zero.
      const redInformada = it.ibscbsPRedAliq
        ? Math.min(100, Math.max(0, num(it.ibscbsPRedAliq)))
        : it.ibscbsCclasstrib === "200014"
          ? 100
          : null;
      const pRed = reduz ? redInformada : 0;
      const tributaIbs = ["000", "010", "011"].includes(cstIbs) || reduz;
      const fator = !tributaIbs ? 0 : pRed == null ? null : (100 - pRed) / 100;

      return {
        descricao: it.descricao || "(sem descricao)",
        cst: it.cstIcms ?? "-",
        cstIbs,
        pRed: reduz ? pRed : null,
        // `null` = não dá para estimar. A tabela mostra isso em vez de um valor.
        indefinido: fator == null,
        base,
        vBC: tributaIcms ? base : 0,
        vICMS,
        vIPI,
        vIBS: (base * 0.1 * (fator ?? 0)) / 100,
        vCBS: (base * 0.9 * (fator ?? 0)) / 100,
      };
    });

  const soma = (campo: "base" | "vBC" | "vICMS" | "vIPI" | "vIBS" | "vCBS") =>
    calculados.reduce((n, c) => n + c[campo], 0);

  if (!calculados.length) return null;

  return (
    <section className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <span className="text-sm font-semibold text-muted-foreground">
          Conferencia de tributos
        </span>
        <span className="text-xs text-muted-foreground">
          {aberto ? "ocultar" : "ver detalhes"}
        </span>
      </button>

      {aberto && (
        <div className="space-y-4 border-t border-border px-6 py-4">
          <div className="flex gap-1 border-b border-border">
            {([
              ["tributos", "Tributos"],
              ["ibscbs", "IBS / CBS"],
            ] as const).map(([id, texto]) => (
              <button
                key={id}
                type="button"
                onClick={() => setAba(id)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                  aba === id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {texto}
              </button>
            ))}
          </div>

          {aba === "tributos" ? (
            <div className="grid gap-4 text-sm sm:grid-cols-4">
              <Valor rotulo="Base ICMS" valor={soma("vBC")} />
              <Valor rotulo="ICMS" valor={soma("vICMS")} />
              <Valor rotulo="IPI" valor={soma("vIPI")} />
              <Valor rotulo="Produtos" valor={soma("base")} />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                      <th className="px-2 py-2 font-medium">#</th>
                      <th className="px-2 py-2 font-medium">Produto</th>
                      <th className="px-2 py-2 font-medium">CST</th>
                      <th className="px-2 py-2 text-right font-medium">Base</th>
                      <th className="px-2 py-2 text-right font-medium">IBS</th>
                      <th className="px-2 py-2 text-right font-medium">CBS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calculados.map((c, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="px-2 py-2">{i + 1}</td>
                        <td className="px-2 py-2">{c.descricao}</td>
                        <td className="px-2 py-2">
                          {c.cstIbs}
                          {c.pRed != null && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              −{c.pRed}%
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">{brl(c.base)}</td>
                        {/* Sem a redução não dá para estimar, e o motor recusa a
                            emissão nesse caso. Mostrar R$ 0,00 aqui prometeria
                            uma nota isenta que nem vai sair. */}
                        {c.indefinido ? (
                          <td colSpan={2} className="px-2 py-2 text-right text-xs text-warning-tint">
                            falta a reducao do CST 200 no cadastro
                          </td>
                        ) : (
                          <>
                            <td className="px-2 py-2 text-right">{brl(c.vIBS)}</td>
                            <td className="px-2 py-2 text-right">{brl(c.vCBS)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-4 text-sm sm:grid-cols-3">
                <Valor rotulo="IBS estadual (0,1%)" valor={soma("vIBS")} />
                <Valor rotulo="CBS (0,9%)" valor={soma("vCBS")} />
                <Valor rotulo="IBS + CBS" valor={soma("vIBS") + soma("vCBS")} destaque />
              </div>
              <p className="text-xs text-muted-foreground">
                Aliquotas de transicao de 2026, fixadas pela SEFAZ. Em 2026 nao ha recolhimento
                para quem emite os documentos corretamente (LC 214/2025).
              </p>
              {/* A frase daqui dizia que o destaque "e obrigatorio". Deixou de
                  ser: o Ato Tecnico Conjunto RFB/CGIBS 1/2026 adiou as
                  validacoes e a rejeicao por ausencia saiu de producao. O que
                  ninguem espera e a inversao — hoje o erro que rejeita e
                  preencher errado, nao deixar em branco. */}
              <p className="text-xs text-muted-foreground">
                A rejeicao por <em>falta</em> destes campos esta suspensa desde agosto de 2026
                (Ato Tecnico Conjunto RFB/CGIBS 1/2026), e para empresa do Simples a
                obrigatoriedade so comeca em 01/01/2027. O dever de destacar continua — mas o
                risco hoje e o contrario do que parece: <strong>informar errado rejeita a nota;
                deixar em branco, nao</strong>.
              </p>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Estimativa para conferencia, calculada com a classificacao de cada item
            {entrada ? " (nota de entrada)" : ""}. Os valores oficiais sao os que a SEFAZ
            autorizar.
          </p>
        </div>
      )}
    </section>
  );
}

function Valor({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{rotulo}</div>
      <div className={destaque ? "text-lg font-semibold" : "font-medium"}>{brl(valor)}</div>
    </div>
  );
}

/** Uma linha da lista de itens, com busca de produto e de NCM. */
function LinhaItem({
  indice, item, podeRemover, entrada, onAlterar, onNcmCompleto, onUsarProduto, onRemover,
}: {
  indice: number;
  item: Item;
  podeRemover: boolean;
  entrada: boolean;
  onAlterar: (campo: keyof Item, valor: string) => void;
  onNcmCompleto: (ncm: string) => void;
  onUsarProduto: (p: ProdutoCatalogo) => void;
  onRemover: () => void;
}) {
  const procurarNcm = useServerFn(buscarNcm);
  const procurarProduto = useServerFn(buscarProdutos);
  const [sugestoesNcm, setSugestoesNcm] = useState<SugestaoNcm[]>([]);
  const [produtos, setProdutos] = useState<ProdutoCatalogo[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Busca com atraso: sem isso cada tecla vira uma requisição.
  function aoDigitarDescricao(valor: string) {
    onAlterar("descricao", valor);
    if (timer.current) clearTimeout(timer.current);
    if (valor.trim().length < 3) { setSugestoesNcm([]); setProdutos([]); return; }
    timer.current = setTimeout(async () => {
      const [p, n] = await Promise.all([
        procurarProduto({ data: { termo: valor } }).catch(() => null),
        procurarNcm({ data: { termo: valor } }).catch(() => null),
      ]);
      setProdutos(p && p.ok ? p.data.slice(0, 5) : []);
      setSugestoesNcm(n && n.ok ? n.data.slice(0, 5) : []);
    }, 300);
  }

  const totalItem = num(item.quantidade) * num(item.valorUnitario) - num(item.desconto);

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-background/40 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">Item {indice}</span>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{brl(Math.max(0, totalItem))}</span>
          {podeRemover && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemover} aria-label="Remover item">
              <Trash2 className="size-4 text-destructive" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-6">
        <Campo label="Codigo" dica="Opcional.">
          <Input value={item.codigo} onChange={(e) => onAlterar("codigo", e.target.value)} />
        </Campo>

        <div className="relative space-y-2 sm:col-span-3">
          <Label>Descricao do produto</Label>
          <Input
            value={item.descricao}
            onChange={(e) => aoDigitarDescricao(e.target.value)}
            placeholder="Digite e escolha do catalogo ou pelo NCM"
            autoComplete="off"
          />
          {(produtos.length > 0 || sugestoesNcm.length > 0) && (
            <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
              {produtos.map((p) => (
                <button
                  key={"p" + p.id}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => { onUsarProduto(p); setProdutos([]); setSugestoesNcm([]); }}
                >
                  <span className="font-medium">{p.descricao}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    catalogo · NCM {p.ncm}{p.valorUnitario ? ` · ${brl(Number(p.valorUnitario))}` : ""}
                  </span>
                </button>
              ))}
              {sugestoesNcm.map((s) => (
                <button
                  key={"n" + s.codigo}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onAlterar("ncm", s.codigo);
                    onNcmCompleto(s.codigo);
                    setProdutos([]); setSugestoesNcm([]);
                  }}
                >
                  <span className="font-mono text-xs">{s.codigo}</span>
                  <span className="ml-2">{s.descricao}</span>
                  {s.usos ? <span className="ml-2 text-xs text-muted-foreground">usado {s.usos}x</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <Campo label="NCM">
          <Input
            value={item.ncm}
            onChange={(e) => onAlterar("ncm", e.target.value)}
            onBlur={(e) => onNcmCompleto(e.target.value)}
            placeholder="00000000"
          />
        </Campo>
        <Campo label="Unidade">
          <Input value={item.unidade} onChange={(e) => onAlterar("unidade", e.target.value)} />
        </Campo>
      </div>

      {/* `origem` já era ENVIADA por montarNota e nenhum input a preenchia:
          toda nota saía com 0 (nacional). Numa mercadoria importada isso é
          declaração falsa, e a origem também manda na alíquota interestadual —
          importada é 4%, não 12% nem 7%. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Origem da mercadoria" dica="Manda na aliquota interestadual: importada e 4%.">
          <select
            value={item.origem ?? "0"}
            onChange={(e) => onAlterar("origem", e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {[
              ["0", "0 - Nacional"],
              ["1", "1 - Importacao direta"],
              ["2", "2 - Mercado interno, importado"],
              ["3", "3 - Nacional, mais de 40% importado"],
              ["4", "4 - Nacional, processos produtivos basicos"],
              ["5", "5 - Nacional, ate 40% importado"],
              ["6", "6 - Importacao direta, sem similar nacional"],
              ["7", "7 - Mercado interno, sem similar nacional"],
              ["8", "8 - Nacional, mais de 70% importado"],
            ].map(([v2, t]) => <option key={v2} value={v2}>{t}</option>)}
          </select>
        </Campo>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Campo label="Quantidade">
          <Input value={item.quantidade} onChange={(e) => onAlterar("quantidade", e.target.value)} placeholder="0" />
        </Campo>
        <Campo label="Valor unitario (R$)">
          <Input value={item.valorUnitario} onChange={(e) => onAlterar("valorUnitario", e.target.value)} placeholder="0,00" />
        </Campo>
        <Campo label="Desconto (R$)">
          <Input value={item.desconto} onChange={(e) => onAlterar("desconto", e.target.value)} placeholder="0,00" />
        </Campo>
        <div className="flex flex-col justify-end pb-1 text-xs text-muted-foreground">
          {item.cfop ? (
            <span>
              CFOP {cfopNoSentido(item.cfop, entrada) || item.cfop}
              {item.cstIcms ? ` · CST ${item.cstIcms}` : ""}
              {item.fonteClassificacao ? ` · ${item.fonteClassificacao}` : ""}
            </span>
          ) : (
            <span>Preencha o NCM para classificar</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Campo({
  label, dica, span, children,
}: { label: string; dica?: string; span?: boolean | number; children: React.ReactNode }) {
  const classe = span === true || span === 2 ? "sm:col-span-2" : span === 3 ? "sm:col-span-3" : span === 4 ? "sm:col-span-4" : "";
  return (
    <div className={`space-y-2 ${classe}`}>
      <Label>{label}</Label>
      {children}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}

function Selecao({
  value, onChange, opcoes,
}: { value: string; onChange: (v: string) => void; opcoes: Array<{ valor: string; texto: string }> }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {opcoes.map((o) => (
        <option key={o.valor} value={o.valor}>{o.texto}</option>
      ))}
    </select>
  );
}

// ─────────────────────────────── NFS-e ───────────────────────────────

/**
 * Emissão de NFS-e.
 *
 * O serviço vem de um de dois lugares, e a tela precisa dos dois: do catálogo da
 * empresa, pelo `servicoCodigo` — que traz valor, alíquota e ISS retido prontos —
 * ou informado na hora, e aí o que a API exige é o **código de tributação
 * nacional** de 6 dígitos, não o item da LC 116.
 *
 * A versão anterior pedia "Código do serviço" como texto livre e mandava a
 * descrição no campo `servico`, que é um objeto. Resultado: 400 em todo
 * cenário — nenhuma NFS-e era emitida, nunca.
 */
function EmissaoNfse() {
  const emitir = useServerFn(emitirDocumento);
  const conferir = useServerFn(previaNfse);
  const pegarServicos = useServerFn(listarServicosNfse);
  const router = useRouter();
  const qc = useQueryClient();

  const [v, setV] = useState<Record<string, string>>({});
  const [observacoes, setObservacoes] = useState("");
  // A NFS-e emitia SEMPRE em producao: nao mandava ambiente, o servidor caia no
  // default "1", e o dialogo de confirmacao fixava "1" — entao nem o aviso
  // vermelho de "nota real" mudava. Nao havia como testar um servico novo.
  const [ambiente, setAmbiente] = useState<Ambiente>("1");
  const [ambientePermitido, setAmbientePermitido] = useState<string | null>(null);
  const [catalogo, setCatalogo] = useState<ServicoNfse[]>([]);
  const [usarCatalogo, setUsarCatalogo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Prévia e entrega, que só a NF-e tinha. Na NFS-e o erro só aparecia depois
  // de emitir — e NFS-e errada não se corrige por carta, só substituindo.
  const [previa, setPrevia] = useState<Record<string, unknown> | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const [emitida, setEmitida] = useState<DocumentoFiscal | null>(null);

  const pegarStatus = useServerFn(statusFiscal);
  useEffect(() => {
    let ativo = true;
    pegarStatus({})
      .then((r) => {
        if (!ativo || !r.ok) return;
        const permitido = r.data.ambientePermitido ?? null;
        setAmbientePermitido(permitido);
        // Credencial restrita: adota o que ela permite, em vez de oferecer um
        // ambiente que volta 403.
        if (permitido === "homologacao") setAmbiente("2");
        if (permitido === "producao") setAmbiente("1");
      })
      .catch(() => {});
    return () => { ativo = false; };
  }, [pegarStatus]);

  useEffect(() => {
    let ativo = true;
    pegarServicos({})
      .then((r) => {
        if (!ativo || !r.ok) return;
        setCatalogo(r.data);
        // Havendo catálogo, ele é o caminho certo: evita redigitar o código de
        // tributação e a alíquota a cada nota.
        setUsarCatalogo(r.data.length > 0);
      })
      .catch(() => { /* sem catálogo, o formulário manual dá conta */ });
    return () => { ativo = false; };
  }, [pegarServicos]);

  const set = (campo: string, valor: string) => setV((x) => ({ ...x, [campo]: valor }));

  function validar(): string | null {
    if (!v["tomadorNome"]?.trim()) return "Informe o nome do tomador.";
    if (!v["tomadorDocumento"]?.trim()) return "Informe o CPF ou CNPJ do tomador.";
    if (num(v["valorServico"] ?? "") <= 0) return "Informe o valor do servico.";
    if (usarCatalogo) {
      if (!v["servicoCodigo"]) return "Escolha o servico no catalogo.";
      return null;
    }
    const cTrib = (v["codigoTributacaoNacional"] ?? "").replace(/\D/g, "");
    if (cTrib.length !== 6) {
      return "O codigo de tributacao nacional tem 6 digitos. Nao e o item da LC 116 — confirme com a contabilidade.";
    }
    if (!v["servicoDescricao"]?.trim()) return "Descreva o servico prestado.";
    return null;
  }

  /**
   * O payload que as DUAS ações usam.
   *
   * Montado num lugar só para que a prévia confira literalmente o que a emissão
   * envia — duas cópias divergem, e uma prévia que mostra outra coisa é pior que
   * prévia nenhuma.
   */
  function montarPayload(): PayloadNfse {
    // Só um dos dois caminhos viaja: mandar os dois faria o catálogo vencer e
    // o que está na tela ser ignorado em silêncio.
    const tomador = {
      tomadorNome: v["tomadorNome"] ?? "",
      tomadorDocumento: v["tomadorDocumento"] ?? "",
      tomadorEmail: v["tomadorEmail"] ?? "",
      // O endereço só é preenchido quando há retenção; vazio, some do corpo.
      tomadorLogradouro: v["tomadorLogradouro"] ?? "",
      tomadorNumeroEnd: v["tomadorNumeroEnd"] ?? "",
      tomadorBairro: v["tomadorBairro"] ?? "",
      tomadorMunicipio: v["tomadorMunicipio"] ?? "",
      tomadorCodigoMunicipio: v["tomadorCodigoMunicipio"] ?? "",
      tomadorUf: v["tomadorUf"] ?? "",
      tomadorCep: v["tomadorCep"] ?? "",
    };
    const retencoes = montarRetencoes();
    return usarCatalogo
      ? {
          ...tomador,
          servicoCodigo: v["servicoCodigo"] ?? "",
          valorServico: v["valorServico"] ?? "",
          observacoes,
          ...(retencoes ? { retencoes } : {}),
        }
      : {
          ...(retencoes ? { retencoes } : {}),
          ...tomador,
          codigoTributacaoNacional: v["codigoTributacaoNacional"] ?? "",
          servicoDescricao: v["servicoDescricao"] ?? "",
          aliquota: v["aliquota"] ?? "",
          issRetido: v["issRetido"] ?? "1",
          valorServico: v["valorServico"] ?? "",
          observacoes,
        };
  }

  /**
   * Retencao federal em reais, a partir do percentual do catalogo.
   *
   * Vazio nao vira zero: em branco quer dizer "nao se aplica a este servico" e o
   * campo nem aparece; zero e uma decisao de quem emite e vai no XML.
   */
  function valorRetido(campo: string): string {
    const manual = v[`ret_${campo}`];
    if (manual !== undefined) return manual;
    if (!aplicarRetencao) return "";
    const aliq = num(String(servicoEscolhido?.[campo as keyof typeof servicoEscolhido] ?? ""));
    if (!aliq) return "";
    const base = num(v["valorServico"] ?? "");
    if (!base) return "";
    return ((base * aliq) / 100).toFixed(2);
  }

  /**
   * O corpo `retencoes` que a API espera.
   *
   * PIS e COFINS vao num grupo unico com CST comum, diferente do resto — e
   * `retido: "1"` ali significa retido pelo tomador.
   */
  function montarRetencoes(): Record<string, unknown> | null {
    const irrf = valorRetido("aliqIrrf");
    const csll = valorRetido("aliqCsll");
    const inss = valorRetido("aliqInss");
    const pis = valorRetido("aliqPis");
    const cofins = valorRetido("aliqCofins");
    if (!irrf && !csll && !inss && !pis && !cofins) return null;
    return {
      ...(irrf ? { valorRetidoIRRF: irrf } : {}),
      ...(csll ? { valorRetidoCSLL: csll } : {}),
      ...(inss ? { valorRetidoINSS: inss } : {}),
      ...(pis || cofins
        ? {
            pisCofins: {
              cst: "01",
              ...(pis ? { valorPis: pis } : {}),
              ...(cofins ? { valorCofins: cofins } : {}),
              retido: "1",
            },
          }
        : {}),
    };
  }

  async function onConferir() {
    const problema = validar();
    setErro(problema);
    if (problema) return;
    setConferindo(true);
    setPrevia(null);
    try {
      const res = await conferir({ data: { payload: montarPayload(), ambiente } });
      if (res.ok) setPrevia((res.data ?? {}) as Record<string, unknown>);
      else setErro(res.error);
    } catch {
      setErro("Nao foi possivel conferir a nota.");
    } finally {
      setConferindo(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problema = validar();
    setErro(problema);
    if (!problema) setConfirmando(true);
  }

  async function confirmarEmissao() {
    setConfirmando(false);
    setEnviando(true);
    setErro(null);
    try {
      const payload = montarPayload();

      const res = await emitir({ data: { tipo: "nfse", payload, ambiente } });
      if (res.ok) {
        toast.success("NFS-e emitida.");
        qc.invalidateQueries({ queryKey: ["docs", "nfse"] });
        // Navegar embora DESCARTAVA a resposta inteira: o operador emitia e
        // ficava sem chave, sem XML e sem PDF, tendo de caçar a nota na lista
        // para baixar o que acabou de gerar. A NF-e já entregava; esta não.
        setEmitida(res.data);
        setPrevia(null);
      } else {
        setErro(res.error);
        toast.error(res.error);
      }
    } catch {
      setErro("Nao foi possivel emitir o documento.");
    } finally {
      setEnviando(false);
    }
  }

  const servicoEscolhido = catalogo.find((s) => s.codigo === v["servicoCodigo"]);
  // Quem retem tributo federal e pessoa juridica. Com 11 digitos e CPF, e a
  // sugestao tem de sair sozinha da tela — deixar marcado ali retiraria imposto
  // de quem nao retem, e o prestador receberia a menos sem entender por que.
  const tomadorEhPj = String(v["tomadorDocumento"] ?? "").replace(/\D/g, "").length === 14;
  const temAliquota = RETENCOES_FEDERAIS.some(
    (r) => num(String(servicoEscolhido?.[r.campo as keyof typeof servicoEscolhido] ?? "")) > 0,
  );
  const aplicarRetencao = v["aplicarRetencao"] === undefined
    ? tomadorEhPj
    : v["aplicarRetencao"] === "1";

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-6">
      <section className="space-y-4 rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-muted-foreground">Tomador</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Nome / Razao social" span={2}>
            <Input required value={v["tomadorNome"] ?? ""} onChange={(e) => set("tomadorNome", e.target.value)} />
          </Campo>
          <Campo label="CPF / CNPJ">
            <Input required value={v["tomadorDocumento"] ?? ""} onChange={(e) => set("tomadorDocumento", e.target.value)} />
          </Campo>
          <Campo label="E-mail" dica="Opcional. Recebe a nota por e-mail.">
            <Input type="email" value={v["tomadorEmail"] ?? ""} onChange={(e) => set("tomadorEmail", e.target.value)} />
          </Campo>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Servico</h2>
          {catalogo.length > 0 && (
            <button
              type="button"
              className="text-xs text-primary underline-offset-4 hover:underline"
              onClick={() => setUsarCatalogo((x) => !x)}
            >
              {usarCatalogo ? "Informar um servico fora do catalogo" : "Escolher do catalogo"}
            </button>
          )}
        </div>

        {usarCatalogo ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              label="Servico do catalogo"
              span={2}
              dica="Traz valor, aliquota e ISS retido ja preenchidos."
            >
              <Selecao
                value={v["servicoCodigo"] ?? ""}
                onChange={(codigo) => {
                  set("servicoCodigo", codigo);
                  const s = catalogo.find((x) => x.codigo === codigo);
                  if (s?.valorPadrao && !v["valorServico"]) set("valorServico", String(s.valorPadrao));
                }}
                opcoes={[
                  { valor: "", texto: "Selecione..." },
                  ...catalogo.map((s) => ({ valor: s.codigo, texto: `${s.codigo} — ${s.descricao}` })),
                ]}
              />
            </Campo>
            {servicoEscolhido && (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Tributacao nacional {servicoEscolhido.codigoTributacaoNacional ?? "—"}
                {servicoEscolhido.aliquotaIss ? ` · ISS ${servicoEscolhido.aliquotaIss}%` : ""}
                {servicoEscolhido.issRetido === "2"
                  ? " · ISS retido pelo tomador"
                  : servicoEscolhido.issRetido === "3"
                    ? " · ISS retido pelo intermediario"
                    : ""}
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              label="Codigo de tributacao nacional"
              dica="6 digitos. NAO e o item da LC 116 — confirme com a contabilidade."
            >
              <Input
                required
                inputMode="numeric"
                placeholder="010701"
                value={v["codigoTributacaoNacional"] ?? ""}
                onChange={(e) => set("codigoTributacaoNacional", e.target.value)}
              />
            </Campo>
            <Campo label="Aliquota ISS (%)" dica="Deixe vazio para usar a do municipio.">
              <Input value={v["aliquota"] ?? ""} onChange={(e) => set("aliquota", e.target.value)} />
            </Campo>
            <Campo label="Descricao do servico prestado" span={2}>
              <Input required value={v["servicoDescricao"] ?? ""} onChange={(e) => set("servicoDescricao", e.target.value)} />
            </Campo>
            {/* A polaridade e o contrario da intuicao: no XSD (tpRetISSQN) o "1"
                significa NAO retido. A tela oferecia 0/1 e o servidor convertia
                para booleano, entao escolher "Retido" mandava `true`, que virava
                a string "true" e a API recusava; escolher "Nao retido" mandava
                `false`, que virava "1" e acertava por acidente. Agora os valores
                da tela SAO os da API — nao ha conversao no meio. */}
            <Campo label="Retencao do ISS" dica="Retido exige o endereco completo do tomador (rejeicao E0237).">
              <Selecao
                value={v["issRetido"] ?? "1"}
                onChange={(x) => set("issRetido", x)}
                opcoes={[
                  { valor: "1", texto: "Nao retido — quem recolhe e o prestador" },
                  { valor: "2", texto: "Retido pelo tomador" },
                  { valor: "3", texto: "Retido pelo intermediario" },
                ]}
              />
            </Campo>
          </div>
        )}

        {/* O endereço do tomador só é exigido quando o ISS é retido (E0237).
            Pedir sempre encheria a tela para o caso comum; não pedir nunca —
            que era o estado anterior — deixava a retenção impossível. */}
        {(v["issRetido"] === "2" || v["issRetido"] === "3") && (
          <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
            <p className="text-xs text-warning-tint">
              Com ISS retido a SEFIN exige o endereco completo do tomador.
            </p>
            <div className="grid gap-4 sm:grid-cols-4">
              <Campo label="Logradouro" span={2}>
                <Input value={v["tomadorLogradouro"] ?? ""} onChange={(e) => set("tomadorLogradouro", e.target.value)} />
              </Campo>
              <Campo label="Numero">
                <Input placeholder="S/N" value={v["tomadorNumeroEnd"] ?? ""} onChange={(e) => set("tomadorNumeroEnd", e.target.value)} />
              </Campo>
              <Campo label="Bairro">
                <Input value={v["tomadorBairro"] ?? ""} onChange={(e) => set("tomadorBairro", e.target.value)} />
              </Campo>
              <Campo label="Municipio">
                <Input value={v["tomadorMunicipio"] ?? ""} onChange={(e) => set("tomadorMunicipio", e.target.value)} />
              </Campo>
              <Campo label="Codigo IBGE" dica="7 digitos. E ele que a SEFIN confere.">
                <Input value={v["tomadorCodigoMunicipio"] ?? ""} onChange={(e) => set("tomadorCodigoMunicipio", e.target.value)} />
              </Campo>
              <Campo label="UF">
                <Input maxLength={2} value={v["tomadorUf"] ?? ""} onChange={(e) => set("tomadorUf", e.target.value.toUpperCase())} />
              </Campo>
              <Campo label="CEP">
                <Input value={v["tomadorCep"] ?? ""} onChange={(e) => set("tomadorCep", e.target.value)} />
              </Campo>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Valor do servico (R$)">
            <Input required value={v["valorServico"] ?? ""} onChange={(e) => set("valorServico", e.target.value)} />
          </Campo>
        </div>

        {/* Retencoes federais. So aparecem quando o servico do catalogo tem
            aliquota cadastrada — sem isso seriam cinco campos vazios em toda
            nota. O valor sai calculado e continua editavel: o percentual e
            caracteristica do servico, mas o caso concreto e de quem emite. */}
        {temAliquota && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={aplicarRetencao}
                onChange={(e) => set("aplicarRetencao", e.target.checked ? "1" : "0")}
              />
              <span>
                <span className="font-medium">Aplicar retencoes federais</span>
                <span className="block text-xs text-muted-foreground">
                  {tomadorEhPj
                    ? "Tomador e pessoa juridica — normalmente retem."
                    : "Tomador e pessoa fisica: em regra nao retem. Marque so se for o caso."}
                </span>
              </span>
            </label>

            {aplicarRetencao && (
              <div className="grid gap-4 sm:grid-cols-5">
                {RETENCOES_FEDERAIS.filter(
                  (r) => num(String(servicoEscolhido?.[r.campo as keyof typeof servicoEscolhido] ?? "")) > 0,
                ).map((r) => (
                  <Campo
                    key={r.campo}
                    label={`${r.nome} (R$)`}
                    dica={`${servicoEscolhido?.[r.campo as keyof typeof servicoEscolhido]}% do servico`}
                  >
                    <Input
                      value={valorRetido(r.campo)}
                      onChange={(e) => set(`ret_${r.campo}`, e.target.value)}
                    />
                  </Campo>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-xl border border-border bg-card p-6">
        <Label htmlFor="obs">Observacoes</Label>
        <Textarea id="obs" rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
      </section>

      {erro && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}

      {ambientePermitido === "ambos" && (
        <section className="space-y-2 rounded-xl border border-border bg-card p-6">
          <Label>Ambiente</Label>
          <Selecao
            value={ambiente}
            onChange={(x) => setAmbiente(x as Ambiente)}
            opcoes={[
              { valor: "1", texto: "Producao — nota com valor fiscal" },
              { valor: "2", texto: "Homologacao — teste, sem valor fiscal" },
            ]}
          />
        </section>
      )}

      {ambiente === "2" && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-tint">
          Homologacao: a nota nao tem valor fiscal e nao serve para cobrar.
        </p>
      )}

      {/* Prévia da NFS-e: monta a DPS e devolve sem transmitir. Aqui vale mais
          que na NF-e — NFS-e errada não se corrige por carta, só substituindo. */}
      {previa && (
        <section className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-6">
          <h2 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            Previa montada — nada foi emitido
          </h2>
          <p className="text-xs text-muted-foreground">
            A estrutura da DPS esta correta. Isso nao confere o enquadramento do servico:
            codigo de tributacao, aliquota e retencao passam na validacao mesmo errados.
          </p>
          <dl className="grid gap-3 pt-2 text-sm sm:grid-cols-3">
            {[
              ["Tomador", String(v["tomadorNome"] ?? "-")],
              ["Valor", brl(num(v["valorServico"] ?? ""))],
              ["Ambiente", ambiente === "1" ? "producao" : "homologacao"],
            ].map(([r, val]) => (
              <div key={r}>
                <dt className="text-xs uppercase text-muted-foreground">{r}</dt>
                <dd className="font-medium">{val}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Documento entregue na hora. Antes a tela navegava embora e descartava
          a resposta: o operador emitia e ficava sem chave, sem XML e sem PDF. */}
      {emitida?.chave && (
        <section className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-6">
          <h2 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            {ambiente === "1" ? "NFS-e emitida" : "NFS-e emitida em homologacao"}
          </h2>
          <p className="break-all text-xs text-muted-foreground">
            Chave: {String(emitida.chave)}
          </p>
          <BaixarDocumento tipo="nfse" chave={String(emitida.chave)} />
          <div className="flex flex-wrap gap-3 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => { setEmitida(null); setV({}); setObservacoes(""); }}>
              Emitir outra
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => router.navigate({ to: "/nfse" })}>
              Ver todas
            </Button>
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={conferindo || enviando} onClick={onConferir}>
          {conferindo && <Loader2 className="size-4 animate-spin" />} Ver previa
        </Button>
        <Button type="submit" disabled={enviando}>
          {enviando && <Loader2 className="size-4 animate-spin" />}{" "}
          {ambiente === "1" ? "Emitir NFS-e" : "Emitir em teste"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.navigate({ to: "/nfse" })}>
          Cancelar
        </Button>
      </div>

      {confirmando && (
        <ConfirmacaoEmissao
          ambiente={ambiente}
          serie="—"
          numero="automatico"
          destinatario={v["tomadorNome"] ?? ""}
          total={num(v["valorServico"] ?? "")}
          conferida={false}
          onCancelar={() => setConfirmando(false)}
          onConfirmar={confirmarEmissao}
        />
      )}
    </form>
  );
}

// ─────────────────────────────── NFC-e ───────────────────────────────

/**
 * Emissão de NFC-e — o cupom do balcão.
 *
 * **Não é a tela de NF-e com menos campos.** O balcão é outro trabalho: a pessoa
 * está de pé, o cliente esperando, e a venda seguinte vem em seguida. O que essa
 * tela precisa é somar itens rápido e fechar; o que a tela de NF-e precisa é
 * acertar a tributação de uma nota que vale milhares.
 *
 * Três decisões que vêm disso:
 *
 * - **Sem destinatário.** Cupom sem identificação é o caso normal — o CPF é um
 *   campo só, pedido na hora ("CPF na nota?"). Exigir endereço de quem compra um
 *   refrigerante é o que trava o caixa.
 * - **Sem escolher número.** A API reserva o próximo da série. No balcão isso
 *   pesa mais que em qualquer lugar: dois caixas vendendo ao mesmo tempo
 *   receberiam o mesmo número se a tela escolhesse.
 * - **Troco na tela.** Em dinheiro, o operador digita quanto RECEBEU, não quanto
 *   a nota vale. O troco sai daí e vai no XML — a SEFAZ confere que o pagamento
 *   fecha com o total, e recebido sem troco não fecha.
 */
function EmissaoNfce() {
  const emitir = useServerFn(emitirDocumento);
  const router = useRouter();
  const qc = useQueryClient();

  const [itens, setItens] = useState<Item[]>([itemVazio()]);
  const [cpf, setCpf] = useState("");
  const [forma, setForma] = useState("01");
  const [recebido, setRecebido] = useState("");
  const [ambiente, setAmbiente] = useState<Ambiente>("1");
  const [ambientePermitido, setAmbientePermitido] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [emitida, setEmitida] = useState<DocumentoFiscal | null>(null);

  const pegarStatus = useServerFn(statusFiscal);
  useEffect(() => {
    let ativo = true;
    pegarStatus({})
      .then((r) => {
        if (!ativo || !r.ok) return;
        const permitido = r.data.ambientePermitido ?? null;
        setAmbientePermitido(permitido);
        // Credencial restrita adota o que ela permite, em vez de oferecer um
        // ambiente que volta 403 na primeira venda.
        if (permitido === "homologacao") setAmbiente("2");
        if (permitido === "producao") setAmbiente("1");
      })
      .catch(() => { /* status é conveniência: não trava a venda */ });
    return () => { ativo = false; };
  }, [pegarStatus]);

  const total = itens.reduce((s, it) => s + num(it.quantidade) * num(it.valorUnitario), 0);
  const emDinheiro = forma === "01";
  const troco = emDinheiro && num(recebido) > total ? num(recebido) - total : 0;
  const faltaReceber =
    emDinheiro && num(recebido) > 0 && num(recebido) < total ? total - num(recebido) : 0;

  const preenchidos = itens.filter((it) => it.descricao.trim() && num(it.valorUnitario) > 0);

  async function vender(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (!preenchidos.length) {
      setErro("Adicione ao menos um item com descricao e valor.");
      return;
    }
    // Recebido menor que o total não é "pagamento parcial": é digitação pela
    // metade. Deixar passar faz a SEFAZ recusar com 610 depois de transmitir.
    if (faltaReceber > 0) {
      setErro("Valor recebido menor que o total: faltam " + brl(faltaReceber) + ".");
      return;
    }

    setEnviando(true);
    try {
      const res = await emitir({
        data: {
          tipo: "nfce",
          cupom: {
            cpf: cpf || undefined,
            formaPagamento: forma,
            valorRecebido: emDinheiro && num(recebido) > 0 ? recebido : undefined,
            itens: preenchidos.map((it) => ({
              codigo: it.codigo || undefined,
              descricao: it.descricao,
              ncm: it.ncm,
              unidade: it.unidade || undefined,
              quantidade: it.quantidade,
              valorUnitario: it.valorUnitario,
              cfop: it.cfop || undefined,
              cstIcms: it.cstIcms || undefined,
              aliqIcms: it.aliqIcms || undefined,
              cest: it.cest || undefined,
              origem: it.origem || undefined,
              redBcIcms: it.redBcIcms || undefined,
              mva: it.mva || undefined,
              aliqIcmsSt: it.aliqIcmsSt || undefined,
              ibscbsCst: it.ibscbsCst || undefined,
              ibscbsCclasstrib: it.ibscbsCclasstrib || undefined,
              ibscbsPRedAliq: it.ibscbsPRedAliq || undefined,
            })),
          },
          ambiente,
        },
      });
      if (!res.ok) { setErro(res.error); return; }
      setEmitida(res.data);
      qc.invalidateQueries({ queryKey: ["docs"] });
      toast.success("Cupom autorizado");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Nao foi possivel emitir.");
    } finally {
      setEnviando(false);
    }
  }

  function novaVenda() {
    setItens([itemVazio()]);
    setCpf("");
    setRecebido("");
    setEmitida(null);
    setErro(null);
  }

  if (emitida) {
    return (
      <CupomEmitido
        doc={emitida}
        ambiente={ambiente}
        onNova={novaVenda}
        onLista={() => router.navigate({ to: "/nfce" })}
      />
    );
  }

  return (
    <form onSubmit={vender} className="space-y-6">
      {ambiente === "2" && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          Homologacao: o cupom e validado pela SEFAZ mas nao vale fiscalmente.
        </p>
      )}

      <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-6">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Itens da venda</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setItens([...itens, itemVazio()])}
          >
            <Plus className="size-4" /> Item
          </Button>
        </header>

        {itens.map((it, i) => (
          <LinhaItem
            key={it.id}
            indice={i + 1}
            item={it}
            podeRemover={itens.length > 1}
            // Cupom e sempre venda: nao existe NFC-e de entrada.
            entrada={false}
            onAlterar={(campo, valor) =>
              setItens((l) => l.map((x) => (x.id === it.id ? { ...x, [campo]: valor } : x)))}
            onNcmCompleto={(ncm) =>
              setItens((l) => l.map((x) => (x.id === it.id ? { ...x, ncm } : x)))}
            onUsarProduto={(prod) =>
              setItens((l) => l.map((x) => (x.id === it.id ? { ...x, ...camposDoProduto(prod, x) } : x)))}
            onRemover={() => setItens((l) => l.filter((x) => x.id !== it.id))}
          />
        ))}
      </section>

      <section className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 sm:p-6">
        <h2 className="text-sm font-semibold sm:col-span-2">Pagamento</h2>

        <Campo label="Forma">
          <Selecao value={forma} onChange={setForma} opcoes={FORMAS_BALCAO} />
        </Campo>

        {emDinheiro ? (
          <Campo label="Valor recebido" dica="O troco sai daqui e vai no cupom.">
            <Input
              value={recebido}
              onChange={(e) => setRecebido(e.target.value)}
              placeholder={total.toFixed(2)}
              inputMode="decimal"
            />
          </Campo>
        ) : (
          <Campo label="Valor" dica="Igual ao total: cartao e PIX nao tem troco.">
            <Input value={brl(total)} readOnly disabled />
          </Campo>
        )}

        <Campo label="CPF na nota" dica="Opcional. Cupom sem CPF e o caso normal." span>
          <Input
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            placeholder="000.000.000-00"
            inputMode="numeric"
          />
        </Campo>

        {ambientePermitido === "ambos" && (
          <Campo label="Ambiente" span>
            <Selecao
              value={ambiente}
              onChange={(v) => setAmbiente(v as Ambiente)}
              opcoes={[
                { valor: "1", texto: "Producao — cupom com valor fiscal" },
                { valor: "2", texto: "Homologacao — teste" },
              ]}
            />
          </Campo>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Total da venda</p>
            <p className="text-3xl font-semibold tabular-nums">{brl(total)}</p>
            {troco > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">
                Troco <strong className="text-foreground">{brl(troco)}</strong>
              </p>
            )}
          </div>
          <Button type="submit" size="lg" disabled={enviando || !preenchidos.length}>
            {enviando && <Loader2 className="size-4 animate-spin" />}
            {ambiente === "1" ? "Emitir cupom" : "Emitir teste"}
          </Button>
        </div>

        {erro && (
          <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {erro}
          </p>
        )}
      </section>
    </form>
  );
}

/** As formas que aparecem num caixa. O resto existe na API e não no balcão. */
const FORMAS_BALCAO: Array<{ valor: string; texto: string }> = [
  { valor: "01", texto: "Dinheiro" },
  { valor: "04", texto: "Cartao de debito" },
  { valor: "03", texto: "Cartao de credito" },
  { valor: "17", texto: "PIX" },
];

/**
 * Cupom autorizado.
 *
 * O que a pessoa faz em seguida é **imprimir e chamar o próximo cliente** — não
 * conferir chave de acesso. Por isso "Nova venda" vem primeiro e em destaque, e
 * a chave fica disponível sem ocupar a tela.
 *
 * O QR Code sai impresso no cupom (o PDF já o traz). Aqui vai o link, para quem
 * quiser conferir na hora: mostrar o QR na tela exigiria embutir um gerador de
 * imagem, e o consumidor lê do papel, não do monitor do caixa.
 */
function CupomEmitido({
  doc, ambiente, onNova, onLista,
}: {
  doc: DocumentoFiscal;
  ambiente: Ambiente;
  onNova: () => void;
  onLista: () => void;
}) {
  const chave = String(doc.chave ?? "");
  const qrCode = typeof doc["qrCode"] === "string" ? (doc["qrCode"] as string) : null;

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-6">
        <div>
          <h2 className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">
            {ambiente === "1" ? "Cupom autorizado" : "Cupom autorizado em homologacao"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {ambiente === "1"
              ? "Imprima e entregue ao cliente. O QR Code sai no cupom."
              : "Teste: a SEFAZ validou, mas o cupom nao existe fiscalmente."}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={onNova} size="lg">Nova venda</Button>
          {chave && <BaixarDocumento tipo="nfce" chave={chave} />}
          <Button variant="outline" onClick={onLista}>Ver cupons</Button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-6 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Chave de acesso</p>
          <p className="mt-1 font-mono text-xs break-all">{chave || "—"}</p>
        </div>
        {qrCode && (
          <div>
            <p className="text-xs text-muted-foreground">Consulta do consumidor</p>
            <a
              href={qrCode}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block break-all text-xs text-primary underline"
            >
              {qrCode}
            </a>
          </div>
        )}
      </section>
    </div>
  );
}
