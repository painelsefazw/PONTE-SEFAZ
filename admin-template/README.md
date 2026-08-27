# Console de Clientes — ponte fiscal

Front end administrativo da ponte: cadastro de clientes, serviços contratados,
chaves de API e publicação das plataformas white-label.

É um projeto separado da ponte de propósito. A ponte já traz um painel próprio
que funciona; este existe para quem quer uma interface própria, hospedada
separadamente, construída e evoluída no construtor (Lovable, ou qualquer outro).

## Onde este projeto fica na corrente

```
Console (aqui)  →  Ponte fiscal  →  Supabase
```

**Este projeto não fala com o banco.** Ele conversa com a ponte pela API dela, e é
a ponte que tem o Postgres. Não existe variável de banco aqui, e não deve
existir: connection string num front end é o banco inteiro exposto a quem abrir
o DevTools.

Se a ponte estiver no ar e o banco dela configurado, este console funciona sem
saber que Supabase existe.

## A regra que não pode ser quebrada

**A chave administrativa da ponte nunca vai para o navegador.**

Ela abre tudo: cadastro de todos os clientes, certificados A1, geração de chaves
de API. Um console que a exponha entrega isso a quem abrir o DevTools.

Por isso toda chamada passa por uma **função de servidor** — os arquivos
`*.server.ts` e as `createServerFn`. O componente pede a ação; só o servidor
conhece a chave. Nenhuma variável leva o prefixo `VITE_`, e não pode levar: o que
tem esse prefixo vai para o pacote do navegador.

## Variáveis

Copie `.env.example` para `.env` (desenvolvimento) ou cadastre no provedor
(produção).

| Variável | O que é |
|---|---|
| `EMISSOR_API_URL` | Endereço da ponte. Ex.: `https://sua-ponte.vercel.app` |
| `EMISSOR_ADMIN_KEY` | A `WEBAPP_SENHA` da ponte. É a credencial de administrador dela |
| `APP_ACCESS_PASSWORD` | Senha para entrar **neste** console |

Opcionais: `APP_USER` (padrão `admin`) e `SESSION_SECRET` (sem ele, derivado da
chave da ponte por HMAC).

### Por que duas senhas

A chave da ponte é a credencial mestre. Se ela fosse também a senha de login,
toda pessoa que opera o console conheceria a credencial mestre — e credencial que
várias pessoas conhecem não se revoga sem parar todo mundo.

Separadas: trocar quem opera é trocar uma senha. Trocar a chave da ponte continua
sendo um evento raro e deliberado.

## Autenticação com a ponte

Não existe header próprio de administrador. A ponte compara o `x-api-key`
recebido com a `WEBAPP_SENHA` dela e, batendo, trata a requisição como
administrativa. Se não bater, tenta validar como chave de cliente.

## O que já faz

- Lista de clientes com busca e filtro por status, feitos no servidor
- Cadastro de cliente novo
- Ativar e desativar serviços (NF-e, NFC-e, NFS-e)
- Gerar e revogar chaves de API, com escolha de ambiente
- Gerar o manifest, baixar o repositório da plataforma e publicar no GitHub
- Aviso quando plano e serviços não batem
- Visão geral que mostra o que trava cliente: sem certificado, ativo que nunca
  chamou a API

## O que ainda não faz

Dados fiscais (IE, regime, endereço), upload de certificado A1, white-label,
webhooks e auditoria. As rotas existem na ponte — o contrato está em
`docs/API-CLIENTES.md` do pacote dela — e o painel que acompanha a ponte cobre
tudo isso enquanto este console não cobrir.

## Rodar

```bash
npm install
npm run dev
```
