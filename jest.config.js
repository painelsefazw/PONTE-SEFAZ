module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\.ts$': 'ts-jest' },
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],

  // O padrão do Jest é 5 s por teste, e isso vinha reprovando testes CORRETOS.
  //
  // Quatro suítes validam XML contra o XSD oficial com `xmllint-wasm`. Rodando
  // sozinha, cada validação leva ~150 ms; com as suítes em paralelo disputando
  // CPU, a mesma validação passa dos 5 s e o Jest chama de falha. O sintoma era
  // sempre o mesmo: `GruposIcms` vermelha na suíte completa e verde quando
  // rodada sozinha — três sessões perderam tempo investigando isso como se
  // fosse regressão.
  //
  // 30 s é folga para o pior caso e continua pegando teste travado de verdade,
  // só que um pouco mais tarde. Tempo de relógio numa máquina compartilhada
  // nunca foi sinal de correção.
  testTimeout: 30_000,

  // A maquina tem 16 nucleos e 8 GB. O Jest abre `nucleos - 1` workers por
  // padrao — 15 processos, cada um com ts-jest, o app inteiro e, em quatro
  // suites, o WASM do xmllint. Nao cabe: a maquina passa a paginar, tudo fica
  // dez vezes mais lento, e testes CORRETOS estouram o tempo.
  //
  // O sintoma classico disso e o aviso "A worker process has failed to exit
  // gracefully", que parecia vazamento de teste e era pressao de memoria.
  //
  // O gargalo aqui e RAM, nao CPU: quatro workers cabem com folga e a suite
  // fica previsivel. `workerIdleMemoryLimit` recicla o worker que incha em vez
  // de deixar a memoria crescer ate o fim da rodada.
  maxWorkers: 4,
  workerIdleMemoryLimit: '512MB',
};
