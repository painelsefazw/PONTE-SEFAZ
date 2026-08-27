import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, Search, Trash2 } from "lucide-react";
import { apagarDocumento, limparTestes, listarDocumentos } from "@/lib/fiscal.functions";
import { LoadingState, EmptyState, ErrorState, StatusBadge } from "@/components/app/states";
import { BaixarDocumento } from "@/components/app/BaixarDocumento";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, docNumero, docId } from "@/lib/format";

export function DocumentosLista({ tipo }: { tipo: "nfe" | "nfce" | "nfse" }) {
  const listar = useServerFn(listarDocumentos);
  const apagar = useServerFn(apagarDocumento);
  const limpar = useServerFn(limparTestes);
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  // Produção por padrão: esta lista é o livro fiscal da empresa, e nota de
  // homologação não pertence a ele. Misturar as duas fazia uma nota real e uma
  // de teste com o MESMO número aparecerem lado a lado, indistinguíveis — a
  // numeração é separada por ambiente, então isso não é raro, é o normal.
  const [ambiente, setAmbiente] = useState<"1" | "2">("1");

  const query = useQuery({
    queryKey: ["docs", tipo],
    queryFn: () => listar({ data: { tipo } }),
  });

  if (query.isLoading) return <LoadingState label="Carregando documentos..." />;
  if (query.isError) return <ErrorState message="Falha ao carregar." onRetry={() => query.refetch()} />;
  if (query.data && !query.data.ok)
    return <ErrorState message={query.data.error} onRetry={() => query.refetch()} />;

  const todos = query.data?.ok ? query.data.data : [];
  const doAmbiente = (a: string) => todos.filter((d) => String(d.ambiente ?? "1") === a);
  const quantosTeste = doAmbiente("2").length;

  const docs = doAmbiente(ambiente).filter((d) => {
    if (!busca.trim()) return true;
    return JSON.stringify(d).toLowerCase().includes(busca.toLowerCase());
  });

  const homologacao = ambiente === "2";

  /**
   * Apaga uma nota de teste.
   *
   * Confirma porque e destrutivo e nao tem desfazer. A API recusa nota de
   * producao por conta propria — o historico e onde vive o XML autorizado, e
   * apagar dali nao desfaz a nota na SEFAZ.
   */
  async function apagarUma(chave: string, rotulo: string) {
    if (!confirm(`Apagar a nota de teste ${rotulo}? Isso nao pode ser desfeito.`)) return;
    setOcupado(chave);
    try {
      const r = await apagar({ data: { chave } });
      if (r.ok) {
        toast.success("Nota de teste apagada.");
        qc.invalidateQueries({ queryKey: ["docs", tipo] });
      } else {
        toast.error(r.error);
      }
    } finally {
      setOcupado(null);
    }
  }

  /** Apaga todos os testes DESTA empresa. A API nao deixa passar de producao. */
  async function limparTodos() {
    if (!confirm(`Apagar as ${quantosTeste} nota(s) de teste? Isso nao pode ser desfeito.`)) return;
    setOcupado("todos");
    try {
      const r = await limpar({});
      if (r.ok) {
        toast.success(`${r.data.removidas} nota(s) de teste apagada(s).`);
        qc.invalidateQueries({ queryKey: ["docs", tipo] });
      } else {
        toast.error(r.error);
      }
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por numero, destinatario ou chave"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        {/* Alternar é explícito e o rótulo diz o que cada lado é. Um filtro
            chamado "ambiente" com "1" e "2" não significa nada para quem fatura. */}
        <div className="flex rounded-lg border border-border p-0.5">
          <button
            type="button"
            onClick={() => setAmbiente("1")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              !homologacao ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Notas validas
          </button>
          <button
            type="button"
            onClick={() => setAmbiente("2")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              homologacao
                ? "bg-amber-400 text-amber-950"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Testes{quantosTeste > 0 ? ` (${quantosTeste})` : ""}
          </button>
        </div>
      </div>

      {homologacao && (
        <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong>Homologacao — sem valor fiscal.</strong> Estes documentos foram
              validados pela SEFAZ mas nao existem fiscalmente: nao vao para a
              contabilidade, nao geram imposto e nao precisam ser cancelados.
            </span>
          </p>
          {quantosTeste > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={ocupado !== null}
              onClick={limparTodos}
            >
              <Trash2 className="size-4" /> Apagar todos os testes
            </Button>
          )}
        </div>
      )}

      {docs.length === 0 ? (
        <EmptyState
          title="Nenhum documento encontrado"
          description="Nao ha documentos para os filtros atuais."
          action={
            <Button asChild size="sm">
              <Link to={tipo === "nfe" ? "/nfe/emitir" : "/nfse/emitir"}>
                Emitir {tipo === "nfe" ? "NF-e" : "NFS-e"}
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Documento</th>
                <th className="px-4 py-3 font-medium">
                  {tipo === "nfe" ? "Destinatario" : "Tomador"}
                </th>
                <th className="px-4 py-3 font-medium">Emissao</th>
                <th className="px-4 py-3 text-right font-medium">Valor</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Arquivos</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {docs.map((d, i) => (
                <tr key={docId(d) || i} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      {docNumero(d)}
                      {/* O selo fica na linha, nao so no filtro: se a nota for
                          impressa, copiada ou aberta por link, ela continua
                          dizendo o que e. */}
                      {String(d.ambiente ?? "1") === "2" && (
                        <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-950">
                          teste
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">{String(d.destinatario ?? d.tomador ?? "-")}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(d.emitidoEm)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(d.valor)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={d.status as string | undefined} />
                  </td>
                  <td className="px-4 py-3">
                    {/* XML e PDF na própria linha: quem precisa do arquivo
                        normalmente quer só isso, e obrigar a abrir o detalhe
                        para cada nota transforma um download em três cliques. */}
                    {d.chave && <BaixarDocumento tipo={tipo} chave={String(d.chave)} tamanho="sm" />}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {/* Reaproveitar existe para o caminho normal do teste:
                          conferiu em homologacao, agora emite valendo. Sem isto
                          o operador redigita tudo — e erra na digitacao o que
                          acabou de acertar. */}
                      {tipo === "nfe" && d.chave && (
                        <Button asChild variant="ghost" size="sm" title="Emitir outra nota com estes dados">
                          <Link to="/nfe/emitir" search={{ de: String(d.chave) }}>
                            <Copy className="size-4" />
                            <span className="hidden sm:inline">Reaproveitar</span>
                          </Link>
                        </Button>
                      )}

                      {/* Apagar so aparece em teste. Nota de producao nao tem
                          este botao porque a API a recusaria — e oferecer um
                          botao que sempre falha e pior que nao ter. */}
                      {homologacao && d.chave && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={ocupado !== null}
                          title="Apagar esta nota de teste"
                          onClick={() => apagarUma(String(d.chave), docNumero(d))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}

                      <Button asChild variant="ghost" size="sm">
                        <Link
                          to={tipo === "nfe" ? "/nfe/$id" : "/nfse/$id"}
                          params={{ id: docId(d) }}
                        >
                          Detalhes
                        </Link>
                      </Button>
                    </div>
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
