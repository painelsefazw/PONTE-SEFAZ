/**
 * Cria o schema desta instancia no banco configurado.
 *
 * Nao e uma migration: sao os mesmos `init()` que a aplicacao chama sozinha na
 * primeira requisicao. Rodar aqui serve para ver o erro de conexao NA SUA
 * MAQUINA, com a mensagem inteira, em vez de descobrir por um 500 no log de
 * producao — que foi como se descobriu, uma vez, que a senha do Postgres tinha
 * um "@" nao codificado.
 *
 *   NFE_DB_URL="postgres://..." npx ts-node scripts/preparar-banco.ts
 */
import { createStorage } from '../src/webapp/storage';
import { ApiClientStore } from '../src/webapp/api-clients';
import { ApiKeyStore } from '../src/webapp/apikeys';
import { AuditStore } from '../src/webapp/audit';
import { ClientServiceStore } from '../src/webapp/client-services';
import { EmpresaStore } from '../src/webapp/empresas';
import { NfseStore } from '../src/webapp/nfse';
import { NfeRecebidaStore } from '../src/webapp/nfe-recebidas';
import { PlatformTemplateStore } from '../src/webapp/platform-templates';
import { ProdutoStore } from '../src/webapp/produtos';
import { WhiteLabelStore } from '../src/webapp/white-label';
import { WebhookStore } from '../src/webapp/webhooks';

async function main() {
  const url = process.env.NFE_DB_URL;
  if (!url) {
    console.error('Faltou NFE_DB_URL. Exemplo:');
    console.error('  NFE_DB_URL="postgres://usuario:senha@host:5432/postgres" npx ts-node scripts/preparar-banco.ts');
    process.exit(1);
  }

  const etapas: [string, () => Promise<unknown>][] = [
    ['notas e numeracao', () => createStorage(url).init()],
    ['empresas emitentes', () => new EmpresaStore(url).init()],
    ['clientes de API', () => new ApiClientStore(url).init()],
    ['chaves de API', () => new ApiKeyStore(url).init()],
    ['servicos contratados', () => new ClientServiceStore(url).init()],
    ['produtos e regras fiscais', () => new ProdutoStore(url).init()],
    ['NFS-e e catalogo de servicos', () => new NfseStore(url).init()],
    ['NF-e recebidas (DF-e)', () => new NfeRecebidaStore(url).init()],
    ['white-label', () => new WhiteLabelStore(url).init()],
    ['modelos de plataforma', () => new PlatformTemplateStore(url).init()],
    ['webhooks', () => new WebhookStore(url).init()],
    ['auditoria', () => new AuditStore(url).init()],
  ];

  for (const [nome, executar] of etapas) {
    process.stdout.write(`  ${nome}... `);
    await executar();
    console.log('ok');
  }

  console.log('\nBanco pronto. Publique a aplicacao e abra o painel.');
  process.exit(0);
}

main().catch((erro) => {
  console.error('\nFalhou:', erro instanceof Error ? erro.message : erro);
  console.error('\nSe for erro de autenticacao, confira se a senha do Postgres tem caractere');
  console.error('especial sem codificar na URL — "@" precisa virar "%40".');
  process.exit(1);
});
