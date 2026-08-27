import * as fs from 'fs';
import * as path from 'path';
import { discoEstaAtrasado } from '../../src/webapp/kit-instancia';

const appTs = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'webapp', 'app.ts'), 'utf8');

/**
 * O servidor RODA a partir de um bundle compilado e EMPACOTA a partir do disco.
 *
 * Numa plataforma que reaproveita cache de build os dois divergem: a funcao e
 * recompilada do codigo novo e as copias de arquivo continuam as antigas. O
 * estrago e silencioso e convincente — commit novo, contagem de arquivos certa,
 * publicacao respondendo sucesso, e a instancia nascendo com o codigo de dias
 * antes. Custou quatro publicacoes seguidas antes de alguem comparar byte a
 * byte o que tinha ido parar no repositorio.
 */
describe('disco atrasado', () => {
  test('rodando na propria maquina, o disco esta em dia', () => {
    // Aqui o processo le os mesmos arquivos que a suite ve. Se este teste
    // falhar, a marca procurada saiu do `app.ts` — e a guarda passou a recusar
    // publicacao valida.
    expect(discoEstaAtrasado('/api/diagnostico/pacote')).toBe(false);
  });

  test('marca que nao existe no disco acusa atraso', () => {
    expect(discoEstaAtrasado('rota-que-nunca-existiu-em-lugar-nenhum')).toBe(true);
  });

  test('a marca usada e auto-referente, e nao um nome escolhido a dedo', () => {
    // A primeira versao procurava `modoDoPainel` e passou a aprovar disco velho
    // tres commits depois: o disco TINHA aquele commit e nao os seguintes.
    // Procurar o caminho da propria rota de diagnostico resolve por construcao:
    // se o processo responde nela, o codigo dele contem essa linha.
    expect(appTs).toContain("discoEstaAtrasado('/api/diagnostico/pacote')");
    expect(appTs).toContain("app.get('/api/diagnostico/pacote'");
  });

  test('a publicacao da instancia recusa antes de montar o pacote', () => {
    // Recusar depois de montar seria tarde: o commit ja teria saido.
    const rota = appTs.slice(appTs.indexOf("app.post('/api/admin/instancia/publicar'"));
    const guarda = rota.indexOf('discoEstaAtrasado');
    const monta = rota.indexOf('montarKitDaInstancia');
    expect(guarda).toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(monta);
  });

  test('a recusa diz o que fazer, e nao so que falhou', () => {
    const rota = appTs.slice(appTs.indexOf("app.post('/api/admin/instancia/publicar'"));
    const trecho = rota.slice(rota.indexOf('discoEstaAtrasado'), rota.indexOf('discoEstaAtrasado') + 1200);
    expect(trecho).toMatch(/Build Cache|VERCEL_FORCE_NO_BUILD_CACHE/);
    expect(trecho).toContain('503');
  });
});
