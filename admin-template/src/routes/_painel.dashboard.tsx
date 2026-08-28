import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, KeyRound, Plus, Users } from "lucide-react";
import { PainelLayout } from "@/components/app/PainelLayout";
import { LoadingState, ErrorState } from "@/components/app/states";
import { listarClientes, type Cliente } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { marca, tituloDaPagina } from "@/lib/manifest";
import { cn } from "@/lib/utils";
import { CAPS } from "@/lib/tipografia";

export const Route = createFileRoute("/_painel/dashboard")({
  head: () => ({
    meta: [
      { title: tituloDaPagina("Visão geral") },
      { name: "description", content: `Clientes que emitem pela ponte ${marca}.` },
    ],
  }),
  component: Dashboard,
});

/**
 * A visao geral mostra o que EXIGE acao, nao um resumo bonito.
 *
 * Contar clientes ativos e agradavel e inutil: quem abre este console de manha
 * quer saber quem esta travado — cadastrado e sem emitir, porque falta
 * certificado ou porque ninguem ativou um servico. Esse e o numero que vira
 * trabalho.
 */
function Dashboard() {
  const listar = useServerFn(listarClientes);
  const query = useQuery({
    queryKey: ["clientes", "", "todos"],
    queryFn: () => listar({ data: { status: "todos" } }),
  });

  if (query.isLoading) {
    return (
      <PainelLayout title="Visão geral">
        <LoadingState label="Carregando..." />
      </PainelLayout>
    );
  }
  if (query.isError || (query.data && !query.data.ok)) {
    const msg = query.data && !query.data.ok
      ? query.data.error
      : "Não foi possível carregar os clientes.";
    return (
      <PainelLayout title="Visão geral">
        <ErrorState message={msg} onRetry={() => query.refetch()} />
      </PainelLayout>
    );
  }

  const clientes: Cliente[] = query.data?.ok ? query.data.data : [];
  const ativos = clientes.filter((c) => c.status === "active");
  const semCertificado = clientes.filter((c) => !c.temCertificado && c.status !== "cancelled");
  const nuncaUsaram = clientes.filter((c) => c.status === "active" && !c.ultimoUsoApi);

  const cartao = (rotulo: string, valor: number, cor: string) => (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className={`text-2xl font-semibold ${cor}`}>{valor}</div>
      <div className={cn("text-xs text-muted-foreground", CAPS)}>{rotulo}</div>
    </div>
  );

  return (
    <PainelLayout
      title="Visão geral"
      description="O que precisa de ação hoje."
      actions={
        <Button asChild size="sm">
          <Link to="/clientes/novo"><Plus className="size-4" /> Novo cliente</Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          {cartao("Clientes", clientes.length, "")}
          {cartao("Ativos", ativos.length, "text-emerald-600 dark:text-emerald-400")}
          {cartao("Sem certificado", semCertificado.length, "text-amber-600 dark:text-amber-400")}
        </div>

        {semCertificado.length > 0 && (
          <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong>{semCertificado.length} cliente(s) sem certificado A1.</strong> Eles não
                emitem nada até o .pfx ser enviado — e costumam estar esperando sem avisar.
              </span>
            </p>
            <ul className="mt-3 space-y-1">
              {semCertificado.slice(0, 5).map((c) => (
                <li key={c.empresaCnpj}>
                  <Link
                    to="/clientes/$cnpj"
                    params={{ cnpj: c.empresaCnpj }}
                    className="text-sm underline underline-offset-2"
                  >
                    {c.razaoSocial || c.empresaCnpj}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {nuncaUsaram.length > 0 && (
          // Cliente ativo que nunca chamou a API esta travado em algum ponto da
          // implantacao, ou desistiu. Nos dois casos vale uma ligacao.
          <section className="rounded-xl border border-border bg-card p-4">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <KeyRound className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong className="text-foreground">{nuncaUsaram.length} ativo(s) nunca chamaram a API.</strong>{" "}
                Ou estão implantando, ou travaram em algum ponto. Vale ligar.
              </span>
            </p>
          </section>
        )}

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm">
            <Users className="size-4 text-muted-foreground" />
            <Link to="/clientes" className={cn("underline underline-offset-2", CAPS)}>
              Ver todos os clientes
            </Link>
          </div>
        </section>
      </div>
    </PainelLayout>
  );
}
