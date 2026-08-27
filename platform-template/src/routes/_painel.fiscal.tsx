import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  listarProdutos, salvarProduto, removerProduto,
  listarRegras, salvarRegra, removerRegra,
  listarServicosNfse, salvarServicoNfse, removerServicoNfse,
  classificarNcm,
  TRIBUTACOES_ISSQN, RETENCOES_ISS, RETENCOES_FEDERAIS,
  type ProdutoCatalogo, type RegraFiscal,
} from "@/lib/fiscal.functions";
import { manifest, moduloAtivo } from "@/lib/manifest";
import { PainelLayout } from "@/components/app/PainelLayout";
import { EmptyState, ErrorState, LoadingState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Frase do CFOP corrigido na gravação.
 *
 * Um toast de sucesso mudo faria a pessoa digitar 1102 de novo no próximo
 * cadastro — o campo aceitou, a tela disse "salvo", e nada indicou que o valor
 * guardado é outro.
 */
function avisoCfop(a?: { de: string; para: string }): string {
  if (!a) return "";
  return ` O CFOP ${a.de} e de entrada (compra); o campo e de saida, entao ficou salvo ${a.para}.`;
}

export const Route = createFileRoute("/_painel/fiscal")({ component: Fiscal });

type AbaFiscal = "produtos" | "regras" | "servicos";

function Fiscal() {
  // As abas seguem o que a empresa contratou. Mostrar "Produtos" para quem so
  // presta servico e um cadastro que nunca vai ser usado ocupando a primeira
  // aba — e o contrario esconde de quem precisa.
  const temProduto = moduloAtivo("nfe") || moduloAtivo("nfce");
  const temServico = moduloAtivo("nfse");
  const abas: [AbaFiscal, string][] = [
    ...(temProduto ? ([["produtos", "Produtos"], ["regras", "Regras fiscais"]] as [AbaFiscal, string][]) : []),
    ...(temServico ? ([["servicos", "Servicos"]] as [AbaFiscal, string][]) : []),
  ];
  const [aba, setAba] = useState<AbaFiscal>(temProduto ? "produtos" : "servicos");

  return (
    <PainelLayout
      title="Cadastro fiscal"
      description={temProduto && temServico
        ? "Onde voce ensina o sistema: produtos, regras por NCM e servicos com a classificacao certa."
        : temProduto
          ? "Onde voce ensina o sistema: produtos com a classificacao certa e regras por NCM."
          : "Onde voce ensina o sistema: os servicos que a empresa presta, com a tributacao de cada um."}
    >
      <div className="mb-6 flex gap-1 border-b border-border">
        {abas.map(([id, texto]) => (
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
      {aba === "produtos" ? <AbaProdutos /> : aba === "regras" ? <AbaRegras /> : <AbaServicos />}
    </PainelLayout>
  );
}

// ───────────────────────────── Produtos ─────────────────────────────

function AbaProdutos() {
  const listar = useServerFn(listarProdutos);
  const salvar = useServerFn(salvarProduto);
  const remover = useServerFn(removerProduto);
  const classificar = useServerFn(classificarNcm);
  const qc = useQueryClient();

  const [busca, setBusca] = useState("");
  const [form, setForm] = useState<Record<string, string>>({ unidade: "UN" });
  const [salvando, setSalvando] = useState(false);
  const [classificando, setClassificando] = useState(false);

  const query = useQuery({
    queryKey: ["produtos", busca],
    queryFn: () => listar({ data: { termo: busca || undefined } }),
  });

  /** NCM completo já traz CFOP, CST e alíquotas — o usuário confere, não digita. */
  async function aoSairDoNcm(ncm: string) {
    const limpo = ncm.replace(/\D/g, "");
    if (limpo.length !== 8) return;
    setClassificando(true);
    const r = await classificar({ data: { ncm: limpo } }).catch(() => null);
    setClassificando(false);
    if (!r || !r.ok) return;
    const c = r.data;
    setForm((f) => ({
      ...f,
      cfop: f["cfop"] || c.cfop || "",
      cstCsosn: f["cstCsosn"] || c.cstCsosn || "",
      aliqIcms: f["aliqIcms"] || c.aliqIcms || "",
      cstIpi: f["cstIpi"] || c.cstIpi || "",
      aliqIpi: f["aliqIpi"] || c.aliqIpi || "",
      cest: f["cest"] || c.cest || "",
      // A classificacao devolve estes e a tela descartava: consultar o
      // tratamento certo e nao usar e o mesmo que nao consultar.
      redBcIcms: f["redBcIcms"] || c.redBcIcms || "",
      mva: f["mva"] || c.mva || "",
      aliqIcmsSt: f["aliqIcmsSt"] || c.aliqIcmsSt || "",
      cbenef: f["cbenef"] || c.cbenef || "",
      _fonte: c.fonte || "",
      _descricaoNcm: c.descricao || "",
    }));
  }

  /**
   * As mesmas regras que o motor aplica na emissão.
   *
   * Conferir aqui é barato; deixar passar sai caro, porque o produto fica salvo
   * errado e a nota só quebra semanas depois, longe desta tela.
   */
  function problemaNoIbsCbs(f: Record<string, string>): string | null {
    const cst = (f["ibscbsCst"] ?? "").trim();
    const classe = (f["ibscbsCclasstrib"] ?? "").trim();
    const red = (f["ibscbsPRedAliq"] ?? "").trim();

    if (!cst && !classe && !red) return null;
    if (cst && !classe) return "Informe tambem a classificacao tributaria: ela anda junto com o CST.";
    if (classe.slice(0, 3) !== cst) {
      return `A classificacao comeca pelos 3 digitos do CST. Com CST ${cst}, ela precisa comecar por ${cst}.`;
    }
    if (classe.length !== 6) return "A classificacao tributaria tem 6 digitos.";
    if (red && cst !== "200") return "Reducao so vale com CST 200. Deixe em branco ou corrija o CST.";
    // 200014 (frutas, horticolas e ovos) o motor ja conhece; nos demais o
    // percentual sai da tabela oficial e ninguem pode chutar por ele.
    if (cst === "200" && !red && classe !== "200014") {
      return "CST 200 e aliquota reduzida: informe a reducao em %. Use 100 para aliquota zero.";
    }
    if (red && (Number(red) < 0 || Number(red) > 100)) return "A reducao vai de 0 a 100.";
    return null;
  }

  async function onSalvar(e: React.FormEvent) {
    e.preventDefault();
    const problema = problemaNoIbsCbs(form);
    if (problema) { toast.error(problema); return; }
    setSalvando(true);
    const r = await salvar({ data: { produto: form } });
    setSalvando(false);
    if (r.ok) {
      toast.success("Produto salvo." + avisoCfop(r.data.cfopAjustado));
      setForm({ unidade: "UN" });
      qc.invalidateQueries({ queryKey: ["produtos"] });
    } else {
      toast.error(r.error);
    }
  }

  const lista = query.data?.ok ? query.data.data : [];

  return (
    <div className="space-y-6">
      <form onSubmit={onSalvar} className="space-y-4 rounded-xl border border-border bg-card p-6">
        <h3 className="text-sm font-semibold text-muted-foreground">Novo produto</h3>
        <div className="grid gap-4 sm:grid-cols-4">
          <Campo label="Codigo"><Input value={form["codigo"] ?? ""} onChange={(e) => setForm({ ...form, codigo: e.target.value })} /></Campo>
          <Campo label="Descricao" span={2}>
            <Input required value={form["descricao"] ?? ""} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
          </Campo>
          <Campo label="Unidade"><Input value={form["unidade"] ?? "UN"} onChange={(e) => setForm({ ...form, unidade: e.target.value })} /></Campo>
          <Campo label="NCM" dica={classificando ? "Classificando..." : form["_descricaoNcm"] || "Sai da classificacao ao completar 8 digitos."}>
            <Input
              required
              value={form["ncm"] ?? ""}
              onChange={(e) => setForm({ ...form, ncm: e.target.value })}
              onBlur={(e) => aoSairDoNcm(e.target.value)}
            />
          </Campo>
          <Campo label="CFOP"><Input value={form["cfop"] ?? ""} onChange={(e) => setForm({ ...form, cfop: e.target.value })} /></Campo>
          <Campo label="CST / CSOSN"><Input value={form["cstCsosn"] ?? ""} onChange={(e) => setForm({ ...form, cstCsosn: e.target.value })} /></Campo>
          <Campo label="Valor unitario"><Input value={form["valorUnitario"] ?? ""} onChange={(e) => setForm({ ...form, valorUnitario: e.target.value })} /></Campo>
          <Campo label="% ICMS"><Input value={form["aliqIcms"] ?? ""} onChange={(e) => setForm({ ...form, aliqIcms: e.target.value })} /></Campo>
          <Campo label="CST IPI"><Input value={form["cstIpi"] ?? ""} onChange={(e) => setForm({ ...form, cstIpi: e.target.value })} /></Campo>
          <Campo label="% IPI"><Input value={form["aliqIpi"] ?? ""} onChange={(e) => setForm({ ...form, aliqIpi: e.target.value })} /></Campo>
          <Campo label="CEST"><Input value={form["cest"] ?? ""} onChange={(e) => setForm({ ...form, cest: e.target.value })} /></Campo>
        </div>

        {/* Sete campos que a API aceita e a tela não oferecia. Não são detalhe:
            `origem` é obrigatória no XML (e o default 0 declara nacional para
            mercadoria importada), `redBcIcms`/`aliqIcmsSt`/`cbenef` mudam o
            imposto, e `cstPis`/`cstCofins` mudam o regime do item. Quem
            precisava deles tinha de cadastrar o produto pela API. */}
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Detalhes fiscais
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Em branco funciona para a maioria. Preencha o que a contabilidade indicar.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <Campo label="Origem" dica="0 = nacional. Importado tem codigo proprio.">
              <select
                value={form["origem"] ?? "0"}
                onChange={(e) => setForm({ ...form, origem: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {[
                  ["0", "0 - Nacional"],
                  ["1", "1 - Importacao direta"],
                  ["2", "2 - Mercado interno, importado"],
                  ["3", "3 - Nacional, +40% importado"],
                  ["4", "4 - Nacional, processos produtivos"],
                  ["5", "5 - Nacional, ate 40% importado"],
                  ["6", "6 - Importacao direta, sem similar"],
                  ["7", "7 - Mercado interno, sem similar"],
                  ["8", "8 - Nacional, +70% importado"],
                ].map(([v2, t]) => <option key={v2} value={v2}>{t}</option>)}
              </select>
            </Campo>
            <Campo label="EAN / GTIN" dica="Codigo de barras. Vazio vira SEM GTIN.">
              <Input value={form["ean"] ?? ""} onChange={(e) => setForm({ ...form, ean: e.target.value })} />
            </Campo>
            <Campo label="% Reducao da base" dica="So com CST/CSOSN que admite reducao.">
              <Input value={form["redBcIcms"] ?? ""} onChange={(e) => setForm({ ...form, redBcIcms: e.target.value })} />
            </Campo>
            <Campo label="% ICMS ST" dica="Com MVA, forma a substituicao.">
              <Input value={form["aliqIcmsSt"] ?? ""} onChange={(e) => setForm({ ...form, aliqIcmsSt: e.target.value })} />
            </Campo>
            <Campo label="MVA (%)" dica="Margem de valor agregado da ST.">
              <Input value={form["mva"] ?? ""} onChange={(e) => setForm({ ...form, mva: e.target.value })} />
            </Campo>
            <Campo label="Codigo de beneficio (cBenef)" dica="Exigido por algumas UFs com beneficio fiscal.">
              <Input value={form["cbenef"] ?? ""} onChange={(e) => setForm({ ...form, cbenef: e.target.value })} />
            </Campo>
            <Campo label="CST PIS" dica="Vazio = 99.">
              <Input maxLength={2} value={form["cstPis"] ?? ""} onChange={(e) => setForm({ ...form, cstPis: e.target.value.replace(/\D/g, "") })} />
            </Campo>
            <Campo label="CST COFINS" dica="Vazio = 99.">
              <Input maxLength={2} value={form["cstCofins"] ?? ""} onChange={(e) => setForm({ ...form, cstCofins: e.target.value.replace(/\D/g, "") })} />
            </Campo>
          </div>
        </div>

        {/* IBS/CBS não tinha campo nenhum aqui, e por isso toda nota saía
            afirmando tributação integral — inclusive para produto de alíquota
            zero. É o cadastro que carrega essa decisão até a emissão. */}
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              IBS / CBS — Reforma Tributaria
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Deixe em branco para tributacao normal, que e o caso da maioria. Preencha so
              para produto com tratamento proprio. <strong>Aliquota zero nao tem CST
              proprio</strong>: escreve-se como CST 200 com reducao de 100% — e assim que
              entram fruta, hortalica e ovo. Banana, por exemplo: 200 / 200014 / 100.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <Campo label="CST IBS/CBS" dica="200 = aliquota reduzida, 400 = isencao, 410 = imunidade">
              <Input
                maxLength={3} placeholder="000 (padrao)"
                value={form["ibscbsCst"] ?? ""}
                onChange={(e) => setForm({ ...form, ibscbsCst: e.target.value.replace(/\D/g, "") })}
              />
            </Campo>
            <Campo label="Classificacao (cClassTrib)" dica="6 digitos, comecando pelos 3 do CST">
              <Input
                maxLength={6} placeholder="000001 (padrao)"
                value={form["ibscbsCclasstrib"] ?? ""}
                onChange={(e) => setForm({ ...form, ibscbsCclasstrib: e.target.value.replace(/\D/g, "") })}
              />
            </Campo>
            <Campo label="Reducao (%)" dica="So com CST 200. 100 = aliquota zero.">
              <Input
                placeholder="so com CST 200"
                value={form["ibscbsPRedAliq"] ?? ""}
                onChange={(e) => setForm({ ...form, ibscbsPRedAliq: e.target.value.replace(/[^0-9.,]/g, "").replace(",", ".") })}
              />
            </Campo>
          </div>
        </div>

        {form["_fonte"] && (
          <p className="text-xs text-muted-foreground">Classificacao sugerida pela base: {form["_fonte"]}</p>
        )}
        <Button type="submit" disabled={salvando}>
          {salvando ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Salvar produto
        </Button>
      </form>

      <div className="space-y-3 rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-sm font-semibold text-muted-foreground">Catalogo</h3>
          <Input
            className="max-w-xs"
            placeholder="Buscar por descricao, codigo ou NCM"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        {query.isLoading ? (
          <LoadingState />
        ) : query.data && !query.data.ok ? (
          <ErrorState message={query.data.error} onRetry={() => query.refetch()} />
        ) : !lista.length ? (
          <EmptyState title="Nenhum produto cadastrado." />
        ) : (
          <Tabela
            cabecalho={["Codigo", "Descricao", "NCM", "CFOP", "CST", "", ""]}
            linhas={lista.map((p: ProdutoCatalogo) => [
              p.codigo ?? "-", p.descricao ?? "-", p.ncm ?? "-", p.cfop ?? "-", p.cstCsosn ?? "-", "",
              <Button
                key={p.id}
                type="button" variant="ghost" size="sm"
                onClick={async () => {
                  if (!p.id) return;
                  const r = await remover({ data: { id: p.id } });
                  if (r.ok) { toast.success("Produto removido."); qc.invalidateQueries({ queryKey: ["produtos"] }); }
                  else toast.error(r.error);
                }}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>,
            ])}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── Regras fiscais ───────────────────────────

function AbaRegras() {
  const listar = useServerFn(listarRegras);
  const salvar = useServerFn(salvarRegra);
  const remover = useServerFn(removerRegra);
  const qc = useQueryClient();

  const [uf, setUf] = useState<string>(manifest.company.uf);
  const [form, setForm] = useState<Record<string, string>>({ uf: String(manifest.company.uf) });
  const [salvando, setSalvando] = useState(false);

  const query = useQuery({ queryKey: ["regras", uf], queryFn: () => listar({ data: { uf } }) });
  const lista = query.data?.ok ? query.data.data : [];

  async function onSalvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    const r = await salvar({ data: { regra: { ...form, uf: form["uf"] || uf } } });
    setSalvando(false);
    if (r.ok) {
      toast.success("Regra salva. A partir de agora a classificacao deste NCM usa ela."
        + avisoCfop(r.data.cfopAjustado));
      setForm({ uf });
      qc.invalidateQueries({ queryKey: ["regras"] });
    } else {
      toast.error(r.error);
    }
  }

  return (
    <div className="space-y-6">
      <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        A regra vale para todo produto com aquele NCM, e substitui a classificacao automatica.
        Use quando a base errar o tratamento de um produto seu — assim voce corrige uma vez, em
        vez de ajustar item a item em toda nota. Regras marcadas como <b>gerais</b> vem do sistema
        e nao podem ser alteradas aqui.
      </p>

      <form onSubmit={onSalvar} className="space-y-4 rounded-xl border border-border bg-card p-6">
        <h3 className="text-sm font-semibold text-muted-foreground">Nova regra</h3>
        <div className="grid gap-4 sm:grid-cols-4">
          <Campo label="NCM"><Input required value={form["ncm"] ?? ""} onChange={(e) => setForm({ ...form, ncm: e.target.value })} /></Campo>
          <Campo label="UF"><Input required value={form["uf"] ?? uf} onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })} /></Campo>
          <Campo label="Descricao" span={2}><Input value={form["descricao"] ?? ""} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></Campo>
          <Campo label="CFOP saida"><Input value={form["cfopSaida"] ?? ""} onChange={(e) => setForm({ ...form, cfopSaida: e.target.value })} /></Campo>
          <Campo label="CSOSN (Simples)"><Input value={form["csosnSimples"] ?? ""} onChange={(e) => setForm({ ...form, csosnSimples: e.target.value })} /></Campo>
          <Campo label="CST (Normal)"><Input value={form["cstIcmsNormal"] ?? ""} onChange={(e) => setForm({ ...form, cstIcmsNormal: e.target.value })} /></Campo>
          <Campo label="% ICMS"><Input value={form["aliqIcms"] ?? ""} onChange={(e) => setForm({ ...form, aliqIcms: e.target.value })} /></Campo>
          <Campo label="CEST"><Input value={form["cest"] ?? ""} onChange={(e) => setForm({ ...form, cest: e.target.value })} /></Campo>
          <Campo label="MVA"><Input value={form["mva"] ?? ""} onChange={(e) => setForm({ ...form, mva: e.target.value })} /></Campo>
          <Campo label="Base legal" span={2}><Input value={form["baseLegal"] ?? ""} onChange={(e) => setForm({ ...form, baseLegal: e.target.value })} /></Campo>
        </div>
        <Button type="submit" disabled={salvando}>
          {salvando ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Salvar regra
        </Button>
      </form>

      <div className="space-y-3 rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-sm font-semibold text-muted-foreground">Regras de {uf}</h3>
          <Input className="max-w-[6rem]" value={uf} onChange={(e) => setUf(e.target.value.toUpperCase())} />
        </div>
        {query.isLoading ? (
          <LoadingState />
        ) : query.data && !query.data.ok ? (
          <ErrorState message={query.data.error} onRetry={() => query.refetch()} />
        ) : !lista.length ? (
          <EmptyState title="Nenhuma regra para esta UF." />
        ) : (
          <Tabela
            cabecalho={["NCM", "Descricao", "CFOP", "CST/CSOSN", "% ICMS", "Origem", ""]}
            linhas={lista.map((r: RegraFiscal) => {
              const propria = Boolean(r.empresaCnpj);
              return [
                r.ncm ?? "-", r.descricao || "-", r.cfopSaida ?? "-",
                r.csosnSimples || r.cstIcmsNormal || "-", r.aliqIcms ?? "-",
                <span key={"o" + r.id} className={propria ? "text-primary" : "text-muted-foreground"}>
                  {propria ? "sua" : "geral"}
                </span>,
                propria ? (
                  <Button
                    key={"b" + r.id}
                    type="button" variant="ghost" size="sm"
                    onClick={async () => {
                      if (!r.id) return;
                      const res = await remover({ data: { id: r.id } });
                      if (res.ok) { toast.success("Regra removida."); qc.invalidateQueries({ queryKey: ["regras"] }); }
                      else toast.error(res.error);
                    }}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                ) : "",
              ];
            })}
          />
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── auxiliares ─────────────────────────────

// ───────────────────────────── Serviços ─────────────────────────────

/**
 * O catálogo de serviços, que a plataforma só sabia ler.
 *
 * Sem esta aba, quem presta serviço tinha de digitar tudo solto a cada emissão
 * — e os dois campos que ninguém decora, o código de tributação nacional e o
 * NBS, simplesmente não iam. Cadastrar uma vez é o que faz a emissão virar
 * "escolher da lista" em vez de "lembrar seis dígitos".
 */
function AbaServicos() {
  const listar = useServerFn(listarServicosNfse);
  const salvar = useServerFn(salvarServicoNfse);
  const remover = useServerFn(removerServicoNfse);
  const qc = useQueryClient();

  const [form, setForm] = useState<Record<string, string>>({ tributacaoIssqn: "1", issRetido: "1" });
  const [salvando, setSalvando] = useState(false);

  const query = useQuery({ queryKey: ["servicos-nfse"], queryFn: () => listar({}) });

  async function onSalvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    const r = await salvar({ data: { servico: form } });
    setSalvando(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success("Servico salvo.");
    setForm({ tributacaoIssqn: "1", issRetido: "1" });
    qc.invalidateQueries({ queryKey: ["servicos-nfse"] });
  }

  async function onRemover(id: number, descricao: string) {
    if (!confirm(`Remover "${descricao}" do catalogo?`)) return;
    const r = await remover({ data: { id } });
    if (!r.ok) { toast.error(r.error); return; }
    toast.success("Servico removido.");
    qc.invalidateQueries({ queryKey: ["servicos-nfse"] });
  }

  const lista = query.data?.ok ? query.data.data : [];

  return (
    <div className="space-y-6">
      <form onSubmit={onSalvar} className="space-y-4 rounded-xl border border-border bg-card p-6">
        <h3 className="text-sm font-semibold text-muted-foreground">Novo servico</h3>

        <div className="grid gap-4 sm:grid-cols-4">
          <Campo label="Codigo" dica="Seu identificador interno.">
            <Input
              required
              value={form["codigo"] ?? ""}
              onChange={(e) => setForm({ ...form, codigo: e.target.value })}
            />
          </Campo>
          <Campo label="Descricao do servico" span={2}>
            <Input
              required
              value={form["descricao"] ?? ""}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            />
          </Campo>
          <Campo label="Valor padrao (R$)" dica="Sugerido na emissao. Da para mudar na hora.">
            <Input
              value={form["valorPadrao"] ?? ""}
              onChange={(e) => setForm({ ...form, valorPadrao: e.target.value })}
            />
          </Campo>
        </div>

        {/* Os dois codigos que decidem a tributacao. O nacional e obrigatorio e
            tem formato fixo; errar aqui e rejeicao na prefeitura, nao aviso. */}
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Classificacao do servico
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              O codigo de tributacao nacional sai da lista da LC 116/2003 e tem{" "}
              <strong>6 digitos</strong>: item (2) + subitem (2) + desdobro (2). O desdobro
              comeca em <strong>01</strong> — contabilidade, por exemplo, e 173001.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo label="Cod. tributacao nacional" dica="6 digitos. Obrigatorio.">
              <Input
                required
                maxLength={6}
                placeholder="173001"
                value={form["codigoTributacaoNacional"] ?? ""}
                onChange={(e) =>
                  setForm({ ...form, codigoTributacaoNacional: e.target.value.replace(/\D/g, "") })}
              />
            </Campo>
            <Campo label="Cod. municipal" dica="So se a prefeitura usar codigo proprio.">
              <Input
                value={form["codigoTributacaoMunicipal"] ?? ""}
                onChange={(e) => setForm({ ...form, codigoTributacaoMunicipal: e.target.value })}
              />
            </Campo>
            <Campo label="NBS" dica="Nomenclatura Brasileira de Servicos — o NCM do servico.">
              <Input
                placeholder="1.1401.10.00"
                value={form["codigoNBS"] ?? ""}
                onChange={(e) => setForm({ ...form, codigoNBS: e.target.value })}
              />
            </Campo>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Campo label="% ISS" dica="Normalmente entre 2 e 5, conforme o municipio.">
            <Input
              value={form["aliquotaIss"] ?? ""}
              onChange={(e) => setForm({ ...form, aliquotaIss: e.target.value })}
            />
          </Campo>
          <Campo label="Tributacao do ISSQN">
            <select
              value={form["tributacaoIssqn"] ?? "1"}
              onChange={(e) => setForm({ ...form, tributacaoIssqn: e.target.value })}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {TRIBUTACOES_ISSQN.map((t) => (
                <option key={t.codigo} value={t.codigo}>{t.codigo} - {t.nome}</option>
              ))}
            </select>
          </Campo>
          <Campo label="ISS retido" dica="Quem recolhe. O padrao e o proprio prestador.">
            <select
              value={form["issRetido"] ?? "1"}
              onChange={(e) => setForm({ ...form, issRetido: e.target.value })}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {RETENCOES_ISS.map((r) => (
                <option key={r.codigo} value={r.codigo}>{r.nome}</option>
              ))}
            </select>
          </Campo>
        </div>

        {/* O gerador do XML ja sabia emitir vRetIRRF, vRetCSLL, vRetCP e o grupo
            de PIS/COFINS, mas nao havia onde guardar a aliquota de cada um —
            entao ninguem preenchia e a nota saia sem retencao nenhuma. Com
            tomador pessoa juridica, reter e a regra, nao a excecao. */}
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Retencoes federais
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Percentuais que este servico costuma sofrer. Na emissao eles viram valor
              sobre o servico, e so entram quando o tomador e pessoa juridica — que e
              quem retem. <strong>Em branco significa "nao se aplica"</strong>; preencha
              o que a contabilidade indicar.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-5">
            {RETENCOES_FEDERAIS.map((r) => (
              <Campo key={r.campo} label={`% ${r.nome}`} dica={r.dica}>
                <Input
                  value={form[r.campo] ?? ""}
                  onChange={(e) => setForm({ ...form, [r.campo]: e.target.value })}
                />
              </Campo>
            ))}
          </div>
        </div>

        <Button type="submit" disabled={salvando}>
          {salvando ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Salvar servico
        </Button>
      </form>

      {query.isLoading ? (
        <LoadingState label="Carregando servicos..." />
      ) : query.data && !query.data.ok ? (
        <ErrorState message={query.data.error} onRetry={() => query.refetch()} />
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum servico cadastrado"
          description="Cadastre os servicos que a empresa presta. Na emissao eles viram uma lista, e a tributacao vai junto."
        />
      ) : (
        <Tabela
          cabecalho={["Codigo", "Descricao", "Trib. nacional", "NBS", "% ISS", "ISS", ""]}
          linhas={lista.map((s) => [
            s.codigo,
            s.descricao,
            s.codigoTributacaoNacional ?? "—",
            s.codigoNBS ?? "—",
            s.aliquotaIss ?? "—",
            s.issRetido === "2" ? "retido pelo tomador"
              : s.issRetido === "3" ? "retido pelo intermediario"
                : "do prestador",
            s.id === undefined ? null : (
              <Button
                key="rm"
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRemover(s.id as number, s.descricao)}
              >
                <Trash2 className="size-4" />
              </Button>
            ),
          ])}
        />
      )}
    </div>
  );
}

function Campo({ label, dica, span, children }: {
  label: string; dica?: string; span?: number; children: React.ReactNode;
}) {
  return (
    <div className={`space-y-2 ${span === 2 ? "sm:col-span-2" : ""}`}>
      <Label>{label}</Label>
      {children}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}

function Tabela({ cabecalho, linhas }: { cabecalho: string[]; linhas: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            {cabecalho.map((c, i) => <th key={i} className="px-2 py-2 font-medium">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0">
              {l.map((c, j) => <td key={j} className="px-2 py-2">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
