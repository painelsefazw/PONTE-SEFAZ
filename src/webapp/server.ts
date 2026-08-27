import { app } from './app';
import { loadConfig } from '../config';

const PORT = Number(process.env['WEBAPP_PORT'] || process.env['PORT'] || '3000');

app.listen(PORT, () => {
  try {
    const config = loadConfig();
    const amb = config.ambiente === '1' ? 'PRODUCAO' : 'HOMOLOGACAO';
    console.log(`NF-e Engine rodando em http://localhost:${PORT} [${amb}]`);
    console.log(`Emitente: ${config.razaoSocial} (${config.cnpjEmitente}) — ${config.uf}`);
  } catch (e: any) {
    console.log(`NF-e Engine rodando em http://localhost:${PORT} [NAO CONFIGURADO]`);
    console.log(`Configure o .env: ${e.message}`);
  }
});
