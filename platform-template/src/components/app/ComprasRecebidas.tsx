import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, Loader2, RefreshCw, Search, Truck } from "lucide-react";
import {
  EVENTOS_DE_MANIFESTACAO,
  baixarXmlCompra,
  buscarCompras,
  listarCompras,
  manifestarCompra,
  type CodigoDeManifestacao,
  type NotaComprada,
} from "@/lib/fiscal.functions";
import { salvarArquivo } from "@/lib/download";
import { LoadingState, EmptyState, ErrorState } from "@/components/app/states";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency, formatDate } from "@/lib/format";

/** Nome curto do evento já registrado, para caber na coluna. */
const NOME_CURTO: Record<string, string> = {
  "210210": "Ciente",
  "210200": "Confirmada",
  "210220": "Desconhecida",
  "210240": "Nao realizada",
};

/** A NF-e na SEFAZ: 1 autorizada, 2 denegada, 3 cancelada. */
const SITUACAO: Record<string, { texto: string; classe: string }> = {
  "1": { texto: "Autorizada", classe: "text-emerald-600 dark:text-emerald-400" },
  "2": { texto: "Denegada", classe: "text-red-600 dark:text-red-400" },
  "3": { texto: "Cancelada", classe: "text-red-600 dark:text-red-400" },
};

/**
 * As NF-e que a empresa RECEBEU — compras, direto da SEFAZ.
 *
 * Duas coisas separam esta tela do radar de NFS-e, e as duas vêm da SEFAZ:
 *
 * A distribuição entrega quase tudo como RESUMO. O XML completo — que é o
 * documento que a contabilidade precisa — só é liberado depois da manifestação.
 * Por isso o botão de manifestar está aqui, e a coluna diz quando a nota ainda
 * é só resumo.
 *
 * E insistir na consulta custa uma hora de bloqueio do CNPJ (cStat 656). O
 * ponteiro fica no servidor para que isso não aconteça por acidente.
 */
export function ComprasRecebidas() {
  const listar = useServerFn(listarCompras);
  const buscar = useServerFn(buscarCompras);
  const baixar = useServerFn(baixarXmlCompra);
  const manifestar = useServerFn(manifestarCompra);
  const qc = useQueryClient();

  const [busca, setBusca] = useState("");
  const [lotes, setLotes] = useState(5);
  const [buscando, setBuscando] = useState(false);
  const [baixando, setBaixando] = useState<string | null>(null);

  // O que a caixa de manifestação está mostrando. `null` = fechada.
  const [alvo, setAlvo] = useState<NotaComprada | null>(null);
  const [evento, setEvento] = useState<CodigoDeManifestacao>("210210");
  const [justificativa, setJustificativa] = useState("");
  const [manifestando, setManifestando] = useState(false);

  const query = useQuery({
    queryKey: ["nfe-compras"],
    queryFn: () => listar({}),
  });

  async function procurar(desdeInicio: boolean) {
    if (
      desdeInicio
      && !confirm("Recarregar desde o inicio le toda a fila da SEFAZ. Pode demorar. Continuar?")
    ) return;
    setBuscando(true);
    try {
      const r = await buscar({ data: { lotes, ...(desdeInicio ? { desdeInicio: true } : {}) } });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(
        r.data.novas > 0
          ? `${r.data.novas} nota(s) nova(s) de ${r.data.lidas} lida(s).`
          : `Nenhuma nota nova${r.data.emDia ? " — voce esta em dia com a SEFAZ." : "."}`,
      );
      qc.invalidateQueries({ queryKey: ["nfe-compras"] });
    } catch {
      toast.error("Nao foi possivel falar com a SEFAZ.");
    } finally {
      setBuscando(false);
    }
  }

  async function pegarXml(nota: NotaComprada) {
    setBaixando(nota.chaveAcesso);
    try {
      const r = await baixar({ data: { chave: nota.chaveAcesso } });
      if (!r.ok) { toast.error(r.error); return; }
      salvarArquivo(r.data.nome, r.data.tipo, r.data.base64);
      toast.success(`${r.data.nome} baixado.`);
    } catch {
      toast.error("Nao foi possivel baixar o XML.");
    } finally {
      setBaixando(null);
    }
  }

  function abrirManifestacao(nota: NotaComprada) {
    setAlvo(nota);
    setEvento("210210");
    setJustificativa("");
  }

  async function enviarManifestacao() {
    if (!alvo) return;
    setManifestando(true);
    try {
      const r = await manifestar({
        data: {
          chave: alvo.chaveAcesso,
          evento,
          ...(evento === "210240" ? { justificativa } : {}),
        },
      });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(`${r.data.descEvento ?? "Manifestacao"} registrada na SEFAZ.`);
      setAlvo(null);
      // Depois da manifestação a SEFAZ passa a entregar o XML completo — mas só
      // na próxima varredura. Dizer isso evita a pergunta "e o XML, cadê?".
      if (evento === "210210" || evento === "210200") {
        toast.info("Use Buscar novas para trazer o XML completo desta nota.");
      }
      qc.invalidateQueries({ queryKey: ["nfe-compras"] });
    } catch {
      toast.error("Nao foi possivel manifestar.");
    } finally {
      setManifestando(false);
    }
  }

  if (query.isLoading) return <LoadingState label="Carregando compras..." />;
  if (query.isError) return <ErrorState message="Falha ao carregar." onRetry={() => query.refetch()} />;
  if (query.data && !query.data.ok)
    return <ErrorState message={query.data.error} onRetry={() => query.refetch()} />;

  const todas = query.data?.ok ? query.data.data.notas : [];
  const ultimoNsu = query.data?.ok ? query.data.data.ultimoNsu : 0;
  const maxNsu = query.data?.ok ? query.data.data.maxNsu : 0;

  const notas = todas.filter((n) => {
    if (!busca.trim()) return true;
    return JSON.stringify(n).toLowerCase().includes(busca.toLowerCase());
  });

  const escolhido = EVENTOS_DE_MANIFESTACAO.find((e) => e.codigo === evento);
  const faltaJustificativa = evento === "210240" && justificativa.trim().length < 15;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Truck className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            As NF-e que <strong>fornecedores emitiram contra a empresa</strong>, direto
            da SEFAZ. A maioria chega como <strong>resumo</strong> — o XML completo e
            liberado depois que voce manifesta a nota.
          </span>
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="lotes-compras"
              className="mb-1 block text-xs font-medium uppercase text-muted-foreground"
            >
              Lotes por vez
            </label>
            <Input
              id="lotes-compras"
              type="number"
              min={1}
              max={20}
              className="w-28"
              value={lotes}
              onChange={(e) => setLotes(Number(e.target.value))}
            />
          </div>

          <Button type="button" disabled={buscando} onClick={() => procurar(false)}>
            {buscando ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Buscar novas
          </Button>

          <Button type="button" variant="outline" disabled={buscando} onClick={() => procurar(true)}>
            Recarregar desde o inicio
          </Button>

          <span className="ml-auto text-sm text-muted-foreground">
            NSU {ultimoNsu}
            {maxNsu > 0 ? ` de ${maxNsu}` : ""}
            {maxNsu > 0 && ultimoNsu >= maxNsu ? " · em dia" : ""}
          </span>
        </div>

        {/* A SEFAZ bloqueia o CNPJ por uma hora quando a consulta se repete sem
            avancar. Avisar antes e mais barato que explicar o bloqueio depois. */}
        <p className="mt-3 text-xs text-muted-foreground">
          A SEFAZ limita consultas seguidas. Se nao houver nota nova, espere um pouco
          antes de buscar de novo — insistir bloqueia a consulta por uma hora.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar por fornecedor, chave ou valor"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {notas.length === 0 ? (
        <EmptyState
          title="Nenhuma compra capturada"
          description={
            todas.length === 0
              ? "Aperte Buscar novas para trazer as notas emitidas contra a empresa."
              : "Nenhuma nota corresponde a busca."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Emissao</th>
                <th className="px-4 py-3 font-medium">Fornecedor</th>
                <th className="px-4 py-3 text-right font-medium">Valor</th>
                <th className="px-4 py-3 font-medium">Situacao</th>
                <th className="px-4 py-3 font-medium">Manifestacao</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {notas.map((n) => {
                const sit = n.situacao ? SITUACAO[n.situacao] : undefined;
                return (
                  <tr key={n.chaveAcesso} className="hover:bg-muted/50">
                    <td className="px-4 py-3 text-muted-foreground">
                      {n.emitidaEm ? formatDate(n.emitidaEm) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{n.emitenteNome || n.emitenteCnpj || "—"}</div>
                      <div className="font-mono text-xs text-muted-foreground">{n.chaveAcesso}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {n.valorNota === undefined ? "—" : formatCurrency(n.valorNota)}
                    </td>
                    <td className={`px-4 py-3 ${sit?.classe ?? "text-muted-foreground"}`}>
                      {sit?.texto ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {n.manifestacao ? (
                        <span className="text-muted-foreground">
                          {NOME_CURTO[n.manifestacao] ?? n.manifestacao}
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400">Pendente</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => abrirManifestacao(n)}
                        >
                          Manifestar
                        </Button>
                        {/* Sem XML o botao nao aparece: oferecer um download que
                            responde erro e pior que nao oferecer. */}
                        {n.temXml && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={baixando !== null}
                            onClick={() => pegarXml(n)}
                            title="O XML e o documento fiscal — e ele que vai para a contabilidade"
                          >
                            {baixando === n.chaveAcesso
                              ? <Loader2 className="size-4 animate-spin" />
                              : <Download className="size-4" />}
                            XML
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={alvo !== null} onOpenChange={(aberto) => { if (!aberto) setAlvo(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manifestar nota</DialogTitle>
            <DialogDescription>
              {alvo?.emitenteNome || alvo?.emitenteCnpj} ·{" "}
              {alvo?.valorNota === undefined ? "" : formatCurrency(alvo.valorNota)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {EVENTOS_DE_MANIFESTACAO.map((e) => (
              <label
                key={e.codigo}
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition ${
                  evento === e.codigo ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                }`}
              >
                <input
                  type="radio"
                  name="evento"
                  className="mt-1"
                  checked={evento === e.codigo}
                  onChange={() => setEvento(e.codigo)}
                />
                <span>
                  <span className="block text-sm font-medium">{e.nome}</span>
                  {/* O efeito fica sempre visivel, nao atras de um tooltip: sao
                      declaracoes ao Fisco, e tres das quatro nao tem desfazer. */}
                  <span className="block text-xs text-muted-foreground">{e.efeito}</span>
                </span>
              </label>
            ))}
          </div>

          {evento === "210240" && (
            <div>
              <label htmlFor="just" className="mb-1 block text-sm font-medium">
                Justificativa
              </label>
              <Textarea
                id="just"
                rows={3}
                placeholder="Por que a operacao nao se realizou (minimo 15 caracteres)"
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {justificativa.trim().length}/15 caracteres.
              </p>
            </div>
          )}

          {escolhido?.grave && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Isto e uma declaracao da empresa ao Fisco e <strong>nao tem desfazer</strong>.
                Confira a nota antes de enviar.
              </span>
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAlvo(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={manifestando || faltaJustificativa}
              onClick={enviarManifestacao}
            >
              {manifestando && <Loader2 className="size-4 animate-spin" />}
              Enviar {escolhido?.nome}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
