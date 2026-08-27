import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Search } from "lucide-react";
import { listarClientes, type Cliente, type StatusCliente } from "@/lib/admin.functions";
import { LoadingState, EmptyState, ErrorState } from "@/components/app/states";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCnpj } from "@/lib/manifest";

/** Cor e rotulo de cada status, no vocabulario de quem opera. */
export const STATUS: Record<StatusCliente, { texto: string; classe: string }> = {
  draft: { texto: "Rascunho", classe: "bg-muted text-muted-foreground" },
  sandbox: { texto: "Sandbox", classe: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  active: { texto: "Ativo", classe: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  past_due: { texto: "Inadimplente", classe: "bg-orange-500/15 text-orange-700 dark:text-orange-400" },
  suspended: { texto: "Suspenso", classe: "bg-red-500/15 text-red-700 dark:text-red-400" },
  cancelled: { texto: "Cancelado", classe: "bg-muted text-muted-foreground line-through" },
};

const FILTROS: { valor: string; texto: string }[] = [
  { valor: "todos", texto: "Todos" },
  { valor: "active", texto: "Ativos" },
  { valor: "sandbox", texto: "Sandbox" },
  { valor: "draft", texto: "Rascunho" },
  { valor: "suspended", texto: "Suspensos" },
];

/**
 * A lista de clientes da ponte.
 *
 * A busca e o filtro vao para o servidor em vez de filtrar no navegador: com
 * dez clientes daria na mesma, com trezentos a lista inteira atravessaria a rede
 * a cada tecla.
 */
export function ClientesLista() {
  const listar = useServerFn(listarClientes);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("todos");

  const query = useQuery({
    queryKey: ["clientes", busca, status],
    queryFn: () => listar({ data: { busca: busca || undefined, status } }),
  });

  if (query.isLoading) return <LoadingState label="Carregando clientes..." />;
  if (query.isError) return <ErrorState message="Falha ao carregar." onRetry={() => query.refetch()} />;
  if (query.data && !query.data.ok)
    return <ErrorState message={query.data.error} onRetry={() => query.refetch()} />;

  const clientes: Cliente[] = query.data?.ok ? query.data.data : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome ou CNPJ"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap rounded-lg border border-border p-0.5">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              onClick={() => setStatus(f.valor)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                status === f.valor
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.texto}
            </button>
          ))}
        </div>
      </div>

      {clientes.length === 0 ? (
        <EmptyState
          title="Nenhum cliente"
          description="Cadastre a primeira empresa que vai emitir pela sua ponte."
          action={
            <Button asChild size="sm">
              <Link to="/clientes/novo">Novo cliente</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Empresa</th>
                <th className="px-4 py-3 font-medium">Plano</th>
                <th className="px-4 py-3 font-medium">Certificado</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clientes.map((c) => {
                const s = STATUS[c.status] ?? STATUS.draft;
                return (
                  <tr key={c.empresaCnpj} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{c.razaoSocial || c.fantasia || c.empresaCnpj}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatCnpj(c.empresaCnpj)}
                        {c.codigoInterno ? ` · ${c.codigoInterno}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 uppercase text-muted-foreground">{c.plano}</td>
                    <td className="px-4 py-3">
                      {c.temCertificado ? (
                        <span className="text-emerald-600 dark:text-emerald-400">Enviado</span>
                      ) : (
                        // Sem certificado o cliente nao emite nada. Dizer isso na
                        // lista evita abrir o cadastro para descobrir.
                        <span className="text-amber-600 dark:text-amber-400">Falta</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.classe}`}>
                        {s.texto}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link to="/clientes/$cnpj" params={{ cnpj: c.empresaCnpj }}>
                          Abrir
                        </Link>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
