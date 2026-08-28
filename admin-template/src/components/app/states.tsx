import type { ReactNode } from "react";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CAPS } from "@/lib/tipografia";

export function LoadingState({ label = "Carregando..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card px-6 py-16 text-muted-foreground">
      <Loader2 className="size-6 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
      <Inbox className="size-7 text-muted-foreground" />
      <p className={cn("text-sm text-foreground", CAPS)}>{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-16 text-center">
      <AlertCircle className="size-7 text-destructive" />
      <p className={cn("text-sm text-foreground", CAPS)}>Algo deu errado</p>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

/**
 * Selo de uma palavra, na cor do sentido.
 *
 * Existe porque a regra de cor já vazou uma vez: a tela de Configurações tinha
 * a própria cópia do selo verde, escrita à mão, e ficou para trás quando o
 * contraste do `StatusBadge` foi corrigido — voltando a mostrar texto quase
 * preto sobre fundo escuro no modo escuro.
 *
 * O `-tint` é a cor de texto para fundo TINGIDO (a cor a 15%), diferente do
 * `-foreground`, que é para fundo sólido. Trocar um pelo outro é o erro que
 * some no tema claro e reaparece no escuro.
 */
export function Selo({
  children,
  tom = "neutro",
}: {
  children: ReactNode;
  tom?: "sucesso" | "alerta" | "erro" | "neutro";
}) {
  const cores = {
    sucesso: "bg-success/15 text-success-tint ring-success/40",
    alerta: "bg-warning/20 text-warning-tint ring-warning/40",
    erro: "bg-destructive/10 text-destructive ring-destructive/30",
    neutro: "bg-muted text-muted-foreground ring-border",
  }[tom];
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ring-1", CAPS, cores)}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status?: string | undefined }) {
  const value = (status ?? "desconhecido").toLowerCase();
  // A cor sai do `Selo`: a regra mora num lugar so, senao volta a divergir.
  const tom = value.includes("autoriz")
    ? "sucesso" as const
    : value.includes("cancel") || value.includes("rejeit") || value.includes("erro")
      ? "erro" as const
      : value.includes("process") || value.includes("pend")
        ? "alerta" as const
        : "neutro" as const;
  return <Selo tom={tom}>{status ?? "Desconhecido"}</Selo>;
}
