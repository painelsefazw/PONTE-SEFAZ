import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, RefreshCw, Search, Satellite } from "lucide-react";
import {
  baixarXmlRecebida,
  buscarNotasNoRadar,
  listarNotasRecebidas,
  type NotaRecebida,
} from "@/lib/fiscal.functions";
import { salvarArquivo } from "@/lib/download";
import { LoadingState, EmptyState, ErrorState } from "@/components/app/states";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format";

/**
 * As NFS-e que a empresa RECEBEU, baixadas do Ambiente Nacional.
 *
 * A outra metade do serviço: as telas de NFS-e mostram o que a empresa emitiu,
 * e é a nota que o FORNECEDOR emitiu contra ela que o contador precisa para
 * escriturar despesa. Essa nota hoje chega por e-mail, por WhatsApp, ou não
 * chega — e o que não chega vira despesa sem documento no fechamento do mês.
 *
 * O ponteiro de leitura fica no servidor, então "Buscar novas" traz só o que
 * chegou desde a última vez. Apertar duas vezes não duplica nada.
 */
export function RadarRecebidas() {
  const listar = useServerFn(listarNotasRecebidas);
  const buscar = useServerFn(buscarNotasNoRadar);
  const baixar = useServerFn(baixarXmlRecebida);
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [lotes, setLotes] = useState(5);
  const [buscando, setBuscando] = useState(false);
  const [baixando, setBaixando] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["nfse-recebidas"],
    queryFn: () => listar({}),
  });

  async function procurar(desdeInicio: boolean) {
    if (
      desdeInicio
      && !confirm("Recarregar desde o inicio le todo o historico do Ambiente Nacional. Pode demorar. Continuar?")
    ) return;
    setBuscando(true);
    try {
      const r = await buscar({ data: { lotes, ...(desdeInicio ? { desdeInicio: true } : {}) } });
      if (!r.ok) { toast.error(r.error); return; }
      // Dizer quantas foram LIDAS junto com quantas eram novas evita a leitura
      // errada de "nao veio nada" quando o certo e "nao havia nada de novo".
      toast.success(
        r.data.novas > 0
          ? `${r.data.novas} nota(s) nova(s) de ${r.data.lidas} lida(s).`
          : `Nenhuma nota nova (${r.data.lidas} lida(s)). Voce ja esta em dia.`,
      );
      qc.invalidateQueries({ queryKey: ["nfse-recebidas"] });
    } catch {
      toast.error("Nao foi possivel falar com o Ambiente Nacional.");
    } finally {
      setBuscando(false);
    }
  }

  async function pegarXml(nota: NotaRecebida) {
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

  if (query.isLoading) return <LoadingState label="Carregando notas recebidas..." />;
  if (query.isError) return <ErrorState message="Falha ao carregar." onRetry={() => query.refetch()} />;
  if (query.data && !query.data.ok)
    return <ErrorState message={query.data.error} onRetry={() => query.refetch()} />;

  const todas = query.data?.ok ? query.data.data.notas : [];
  const ultimoNsu = query.data?.ok ? query.data.data.ultimoNsu : 0;

  const notas = todas.filter((n) => {
    if (!busca.trim()) return true;
    return JSON.stringify(n).toLowerCase().includes(busca.toLowerCase());
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Satellite className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            Baixa as notas de servico da empresa direto do <strong>Ambiente Nacional</strong>{" "}
            — as que ela emitiu pelo sistema da prefeitura e as que{" "}
            <strong>recebeu de fornecedores</strong>. Cada nota vem com o XML
            autorizado, pronto para a escrituracao.
          </span>
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="lotes"
              className="mb-1 block text-xs font-medium uppercase text-muted-foreground"
            >
              Lotes por vez
            </label>
            <Input
              id="lotes"
              type="number"
              min={1}
              max={20}
              className="w-28"
              value={lotes}
              onChange={(e) => setLotes(Number(e.target.value))}
            />
            <p className="mt-1 text-xs text-muted-foreground">Ate 50 notas por lote.</p>
          </div>

          <Button type="button" disabled={buscando} onClick={() => procurar(false)}>
            {buscando ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Buscar novas
          </Button>

          {/* Separado do botao normal porque le o historico inteiro: e a acao
              de quem esta comecando, nao a do dia a dia. */}
          <Button type="button" variant="outline" disabled={buscando} onClick={() => procurar(true)}>
            Recarregar desde o inicio
          </Button>

          <span className="ml-auto text-sm text-muted-foreground">
            Ultimo NSU lido: <strong className="text-foreground">{ultimoNsu}</strong>
          </span>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar por prestador, servico ou numero"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {notas.length === 0 ? (
        <EmptyState
          title="Nenhuma nota capturada"
          description={
            todas.length === 0
              ? "Aperte Buscar novas para trazer as notas do Ambiente Nacional."
              : "Nenhuma nota corresponde a busca."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Numero</th>
                <th className="px-4 py-3 font-medium">Emissao</th>
                <th className="px-4 py-3 font-medium">Prestador</th>
                <th className="px-4 py-3 font-medium">Servico</th>
                <th className="px-4 py-3 text-right font-medium">Valor</th>
                <th className="px-4 py-3 font-medium">Municipio</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {notas.map((n) => (
                <tr key={n.chaveAcesso} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-medium">{n.numero || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {n.emitidaEm ? formatDate(n.emitidaEm) : "—"}
                  </td>
                  <td className="px-4 py-3">{n.emitenteNome || n.emitenteCnpj || "—"}</td>
                  <td
                    className="max-w-[280px] truncate px-4 py-3 text-muted-foreground"
                    title={n.descricaoServico}
                  >
                    {n.descricaoServico || "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {n.valorServico === undefined ? "—" : formatCurrency(n.valorServico)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{n.localEmissao || "—"}</td>
                  <td className="px-4 py-3 text-right">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
