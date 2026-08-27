import { createFileRoute, useRouter, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { entrar, sessaoAtual } from "@/lib/auth.functions";
import { formatCnpj, logoDaMarca, manifest, marca, mensagemDeLogin, rodape, tituloDaPagina } from "@/lib/manifest";
import { VARIAVEIS_OBRIGATORIAS, VARIAVEIS_OPCIONAIS } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const s = await sessaoAtual();
    if (s.authenticated) throw redirect({ to: "/dashboard" });
    // Projeto recem-copiado ainda nao tem as variaveis cadastradas. Isso e o
    // estado normal do primeiro minuto, nao uma falha — e a tela abaixo diz
    // quais faltam, em vez de o preview morrer com "Empty password".
    return { configPendente: s.configPendente ?? [] };
  },
  head: () => ({
    meta: [
      { title: `Login | ${marca} - Plataforma Fiscal` },
      {
        name: "description",
        content:
          `Acesse a plataforma fiscal da ${marca} para emitir NF-e e NFS-e com seguranca.`,
      },
      { property: "og:title", content: tituloDaPagina("Login") },
      {
        property: "og:description",
        content: `Plataforma fiscal da ${marca} para emissao de NF-e e NFS-e.`,
      },
    ],
  }),
  component: Login,
});

/**
 * Tela de configuracao pendente.
 *
 * Substitui o login enquanto faltar variavel de ambiente. Existe porque o
 * caminho normal deste modelo e ser copiado: todo projeto novo passa por este
 * estado, e sem esta tela ele passa por ele como pagina quebrada.
 */
function ConfiguracaoPendente({ faltando }: { faltando: string[] }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">Falta configurar o servidor</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A plataforma está publicada, mas ainda não tem as credenciais. Cadastre
          as variáveis abaixo no seu provedor e recarregue esta página.
        </p>

        <ul className="mt-5 space-y-3">
          {VARIAVEIS_OBRIGATORIAS.map((v) => {
            const pendente = faltando.includes(v.nome);
            return (
              <li key={v.nome} className="flex gap-3 text-sm">
                <span
                  className={
                    pendente
                      ? "mt-0.5 size-2 shrink-0 rounded-full bg-destructive"
                      : "mt-0.5 size-2 shrink-0 rounded-full bg-success"
                  }
                />
                <span>
                  <code className="font-medium">{v.nome}</code>
                  {pendente ? null : (
                    <span className="ml-2 text-xs text-muted-foreground">já configurada</span>
                  )}
                  <span className="block text-muted-foreground">{v.para}</span>
                </span>
              </li>
            );
          })}
        </ul>

        <p className="mt-5 text-xs text-muted-foreground">
          Os valores saem do painel do Emissor, em Clientes API. Nenhum deles vai
          para o repositório — veja <code>.env.example</code>.
        </p>

        {/* Estas nao sao pendencia, mas precisam aparecer: sem isto alguem
            procura por que o login aceita um usuario que alguem nunca cadastrou,
            ou cadastra as cinco por achar que todas sao obrigatorias. */}
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Estas você não precisa cadastrar
          </summary>
          <ul className="mt-3 space-y-2">
            {VARIAVEIS_OPCIONAIS.map((v) => (
              <li key={v.nome} className="text-xs text-muted-foreground">
                <code className="font-medium">{v.nome}</code>
                <span className="block">{v.para}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}

function Login() {
  const { configPendente } = Route.useRouteContext();
  const router = useRouter();
  const login = useServerFn(entrar);
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErro(null);
    try {
      const res = await login({ data: { usuario, senha } });
      if (res.ok) await router.navigate({ to: "/dashboard" });
      else setErro(res.error);
    } catch {
      setErro("N\u00e3o foi poss\u00edvel entrar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  if (configPendente.length) return <ConfiguracaoPendente faltando={configPendente} />;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            {/* A marca do cliente quando ela existe; o escudo so quando nao
                existe. Deixar o escudo fixo fazia toda plataforma vendida como
                "a sua" abrir com o mesmo icone de todas as outras. */}
            {logoDaMarca() ? (
              <img
                src={logoDaMarca()}
                alt={marca}
                className="mx-auto mb-4 h-12 w-auto max-w-[200px] object-contain"
              />
            ) : (
              <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
                <ShieldCheck className="size-6" />
              </div>
            )}
            <h1 className="text-2xl font-semibold tracking-tight">
              {mensagemDeLogin}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {manifest.company.brandName} &middot; Plataforma Fiscal
            </p>
          </div>

          <form
            onSubmit={onSubmit}
            className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            <div className="space-y-2">
              <Label htmlFor="usuario">Usuário</Label>
              <Input
                id="usuario"
                autoComplete="username"
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                // O usuario e o CNPJ da empresa. "seu.usuario" mandava inventar
                // um nome que nao existe, e a dica do CNPJ ficava so no rodape
                // do formulario, depois do botao.
                placeholder={formatCnpj(manifest.company.cnpj)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="senha">Senha</Label>
              <Input
                id="senha"
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
              />
            </div>
            {erro && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {erro}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              Entrar
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Usuário: o CNPJ da empresa. Com ou sem pontuação.
            </p>
          </form>
        </div>
      </div>
      <footer className="px-4 py-6 text-center text-xs text-muted-foreground">
        {rodape}
      </footer>
    </div>
  );
}
