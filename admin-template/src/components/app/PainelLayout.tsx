import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { BookOpen, LayoutDashboard, LifeBuoy, LogOut, Menu, Settings, Users, X } from "lucide-react";
import { manifest, logoEscura, marca, rodape } from "@/lib/manifest";
import { sair } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BotaoTema } from "@/components/app/BotaoTema";

const nav = [
  { to: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
  { to: "/suporte", label: "Ajuda", icon: LifeBuoy },
];

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
            <p className="text-xs text-sidebar-foreground/60">Console de clientes</p>
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
