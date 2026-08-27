import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, FileText, Plus, ReceiptText, ShoppingCart, XCircle } from "lucide-react";
import { PainelLayout } from "@/components/app/PainelLayout";
import { LoadingState, ErrorState, StatusBadge, EmptyState } from "@/components/app/states";
import { listarDocumentos, type DocumentoFiscal } from "@/lib/fiscal.functions";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, docNumero } from "@/lib/format";
import { marca, moduloAtivo, tituloDaPagina } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/dashboard")({
  head: () => ({
    meta: [
      { title: tituloDaPagina("Dashboard") },
      {
        name: "description",
        content: `Visao geral das notas fiscais eletronicas emitidas pela ${marca}.`,
      },
      { property: "og:title", content: tituloDaPagina("Dashboard") },
      { property: "og:description", content: "Visao geral dos documentos fiscais emitidos." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const listar = useServerFn(listarDocumentos);
  const nfe = useQuery({
    queryKey: ["docs", "nfe"],
    queryFn: () => listar({ data: { tipo: "nfe" } }),
  });
  // Consulta so o que a empresa contratou: pedir a lista de um documento que
  // ela nao emite gasta uma ida a API para receber vazio, em toda abertura.
  const nfce = useQuery({
    queryKey: ["docs", "nfce"],
    queryFn: () => listar({ data: { tipo: "nfce" } }),
    enabled: moduloAtivo("nfce"),
  });
  const nfse = useQuery({
    queryKey: ["docs", "nfse"],
    queryFn: () => listar({ data: { tipo: "nfse" } }),
    enabled: moduloAtivo("nfse"),
  });

  const loading = nfe.isLoading || nfce.isLoading || nfse.isLoading;
  const errorMsg =
    (nfe.data && !nfe.data.ok ? nfe.data.error : null) ??
    (nfce.data && !nfce.data.ok ? nfce.data.error : null) ??
    (nfse.data && !nfse.data.ok ? nfse.data.error : null) ??
    (nfe.isError || nfce.isError || nfse.isError ? "Falha ao carregar os dados." : null);

  const docsNfe = nfe.data?.ok ? nfe.data.data : [];
  const docsNfce = nfce.data?.ok ? nfce.data.data : [];
  const docsNfse = nfse.data?.ok ? nfse.data.data : [];
  const todos = [...docsNfe, ...docsNfce, ...docsNfse];
  const autorizadas = todos.filter((d) =>
    String(d.status ?? "").toLowerCase().includes("autoriz"),
  ).length;
  const canceladas = todos.filter((d) =>
    String(d.status ?? "").toLowerCase().includes("cancel"),
  ).length;

  function refetch() {
    nfe.refetch();
    nfse.refetch();
  }

  return (
    <PainelLayout
      title="Dashboard"
      description="Visao geral dos documentos fiscais"
      actions={
        // O botao principal aponta para o que o cliente emite. Quem so presta
        // servico via "Emitir NF-e" no topo de tudo — um convite para a unica
        // tela que ele nao tem.
        moduloAtivo("nfe") ? (
          <Button asChild size="sm">
            <Link to="/nfe/emitir">
              <Plus className="size-4" /> Emitir NF-e
            </Link>
          </Button>
        ) : moduloAtivo("nfce") ? (
          <Button asChild size="sm">
            <Link to="/nfce/emitir">
              <Plus className="size-4" /> Vender
            </Link>
          </Button>
        ) : moduloAtivo("nfse") ? (
          <Button asChild size="sm">
            <Link to="/nfse/emitir">
              <Plus className="size-4" /> Emitir NFS-e
            </Link>
          </Button>
        ) : null
      }
    >
      {loading ? (
        <LoadingState label="Carregando indicadores..." />
      ) : errorMsg ? (
        <ErrorState message={errorMsg} onRetry={refetch} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {/* Cartao de documento que o cliente nao contratou marcaria zero
                para sempre — parece sistema quebrado, nao servico ausente. */}
            {moduloAtivo("nfe") && (
              <StatCard icon={FileText} label="NF-e emitidas" value={docsNfe.length} />
            )}
            {moduloAtivo("nfce") && (
              <StatCard icon={ShoppingCart} label="Cupons emitidos" value={docsNfce.length} />
            )}
            {moduloAtivo("nfse") && (
              <StatCard icon={ReceiptText} label="NFS-e emitidas" value={docsNfse.length} />
            )}
            <StatCard icon={CheckCircle2} label="Autorizadas" value={autorizadas} />
            <StatCard icon={XCircle} label="Canceladas" value={canceladas} />
          </div>

          <section className="rounded-xl border border-border bg-card">
            <header className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold">Documentos recentes</h2>
              <Button asChild variant="ghost" size="sm">
                <Link to={moduloAtivo("nfe") ? "/nfe" : moduloAtivo("nfce") ? "/nfce" : "/nfse"}>Ver todos</Link>
              </Button>
            </header>
            {todos.length === 0 ? (
              <EmptyState
                title="Nenhum documento emitido"
                description="Assim que a primeira nota for emitida, ela aparecera aqui."
                action={
                  <Button asChild size="sm">
                    <Link to="/nfe/emitir">Emitir NF-e</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {todos.slice(0, 8).map((d, i) => (
                  <li
                    key={String(d.id ?? d.chave ?? i)}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {docNumero(d)} &middot; {String(d.destinatario ?? d.tomador ?? "-")}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDate(d.emitidoEm)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm tabular-nums">{formatCurrency(d.valor)}</span>
                      <StatusBadge status={d.status as string | undefined} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </PainelLayout>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileText;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
