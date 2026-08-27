import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { PainelLayout } from "@/components/app/PainelLayout";
import { LoadingState, ErrorState, EmptyState } from "@/components/app/states";
import { listarDocumentos, type DocumentoFiscal } from "@/lib/fiscal.functions";
import { formatCurrency } from "@/lib/format";
import { tituloDaPagina } from "@/lib/manifest";

export const Route = createFileRoute("/_painel/relatorios")({
  head: () => ({
    meta: [
      { title: tituloDaPagina("Indicadores") },
      { name: "description", content: "Painel de emissao: volume, valores e destinatarios." },
    ],
  }),
  component: Indicadores,
});

/**
 * Paleta em variáveis do tema, não em hexadecimal.
 *
 * Gráfico com cor fixa fica ilegível no modo escuro — linha escura sobre fundo
 * escuro. Recharts não lê CSS custom properties direto, então os valores vêm de
 * `oklch` calculados para funcionar nos dois temas.
 */
const CORES = {
  produto: "oklch(0.62 0.19 259)",
  servico: "oklch(0.68 0.16 163)",
  grade: "oklch(0.6 0.02 264 / 0.2)",
  eixo: "oklch(0.6 0.02 264)",
};

const PIZZA = [
  "oklch(0.62 0.19 259)", "oklch(0.68 0.16 163)", "oklch(0.72 0.17 70)",
  "oklch(0.65 0.2 15)", "oklch(0.63 0.17 305)", "oklch(0.6 0.02 264)",
];

const PERIODOS = [
  { dias: 7, texto: "7 dias" },
  { dias: 30, texto: "30 dias" },
  { dias: 90, texto: "90 dias" },
  { dias: 365, texto: "12 meses" },
];

const soData = (d: unknown) => String(d ?? "").slice(0, 10);

function Indicadores() {
  const listar = useServerFn(listarDocumentos);
  const [dias, setDias] = useState(30);
  // Os graficos existiam e nao apareciam: o filtro so aceitava producao, e quem
  // ainda esta testando emite em homologacao. A tela dizia "nada emitido" e
  // sumia com tudo — parecia que os graficos nao tinham sido feitos.
  //
  // Misturar os dois numa conta de faturamento continua fora de questao: nota de
  // teste vira numero errado para quem decide com ele. Por isso o ambiente e uma
  // ESCOLHA visivel, com o titulo dizendo qual esta na tela.
  const [ambiente, setAmbiente] = useState<"1" | "2">("1");

  // Atualiza sozinho: e um painel ao vivo, nao um relatorio que se gera. Quem
  // deixa a tela aberta durante o expediente ve a emissao acontecendo.
  const nfe = useQuery({
    queryKey: ["docs", "nfe"],
    queryFn: () => listar({ data: { tipo: "nfe" } }),
    refetchInterval: 60_000,
  });
  const nfse = useQuery({
    queryKey: ["docs", "nfse"],
    queryFn: () => listar({ data: { tipo: "nfse" } }),
    refetchInterval: 60_000,
  });

  const dados = useMemo(() => {
    const doc = (q: typeof nfe) => (q.data?.ok ? q.data.data : []);
    // So producao: nota de teste no grafico de faturamento e numero errado
    // para quem decide com ele.
    const valida = (d: DocumentoFiscal) =>
      String(d.ambiente ?? "1") === ambiente && String(d.status ?? "").toUpperCase() !== "CANCELADA";

    const corte = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
    const noPeriodo = (d: DocumentoFiscal) => soData(d.emitidoEm) >= corte;

    const produtos = doc(nfe).filter(valida).filter(noPeriodo);
    const servicos = doc(nfse).filter(valida).filter(noPeriodo);
    const todos = [...produtos, ...servicos];

    // Serie temporal com todos os dias preenchidos: buraco no eixo faz o
    // grafico mentir sobre o ritmo.
    const porDia = new Map<string, { produto: number; servico: number; valor: number }>();
    for (let i = dias - 1; i >= 0; i--) {
      porDia.set(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10),
        { produto: 0, servico: 0, valor: 0 });
    }
    const somar = (lista: DocumentoFiscal[], campo: "produto" | "servico") => {
      for (const d of lista) {
        const dia = porDia.get(soData(d.emitidoEm));
        if (!dia) continue;
        dia[campo] += 1;
        dia.valor += Number(d.valor ?? 0);
      }
    };
    somar(produtos, "produto");
    somar(servicos, "servico");

    const serie = [...porDia.entries()].map(([data, v]) => ({
      data,
      rotulo: data.slice(8, 10) + "/" + data.slice(5, 7),
      ...v,
    }));

    // Quem mais recebe nota — o grafico que responde "de quem depende meu
    // faturamento", que e a pergunta que ninguem consegue responder de cabeca.
    const porCliente = new Map<string, { nome: string; valor: number; notas: number }>();
    for (const d of todos) {
      const nome = String(d.destinatario ?? d.tomador ?? "—");
      const atual = porCliente.get(nome) ?? { nome, valor: 0, notas: 0 };
      atual.valor += Number(d.valor ?? 0);
      atual.notas += 1;
      porCliente.set(nome, atual);
    }
    const topClientes = [...porCliente.values()].sort((a, b) => b.valor - a.valor).slice(0, 6);

    const total = todos.reduce((s, d) => s + Number(d.valor ?? 0), 0);
    const canceladas = [...doc(nfe), ...doc(nfse)]
      .filter((d) => String(d.ambiente ?? "1") === "1" && String(d.status ?? "").toUpperCase() === "CANCELADA")
      .filter(noPeriodo).length;

    // Metade anterior contra metade atual: dizer "subiu 12%" exige com o que
    // comparar, e o periodo imediatamente anterior e a comparacao honesta.
    const meio = Math.floor(dias / 2);
    const naMetade = (ini: number, fim: number) =>
      serie.slice(ini, fim).reduce((s, d) => s + d.valor, 0);
    const anterior = naMetade(0, meio);
    const atual = naMetade(meio, serie.length);
    const variacao = anterior > 0 ? ((atual - anterior) / anterior) * 100 : null;

    return {
      serie, topClientes, total, canceladas,
      qtdProduto: produtos.length,
      qtdServico: servicos.length,
      ticket: todos.length ? total / todos.length : 0,
      variacao,
      vazio: todos.length === 0,
    };
  }, [nfe.data, nfse.data, dias, ambiente]);

  // Quantas notas ha no ambiente que NAO esta na tela. E o que transforma um
  // "nada emitido" sem saida numa dica acionavel.
  const noOutroAmbiente = useMemo(() => {
    const outro = ambiente === "1" ? "2" : "1";
    const doc = (q: typeof nfe) => (q.data?.ok ? q.data.data : []);
    return [...doc(nfe), ...doc(nfse)]
      .filter((d) => String(d.ambiente ?? "1") === outro).length;
  }, [nfe.data, nfse.data, ambiente]);

  if (nfe.isLoading || nfse.isLoading) return <LoadingState label="Carregando indicadores..." />;
  if (nfe.data && !nfe.data.ok) {
    return <ErrorState message={nfe.data.error} onRetry={() => nfe.refetch()} />;
  }

  return (
    <PainelLayout
      title="Indicadores"
      description={
        ambiente === "1"
          ? "Atualiza sozinho a cada minuto. So notas validas de producao."
          : "HOMOLOGACAO: numeros de teste, sem valor fiscal. Nao use para decidir nada."
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            {([["1", "Producao"], ["2", "Homologacao"]] as const).map(([valor, texto]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setAmbiente(valor)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  ambiente === valor
                    ? valor === "1"
                      ? "bg-primary text-primary-foreground"
                      : "bg-warning text-warning-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {texto}
              </button>
            ))}
          </div>
        <div className="flex rounded-lg border border-border p-0.5">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              type="button"
              onClick={() => setDias(p.dias)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                dias === p.dias
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.texto}
            </button>
          ))}
        </div>
        </div>
      }
    >
      {dados.vazio ? (
        <EmptyState
          title={ambiente === "1" ? "Nada emitido em producao neste periodo" : "Nada emitido em homologacao neste periodo"}
          description={
            noOutroAmbiente > 0
              ? `Ha ${noOutroAmbiente} nota(s) em ${ambiente === "1" ? "homologacao" : "producao"}. Troque o ambiente acima para ve-las.`
              : "Assim que sair a primeira nota valida, os graficos aparecem aqui."
          }
        />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador
              rotulo="Faturado"
              valor={formatCurrency(dados.total)}
              nota={
                dados.variacao === null ? "sem base de comparacao"
                  : `${dados.variacao >= 0 ? "+" : ""}${dados.variacao.toFixed(0)}% vs periodo anterior`
              }
              cor={dados.variacao !== null && dados.variacao < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}
            />
            <Indicador rotulo="Notas emitidas" valor={String(dados.qtdProduto + dados.qtdServico)}
              nota={`${dados.qtdProduto} de produto · ${dados.qtdServico} de servico`} />
            <Indicador rotulo="Ticket medio" valor={formatCurrency(dados.ticket)} nota="por nota" />
            <Indicador rotulo="Canceladas" valor={String(dados.canceladas)}
              nota={dados.canceladas > 0 ? "conferir com a contabilidade" : "nenhuma"}
              cor={dados.canceladas > 0 ? "text-destructive" : undefined} />
          </div>

          <Grafico titulo="Faturamento por dia" descricao="Soma das notas validas em cada dia.">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={dados.serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gFat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CORES.produto} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={CORES.produto} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CORES.grade} vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.eixo }} tickLine={false} axisLine={false}
                  interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: CORES.eixo }} tickLine={false} axisLine={false} width={64}
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <Tooltip content={<Dica formatar={formatCurrency} />} />
                <Area type="monotone" dataKey="valor" stroke={CORES.produto} strokeWidth={2} fill="url(#gFat)" />
              </AreaChart>
            </ResponsiveContainer>
          </Grafico>

          <div className="grid gap-5 lg:grid-cols-2">
            <Grafico titulo="Notas por dia" descricao="Produto e servico lado a lado.">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dados.serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={CORES.grade} vertical={false} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.eixo }} tickLine={false} axisLine={false}
                    interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: CORES.eixo }} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                  <Tooltip content={<Dica />} />
                  <Bar dataKey="produto" name="NF-e" stackId="n" fill={CORES.produto} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="servico" name="NFS-e" stackId="n" fill={CORES.servico} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <Legenda itens={[["NF-e", CORES.produto], ["NFS-e", CORES.servico]]} />
            </Grafico>

            <Grafico titulo="De quem vem o faturamento" descricao="Os seis maiores no periodo.">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={dados.topClientes} dataKey="valor" nameKey="nome"
                    innerRadius={52} outerRadius={86} paddingAngle={2}>
                    {dados.topClientes.map((_, i) => (
                      <Cell key={i} fill={PIZZA[i % PIZZA.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<Dica formatar={formatCurrency} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5">
                {dados.topClientes.map((c, i) => (
                  <div key={c.nome} className="flex items-center gap-2 text-xs">
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: PIZZA[i % PIZZA.length] }} />
                    <span className="min-w-0 flex-1 truncate">{c.nome}</span>
                    <span className="shrink-0 text-muted-foreground">{c.notas}x</span>
                    <span className="shrink-0 font-medium tabular-nums">{formatCurrency(c.valor)}</span>
                  </div>
                ))}
              </div>
            </Grafico>
          </div>
        </div>
      )}
    </PainelLayout>
  );
}

function Indicador({ rotulo, valor, nota, cor }: {
  // `exactOptionalPropertyTypes` distingue "ausente" de "undefined": sem o
  // `| undefined` explicito, passar undefined nao compila.
  rotulo: string; valor: string; nota?: string | undefined; cor?: string | undefined;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{valor}</div>
      {nota && <div className={`mt-0.5 text-xs ${cor ?? "text-muted-foreground"}`}>{nota}</div>}
    </div>
  );
}

function Grafico({ titulo, descricao, children }: {
  titulo: string; descricao?: string; children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {descricao && <p className="text-xs text-muted-foreground">{descricao}</p>}
      </div>
      {children}
    </section>
  );
}

function Legenda({ itens }: { itens: Array<[string, string]> }) {
  return (
    <div className="flex flex-wrap gap-4">
      {itens.map(([texto, cor]) => (
        <span key={texto} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2.5 rounded-sm" style={{ background: cor }} /> {texto}
        </span>
      ))}
    </div>
  );
}

/** Tooltip com as cores do tema — o padrão do recharts é branco fixo. */
function Dica({ active, payload, label, formatar }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      {label && <div className="mb-1 font-medium">{label}</div>}
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="size-2 rounded-sm" style={{ background: p.color ?? p.payload?.fill }} />
          <span className="text-muted-foreground">{p.name ?? p.payload?.nome}</span>
          <span className="font-medium">{formatar ? formatar(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}
