import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { aplicarTema, ouvirSistema, salvarTema, temaSalvo, type Tema } from "@/lib/tema";

/**
 * Alterna claro / escuro / sistema.
 *
 * Três estados e não dois: "sistema" é o padrão porque quem deixou o computador
 * em modo escuro espera que tudo acompanhe, e porque é o único que muda sozinho
 * quando anoitece. Um botão de dois estados obriga a pessoa a trocar na mão duas
 * vezes por dia.
 *
 * O ciclo é claro → escuro → sistema, e o ícone diz onde está.
 */
const CICLO: Record<Tema, Tema> = { claro: "escuro", escuro: "sistema", sistema: "claro" };

const ROTULO: Record<Tema, string> = {
  claro: "Tema claro",
  escuro: "Tema escuro",
  sistema: "Acompanha o sistema",
};

export function BotaoTema() {
  // Nasce em "sistema" e só lê o armazenado depois de montar: no servidor não
  // existe localStorage, e divergir entre servidor e cliente quebra a hidratação.
  const [tema, setTema] = useState<Tema>("sistema");

  useEffect(() => {
    const atual = temaSalvo();
    setTema(atual);
    aplicarTema(atual);
  }, []);

  // No modo "sistema", seguir a troca sem precisar recarregar.
  useEffect(() => {
    if (tema !== "sistema") return;
    return ouvirSistema(() => aplicarTema("sistema"));
  }, [tema]);

  function alternar() {
    const proximo = CICLO[tema];
    setTema(proximo);
    salvarTema(proximo);
  }

  const Icone = tema === "claro" ? Sun : tema === "escuro" ? Moon : Monitor;

  return (
    <button
      type="button"
      onClick={alternar}
      title={ROTULO[tema]}
      aria-label={ROTULO[tema]}
      className="inline-flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
    >
      <Icone className="size-4" />
    </button>
  );
}
