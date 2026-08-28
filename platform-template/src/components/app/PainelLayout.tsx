import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { BarChart3, BookOpen, FileText, LayoutDashboard, LifeBuoy, LogOut, Menu, Package, ReceiptText, Satellite, Settings, ShoppingCart, Stamp, Truck, Users, X } from "lucide-react";
import { manifest, formatCnpj, logoEscura, marca, moduloAtivo, rodape } from "@/lib/manifest";
import { sair } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BotaoTema } from "@/components/app/BotaoTema";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/nfe", label: "NF-e", icon: FileText, modulo: "nfe" },
  // O outro lado da mercadoria: a nota que o FORNECEDOR emitiu contra a
  // empresa. E dela que sai o credito de ICMS e a escrituracao da compra.
  { to: "/nfe/compras", label: "Compras", icon: Truck, modulo: "nfe" },
  // "Balcao" e nao "NFC-e": quem opera o caixa vende, e o cupom e consequencia.
  // O nome fiscal fica no titulo da tela, para quem precisa dele.
  { to: "/nfce", label: "Balcão", icon: ShoppingCart, modulo: "nfce" },
  { to: "/nfse", label: "NFS-e", icon: ReceiptText, modulo: "nfse" },
  // A outra metade do servico: a nota que o FORNECEDOR emitiu contra a
  // empresa. E a que o contador precisa para escriturar despesa, e a unica
  // que nao passa por este sistema — chega por e-mail, ou nao chega.
  { to: "/nfse/radar", label: "Notas recebidas", icon: Satellite, modulo: "nfse" },
  { to: "/destinatarios", label: "Destinatários", icon: Users },
  // O cadastro fiscal atende os dois lados: produtos e regras para quem vende
  // mercadoria, catalogo de servicos para quem presta. Ficava preso ao modulo
  // de NF-e, e por isso quem so tinha NFS-e nao alcancava o proprio catalogo —
  // que era, alias, o unico jeito de cadastrar NBS e tributacao nacional.
  { to: "/fiscal", label: "Cadastro fiscal", icon: Package, modulos: ["nfe", "nfce", "nfse"] },
  { to: "/relatorios", label: "Relat\u00f3rios", icon: BarChart3 },
  // O que sai impresso no papel: a logo do quadro do emitente e o texto fixo.
  // S\u00f3 faz sentido para quem emite documento com DANFE \u2014 a NFS-e tem layout
  // pr\u00f3prio, definido pela prefeitura, e nada disto a alcan\u00e7a.
  { to: "/parametros", label: "Par\u00e2metros do DANFE", icon: Stamp, modulos: ["nfe", "nfce"] },
  { to: "/configuracoes", label: "Configura\u00e7\u00f5es", icon: Settings },
  { to: "/suporte", label: "Suporte", icon: LifeBuoy },
]
  /**
   * O menu segue o que o cliente contratou.
   *
   * Era uma lista fixa, e todo cliente via NF-e e NFS-e. Quem so contratou
   * produto abria uma aba de servico que nao emite nada — e descobria clicando,
   * ou ligando para perguntar por que o sistema dele tem uma tela quebrada.
   *
   * Quem decide e o manifest, nao o codigo. E o que permite UM modelo servir as
   * tres combinacoes — so produto, so servico, ou os dois — sem manter tres
   * copias do mesmo sistema, que divergem no primeiro conserto.
   */
  .filter((item) => {
    // `modulo` prende a um so; `modulos` aceita qualquer um da lista — e o que
    // permite uma tela servir a produto e a servico sem duplicar entrada.
    if ("modulos" in item) {
      return (item.modulos as ("nfe" | "nfce" | "nfse")[]).some((m) => moduloAtivo(m));
    }
    if ("modulo" in item) return moduloAtivo(item.modulo as "nfe" | "nfce" | "nfse");
    return true;
  });

export function PainelLayout({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const logout = useServerFn(sair);

  async function handleLogout() {
    await logout();
    await router.navigate({ to: "/" });
  }

  return (
    <div className="flex min-h-screen bg-background">
      {open && (
        <button
          aria-label="Fechar menu"
          className="fixed inset-0 z-30 bg-secondary/60 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-sidebar-border px-5 py-5">
          <div className="min-w-0">
            {/* A barra lateral tem fundo escuro sempre, entao usa a versao
                escura da logo — a clara some nela. */}
            {logoEscura() ? (
              <img
                src={logoEscura()}
                alt={marca}
                className="h-7 w-auto max-w-[150px] object-contain"
              />
            ) : (
              <p className="truncate text-sm font-semibold tracking-tight">
                {manifest.company.brandName}
              </p>
            )}
            <p className="text-xs text-sidebar-foreground/60">Plataforma Fiscal</p>
          </div>
          <button className="lg:hidden" aria-label="Fechar" onClick={() => setOpen(false)}>
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              activeProps={{
                className:
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm bg-sidebar-accent text-sidebar-accent-foreground font-medium",
              }}
              activeOptions={{ exact: item.to === "/dashboard" }}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-sidebar-border px-5 py-4 text-xs text-sidebar-foreground/60">
          <p className="truncate">{manifest.company.name}</p>
          <p>CNPJ {formatCnpj(manifest.company.cnpj)}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
          <button className="lg:hidden" aria-label="Abrir menu" onClick={() => setOpen(true)}>
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
            {description && (
              <p className="truncate text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <BotaoTema />
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="size-4" /> <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
        <footer className="border-t border-border bg-card px-4 py-4 text-center text-xs text-muted-foreground sm:px-6">
          {rodape}
        </footer>
      </div>
    </div>
  );
}
