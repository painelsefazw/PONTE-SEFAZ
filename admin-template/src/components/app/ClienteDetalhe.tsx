import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, Download, Loader2, Plus, Trash2 } from "lucide-react";
import {
  ativarServico, baixarKitDoCliente, desativarServico, gerarChave, gerarPlataforma,
  listarChaves, mudarStatusDoCliente, obterCliente, publicarPlataforma, revogarChave,
  testarRepositorio,
  type StatusCliente,
} from "@/lib/admin.functions";
import { salvarArquivo } from "@/lib/download";
import { STATUS } from "@/components/app/ClientesLista";
import { LoadingState, ErrorState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCnpj } from "@/lib/manifest";
import { cn } from "@/lib/utils";
import { CAPS, SEM_CAPS } from "@/lib/tipografia";

const SERVICOS: { id: "nfe" | "nfce" | "nfse"; nome: string }[] = [
  { id: "nfe", nome: "NF-e" },
  { id: "nfce", nome: "NFC-e (balcão)" },
  { id: "nfse", nome: "NFS-e" },
];

const PROXIMOS_STATUS: { valor: StatusCliente; texto: string }[] = [
  { valor: "sandbox", texto: "Ambiente de testes" },
  { valor: "active", texto: "Ativar" },
  { valor: "suspended", texto: "Suspender" },
  { valor: "cancelled", texto: "Cancelar" },
];

/**
 * Tudo o que se faz com um cliente, numa tela.
 *
 * A ordem das secoes segue a ordem em que as coisas acontecem: cadastro,
 * servicos, chave, plataforma. Quem cadastra um cliente novo desce a pagina uma
 * vez e termina — em vez de descobrir o proximo passo por tentativa.
 */
export function ClienteDetalhe({ cnpj }: { cnpj: string }) {
  const obter = useServerFn(obterCliente);
  const chaves = useServerFn(listarChaves);
  const criarChave = useServerFn(gerarChave);
  const revogar = useServerFn(revogarChave);
  const ativar = useServerFn(ativarServico);
  const desativar = useServerFn(desativarServico);
  const mudarStatus = useServerFn(mudarStatusDoCliente);
  const gerar = useServerFn(gerarPlataforma);
  const baixarKit = useServerFn(baixarKitDoCliente);
  const testar = useServerFn(testarRepositorio);
  const publicar = useServerFn(publicarPlataforma);
  const qc = useQueryClient();

  const [ocupado, setOcupado] = useState<string | null>(null);
  const [chaveNova, setChaveNova] = useState<string | null>(null);
  const [ambienteDaChave, setAmbienteDaChave] = useState("homologacao");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoMsg, setRepoMsg] = useState<{ texto: string; bom: boolean; ajuda?: string } | null>(null);

  const qCliente = useQuery({ queryKey: ["cliente", cnpj], queryFn: () => obter({ data: { cnpj } }) });
  const qChaves = useQuery({ queryKey: ["chaves", cnpj], queryFn: () => chaves({ data: { cnpj } }) });

  if (qCliente.isLoading) return <LoadingState label="Carregando cliente..." />;
  if (qCliente.isError)
    return (
      <ErrorState
        message="Não foi possível carregar o cliente."
        onRetry={() => qCliente.refetch()}
      />
    );
  if (qCliente.data && !qCliente.data.ok)
    return <ErrorState message={qCliente.data.error} onRetry={() => qCliente.refetch()} />;

  const resposta = qCliente.data;
  const c = resposta && resposta.ok ? resposta.data : null;
  if (!c) return <ErrorState message="Cliente não encontrado." onRetry={() => qCliente.refetch()} />;

  const listaChaves = qChaves.data?.ok ? qChaves.data.data : [];
  const ativos = new Set((c.servicos ?? []).map((s) => String(s.service ?? s)));
  const st = STATUS[c.status] ?? STATUS.draft;

  async function comOcupado<T>(marca: string, fn: () => Promise<T>): Promise<T | null> {
    setOcupado(marca);
    try { return await fn(); } finally { setOcupado(null); }
  }

  function recarregar() {
    qc.invalidateQueries({ queryKey: ["cliente", cnpj] });
    qc.invalidateQueries({ queryKey: ["chaves", cnpj] });
  }

  return (
    <div className="space-y-6">
      {/* Cabecalho */}
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className={cn("text-lg", CAPS)}>{c.razaoSocial || c.fantasia}</h2>
            <p className="text-sm text-muted-foreground">
              {formatCnpj(c.empresaCnpj)}
              {c.codigoInterno ? ` · ${c.codigoInterno}` : ""} · plano{" "}
              <span className="uppercase">{c.plano}</span>
            </p>
          </div>
          <span className={cn("rounded-full px-3 py-1 text-xs", CAPS, st.classe)}>{st.texto}</span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {PROXIMOS_STATUS.filter((s) => s.valor !== c.status).map((s) => (
            <Button
              key={s.valor}
              type="button"
              variant="outline"
              size="sm"
              disabled={ocupado !== null}
              onClick={async () => {
                // Suspender e cancelar param a emissao do cliente na hora. Um
                // clique sem volta merece uma pergunta.
                if (
                  (s.valor === "suspended" || s.valor === "cancelled")
                  && !confirm(`${s.texto} este cliente? Ele para de emitir imediatamente.`)
                ) return;
                const r = await comOcupado(s.valor, () => mudarStatus({ data: { cnpj, status: s.valor } }));
                if (r && !r.ok) { toast.error(r.error); return; }
                toast.success(`Cliente agora está ${s.texto.toLowerCase()}.`);
                recarregar();
              }}
            >
              {s.texto}
            </Button>
          ))}
        </div>
      </section>

      {/* Divergencia de plano — o cliente paga por um servico que ninguem ativou */}
      {c.divergenciaPlano && (
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong>Plano e serviços não batem.</strong>{" "}
              {c.divergenciaPlano.faltam.length > 0 && (
                <>O plano inclui <b>{c.divergenciaPlano.faltam.join(", ").toUpperCase()}</b>, mas ninguém
                  ativou — a plataforma nasce sem essa aba e o cliente paga sem receber. </>
              )}
              {c.divergenciaPlano.sobram.length > 0 && (
                <><b>{c.divergenciaPlano.sobram.join(", ").toUpperCase()}</b> está ativado e o plano não cobre.</>
              )}
            </span>
          </p>
        </section>
      )}

      {/* Servicos */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h3 className={cn("text-sm", CAPS)}>Serviços contratados</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          É desta lista que saem as abas da plataforma do cliente.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {SERVICOS.map((s) => {
            const ligado = ativos.has(s.id);
            return (
              <Button
                key={s.id}
                type="button"
                variant={ligado ? "default" : "outline"}
                size="sm"
                // O rótulo é o nome oficial do documento (NF-e, NFC-e, NFS-e).
                className={SEM_CAPS}
                disabled={ocupado !== null}
                onClick={async () => {
                  const r = await comOcupado(s.id, () => (ligado
                    ? desativar({ data: { cnpj, service: s.id } })
                    : ativar({ data: { cnpj, service: s.id } })));
                  if (r && !r.ok) { toast.error(r.error); return; }
                  toast.success(`${s.nome} ${ligado ? "desativado" : "ativado"}.`);
                  recarregar();
                }}
              >
                {ocupado === s.id && <Loader2 className="size-4 animate-spin" />}
                {s.nome}
              </Button>
            );
          })}
        </div>
      </section>

      {/* Chaves */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h3 className={cn("text-sm", CAPS)}>Chaves de API</h3>

        {chaveNova && (
          // A ponte guarda so o hash: se esta tela perder o valor, nao ha como
          // recuperar. Por isso a chave fica FIXA aqui, e nao num aviso que some.
          <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
            <p className={cn("text-xs text-emerald-700 dark:text-emerald-400", CAPS)}>
              Copie agora — esta chave não aparece de novo
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded bg-background px-2 py-1 font-mono text-xs">
                {chaveNova}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(chaveNova);
                  toast.success("Chave copiada.");
                }}
              >
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
        )}

        <div className="mt-3 space-y-2">
          {listaChaves.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma chave ativa. Sem ela o cliente não consegue chamar a API.
            </p>
          )}
          {listaChaves.filter((k) => k.ativa !== false).map((k) => (
            <div
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
            >
              <div>
                <div className={cn("text-sm", CAPS)}>{k.nome || "Integração"}</div>
                <div className="font-mono text-xs text-muted-foreground">{k.prefixo}…</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn("rounded-full bg-muted px-2 py-0.5 text-xs", CAPS)}>
                  {k.ambientePermitido === "producao" ? "Produção"
                    : k.ambientePermitido === "ambos" ? "Produção + Homologação"
                      : "Homologação"}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={ocupado !== null}
                  onClick={async () => {
                    if (!confirm("Revogar esta chave? O cliente perde o acesso na hora.")) return;
                    const r = await comOcupado(`k${k.id}`, () => revogar({ data: { cnpj, id: k.id } }));
                    if (r && !r.ok) { toast.error(r.error); return; }
                    toast.success("Chave revogada.");
                    recarregar();
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="amb" className="text-xs">Ambiente da chave</Label>
            <select
              id="amb"
              value={ambienteDaChave}
              onChange={(e) => setAmbienteDaChave(e.target.value)}
              className="mt-1 flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring"
            >
              <option value="homologacao">HOMOLOGAÇÃO — SEM VALOR FISCAL</option>
              <option value="producao">PRODUÇÃO — NOTA REAL</option>
              <option value="ambos">AMBOS</option>
            </select>
          </div>
          <Button
            type="button"
            disabled={ocupado !== null}
            onClick={async () => {
              const r = await comOcupado("novaChave", () => criarChave({
                data: { cnpj, ambiente: ambienteDaChave },
              }));
              if (!r) return;
              if (!r.ok) { toast.error(r.error); return; }
              const valor = r.data.chave ?? r.data.apiKey;
              if (valor) setChaveNova(String(valor));
              toast.success("Chave gerada.");
              recarregar();
            }}
          >
            {ocupado === "novaChave" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Gerar chave
          </Button>
        </div>
      </section>

      {/* Plataforma */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h3 className={cn("text-sm", CAPS)}>Plataforma do cliente</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          O repositório pronto, com a marca dele. Só aparecem as abas dos serviços contratados.
        </p>

        {c.ultimaPublicacaoCommit && (
          <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Última publicação: <code>{c.ultimaPublicacaoCommit.slice(0, 7)}</code>
            {c.ultimaPublicacaoEm ? ` · ${new Date(c.ultimaPublicacaoEm).toLocaleString("pt-BR")}` : ""}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={ocupado !== null}
            onClick={async () => {
              const r = await comOcupado("gerar", () => gerar({ data: { cnpj } }));
              if (r && !r.ok) { toast.error(r.error); return; }
              toast.success("Manifest e credenciais gerados.");
              recarregar();
            }}
          >
            {ocupado === "gerar" && <Loader2 className="size-4 animate-spin" />}
            Gerar manifest
          </Button>
          <Button
            type="button"
            disabled={ocupado !== null}
            onClick={async () => {
              const r = await comOcupado("kit", () => baixarKit({
                data: { cnpj, marca: c.fantasia || c.razaoSocial },
              }));
              if (!r) return;
              if (!r.ok) { toast.error(r.error); return; }
              salvarArquivo(r.data.nome, r.data.tipo, r.data.base64);
              toast.success(`${r.data.nome} baixado.`);
            }}
          >
            {ocupado === "kit" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Baixar repositório (.zip)
          </Button>
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <Label htmlFor="repo" className="text-xs">Ou publicar direto no GitHub</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            <Input
              id="repo"
              className="min-w-[240px] flex-1"
              placeholder={c.repositoryUrl || "https://github.com/dono/repositorio"}
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={ocupado !== null}
              onClick={async () => {
                const url = repoUrl.trim() || c.repositoryUrl || "";
                const r = await comOcupado("testar", () => testar({ data: { repositoryUrl: url } }));
                if (!r) return;
                if (!r.ok) { setRepoMsg({ texto: r.error, bom: false }); return; }
                setRepoMsg({
                  texto: r.data.mensagem,
                  bom: r.data.podePublicar,
                  ...(r.data.comoResolver ? { ajuda: r.data.comoResolver } : {}),
                });
              }}
            >
              {ocupado === "testar" && <Loader2 className="size-4 animate-spin" />}
              Testar
            </Button>
            <Button
              type="button"
              disabled={ocupado !== null}
              onClick={async () => {
                const url = repoUrl.trim() || c.repositoryUrl || "";
                // O cadastro pode apontar para o repositorio errado — ja
                // apontou. Confirmar com o endereco a vista evita mandar a
                // plataforma de um cliente para dentro do repositorio de outro.
                if (!confirm(`Publicar a plataforma de ${c.razaoSocial} em:\n\n${url}\n\nConfirma?`)) return;
                const r = await comOcupado("publicar", () => publicar({
                  data: { cnpj, repositoryUrl: url },
                }));
                if (!r) return;
                if (!r.ok) { setRepoMsg({ texto: r.error, bom: false }); return; }
                setRepoMsg({
                  texto: `Publicado: ${r.data.arquivos} arquivos no branch ${r.data.branch} (commit ${String(r.data.commit).slice(0, 7)}).`,
                  bom: true,
                });
                recarregar();
              }}
            >
              {ocupado === "publicar" && <Loader2 className="size-4 animate-spin" />}
              Publicar
            </Button>
          </div>
          {repoMsg && (
            <div className={`mt-2 text-sm ${repoMsg.bom ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
              {repoMsg.texto}
              {repoMsg.ajuda && <div className="mt-1 text-xs text-muted-foreground">{repoMsg.ajuda}</div>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
