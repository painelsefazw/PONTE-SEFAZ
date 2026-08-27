# Rotas de clientes — contrato para um front end proprio

O painel que acompanha a instancia ja atende. Este documento existe para quem
vai construir outro por fora (Lovable, Next, o que for) e precisa do contrato
sem ter de ler o servidor.

## Autenticacao

Rotas `/api/admin/*` exigem a senha administrativa **no mesmo header das chaves
de cliente**:

```
x-api-key: <WEBAPP_SENHA>
```

Nao ha header proprio de admin: o servidor compara o `x-api-key` recebido com a
`WEBAPP_SENHA` e, batendo, trata a requisicao como administrativa. Se nao bater,
tenta validar como chave de cliente.

**Essa senha nunca pode ir para o navegador.** Um front end que a coloque em
codigo de cliente entrega o painel inteiro a quem abrir o DevTools. O caminho
correto e o mesmo do template das plataformas: as chamadas passam por uma
funcao de servidor, e so ela conhece a senha.

## Clientes

| Metodo | Rota | O que faz |
|---|---|---|
| GET | `/api/admin/clients` | Lista. Aceita `?status=` e `?q=` |
| POST | `/api/admin/clients` | Cria. Corpo: `{ empresaCnpj, razaoSocial, fantasia?, plano?, responsavel?, emailTecnico? }` |
| GET | `/api/admin/clients/:cnpj` | Detalhe, com servicos, limites e divergencia de plano |
| PATCH | `/api/admin/clients/:cnpj` | Atualiza cadastro |
| POST | `/api/admin/clients/:cnpj/status` | Muda status: `draft`, `sandbox`, `active`, `suspended`, `past_due`, `cancelled` |
| DELETE | `/api/admin/clients/:cnpj` | Remove |
| GET | `/api/admin/clients/:cnpj/resumo` | Painel do cliente: uso, ultimas notas, eventos |

## Dados fiscais e certificado

| Metodo | Rota | O que faz |
|---|---|---|
| POST | `/api/admin/clients/:cnpj/fiscal` | IE, IM, CRT, UF, endereco com codigo IBGE |
| POST | `/api/admin/clients/:cnpj/certificado` | `.pfx` em base64 + senha. Guardado cifrado |

## Chaves de API

| Metodo | Rota | O que faz |
|---|---|---|
| GET | `/api/admin/clients/:cnpj/keys` | Lista (so o prefixo — o valor nao e recuperavel) |
| POST | `/api/admin/clients/:cnpj/keys` | Gera. **A chave completa aparece uma unica vez, nesta resposta** |
| DELETE | `/api/admin/clients/:cnpj/keys/:id` | Revoga |

O corpo aceita `ambiente`: `homologacao`, `producao` ou `ambos`. Omitir
faz a chave herdar o ambiente do cadastro da empresa — e uma chave que emite em
teste sem ninguem perceber.

## Servicos contratados

| Metodo | Rota | O que faz |
|---|---|---|
| GET | `/api/admin/clients/:cnpj/services` | Lista |
| POST | `/api/admin/clients/:cnpj/services` | Ativa: `{ service: "nfe" | "nfce" | "nfse" }` |
| DELETE | `/api/admin/clients/:cnpj/services/:service` | Desativa |

E dessa lista que saem as abas da plataforma do cliente. Ativar servico que o
plano nao cobre — ou deixar de ativar o que ele cobre — aparece como
`divergenciaPlano` no detalhe.

## Plataforma white-label

| Metodo | Rota | O que faz |
|---|---|---|
| POST | `/api/admin/clients/:cnpj/generate-platform` | Gera o manifest e as credenciais |
| GET | `/api/admin/clients/:cnpj/kit.zip` | O repositorio pronto, em zip |
| POST | `/api/admin/clients/:cnpj/publicar-repositorio` | Publica num repositorio do GitHub. Corpo: `{ repositoryUrl }` |
| POST | `/api/admin/github/verificar` | Testa se o token alcanca o repositorio. Nao escreve nada |
| GET | `/api/admin/clients/:cnpj/white-label` | Marca, cores, logo |
| POST | `/api/admin/clients/:cnpj/white-label` | Salva a marca |

## Webhooks e auditoria

| Metodo | Rota | O que faz |
|---|---|---|
| GET/POST | `/api/admin/clients/:cnpj/webhooks` | Endpoints de notificacao |
| GET | `/api/admin/audit` | Log de auditoria |
| GET | `/api/admin/requests` | Log de requisicoes da API |

## Do lado do cliente

O que a plataforma dele consome, com `x-api-key` e `x-empresa-cnpj`:
`/api/emitir`, `/api/emitir-nfce`, `/api/nfse/emitir`, `/api/cancelar`,
`/api/historico`, `/api/consultar`, `/api/nota/:chave/xml`,
`/api/nota/:chave/danfe`, `/api/nfe/distribuicao`, `/api/nfse/distribuicao`,
`/api/manifestar`, `/api/produtos`, `/api/nfse/servicos`.

A lista viva, com corpo e exemplo de cada uma, esta em `/api/docs` da propria
instancia depois que ela subir.
