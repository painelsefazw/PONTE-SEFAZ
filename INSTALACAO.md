# Instalacao

Quatro passos. Nenhum exige rodar migration a mao.

## 1. O banco

Crie um projeto no Supabase e copie a **connection string** do Postgres
(Settings > Database > Connection string). E ela que vai em `NFE_DB_URL`.

**Escolha a do POOLER, nao a "Direct connection".** A direta responde so em IPv6
no plano gratuito, e provedor serverless nao alcanca — o sintoma e um erro de
conexao que nao menciona IPv6 em lugar nenhum. O pooler tambem segura melhor o
padrao serverless, em que cada requisicao pode abrir conexao propria.

### Na Vercel, prefira a integracao a copiar a mao

A Vercel tem integracao com o Supabase (Integrations > Supabase > Connect). Ela
escreve `POSTGRES_URL` sozinha, ja apontando para o pooler e com a senha
codificada — e a ponte aceita esse nome quando `NFE_DB_URL` esta vazia.

Vale a pena porque essa linha e a etapa que mais quebra numa instalacao nova, e
os erros dela nao apontam para a causa:

| O que aconteceu | O que o log diz |
|---|---|
| Sobrou um espaco no meio | `ENOTFOUND` de um host que voce nunca escreveu |
| A senha tem `@`, `#`, `%`, `+` ou `/` | `password authentication failed` — como se a senha estivesse errada |
| Copiou de uma pagina traduzida pelo navegador | palavra em portugues no meio da URL |

Se copiar a mao mesmo assim: desligue a traducao automatica da pagina do
Supabase antes, e use uma senha so de letras e numeros — assim nao ha nada para
codificar.

Se a senha tiver caracteres especiais, codifique-os na URL (`@` vira `%40`).

O schema **nao precisa ser criado**: as 30 tabelas nascem sozinhas na primeira
chamada, com `CREATE TABLE IF NOT EXISTS`. Para conferir antes de publicar, e
ver o erro de conexao na sua maquina em vez de num log de producao:

```bash
npm install
NFE_DB_URL="postgres://..." npx ts-node scripts/preparar-banco.ts
```

Ele conecta, cria tudo e lista o que criou.

## 2. As variaveis

Copie `.env.example` para `.env` e preencha. As obrigatorias:

| Variavel | O que e |
|---|---|
| `NFE_DB_URL` | Postgres do Supabase. Sem ela nada persiste: nem nota, nem cliente, nem chave. Se preferir nao montar a URL a mao, deixe vazia e preencha as tres NFE_DB_* abaixo. |
| `NFE_DB_PASSWORD` | ALTERNATIVA a NFE_DB_URL: so a senha do banco, sozinha. O codigo codifica os simbolos. |
| `NFE_DB_REF` | ALTERNATIVA a NFE_DB_URL: a referencia do projeto Supabase (o pedaco do meio da URL do painel). |
| `NFE_DB_HOST` | ALTERNATIVA a NFE_DB_URL: o host do pooler, ex. aws-0-us-west-2.pooler.supabase.com. |
| `WEBAPP_SENHA` | Senha do painel administrativo desta instancia. |
| `WEBAPP_MASTER_KEY` | Cifra os certificados A1 guardados no banco. Trocar depois torna ilegiveis os ja enviados. |

Recomendadas:

| Variavel | O que e |
|---|---|
| `API_PUBLIC_URL` | Endereco publico DESTA instancia. Sem ele as plataformas geradas apontam para o lugar errado. |
| `DANFE_SERVICE_URL` | Servico que transforma XML em PDF. Pode ser o mesmo da instancia existente: ele nao guarda estado. |
| `DANFE_KEY` | Chave do servico de DANFE. |
| `NFE_AMBIENTE` | 1 producao, 2 homologacao. Padrao 2 — comece por ele. |
| `NFE_CRT` | Regime tributario do emitente padrao. 1 Simples, 3 Normal. |
| `CRON_SECRET` | Protege as rotas de cron (reenvio de webhook, keepalive). |
| `GITHUB_TOKEN` | So para publicar plataforma de cliente direto do painel. Fine-grained, com Contents read/write nos repositorios das plataformas. |

Duas observacoes que economizam tempo:

- `WEBAPP_MASTER_KEY` cifra os certificados dos clientes guardados no banco.
  Escolha uma e **nao troque depois**: os certificados ja enviados ficam
  ilegiveis, e nao ha como recuperar sem reenviar.
- `DANFE_SERVICE_URL` pode apontar para o servico que ja existe. Ele so
  transforma XML em PDF e nao guarda nada, entao duas instancias compartilham
  sem interferencia.

## 3. Publicar

Qualquer provedor que rode Node. Na Vercel o `vercel.json` ja esta pronto:
importe o repositorio, cadastre as variaveis em **Production** e publique.

Variavel de ambiente **so vale em deploy criado depois dela**. Cadastre
primeiro, publique depois — ou publique de novo apos cadastrar.

## 4. O primeiro cliente

No painel, em **Clientes API**:

1. **+ Novo Cliente API** com CNPJ e razao social.
2. **Cadastro fiscal** — IE, regime, UF e municipio (o codigo IBGE, 7 digitos).
3. **Certificado A1** — o .pfx do cliente e a senha.
4. **+ Adicionar servico** — NF-e, NFC-e, NFS-e, conforme o contratado.
5. **Gerar chave** — e a credencial que ele usa na API.
6. **Gerar plataforma** — devolve o repositorio pronto da plataforma dele, com
   a marca aplicada. So aparecem as abas dos servicos contratados.

## Conferindo que subiu certo

- `GET /api/health` responde sem erro.
- O painel abre em `/` e aceita a `WEBAPP_SENHA`.
- **Emita uma nota em homologacao antes de qualquer coisa em producao.** E o
  unico teste que prova certificado, banco, numeracao e SEFAZ de uma vez.
