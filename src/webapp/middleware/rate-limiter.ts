import { Pool } from 'pg';
import type { Request, Response, NextFunction } from 'express';
import { errorResponse } from './errors';

interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerDay: number;
  emissionsPerMonth: number;
}

/**
 * Derivado de `planos.ts`, que e a fonte unica.
 *
 * Esta tabela existia em paralelo com a do billing e as duas discordavam: um
 * cliente `business` tinha 60 req/min aqui e caia no limite do gratuito la, 10
 * notas por mes. Derivar de um lugar so faz a contradicao ser impossivel.
 */
import { PLANOS, planoDe } from '../planos';

export const PLAN_LIMITS: Record<string, RateLimitConfig> = Object.fromEntries(
  PLANOS.map(p => [p.id, {
    requestsPerMinute: p.requestsPerMinute,
    requestsPerDay: p.requestsPerDay,
    emissionsPerMonth: p.limitePorServico,
  }]),
);

import { contar, contarNaMemoria } from './contador-compartilhado';

/**
 * O limitador conta no Postgres quando ha banco, e na memoria quando nao ha.
 *
 * Contar em memoria dava a cada instancia o seu proprio contador: em serverless
 * o teto efetivo era o do plano MULTIPLICADO pelo numero de instancias vivas, e
 * variava com o trafego. O cliente furava o limite justamente no pico, que e
 * quando o limite existe para proteger.
 *
 * A ida ao banco custa ~20 ms numa requisicao que espera SEGUNDOS pela SEFAZ.
 */
export function createRateLimiter(pool?: Pool) {
  const janela = (chave: string, ms: number) =>
    (pool ? contar(pool, chave, ms) : Promise.resolve(contarNaMemoria(chave, ms)));

  return async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const tenantCnpj = (req as any).tenantCnpj as string | undefined;
    const isAdmin = (req as any).isAdmin as boolean;
    if (isAdmin && !tenantCnpj) { next(); return; }

    const identifier = tenantCnpj || req.ip || 'unknown';
    const plano = (req as any).clientPlano as string || 'free';
    // `planoDe` resolve nome antigo para o novo e nunca devolve indefinido.
    const p = planoDe(plano);
    const limits: RateLimitConfig = {
      requestsPerMinute: p.requestsPerMinute,
      requestsPerDay: p.requestsPerDay,
      emissionsPerMonth: p.limitePorServico,
    };

    if (limits.requestsPerMinute > 0) {
      const minuteKey = `rpm:${identifier}`;
      const minute = await janela(minuteKey, 60_000);
      const remaining = Math.max(0, limits.requestsPerMinute - minute.contador);
      const resetSec = Math.max(1, Math.ceil((minute.resetEm - Date.now()) / 1000));

      res.setHeader('X-RateLimit-Limit', String(limits.requestsPerMinute));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Reset', String(resetSec));

      if (minute.contador > limits.requestsPerMinute) {
        res.setHeader('Retry-After', String(resetSec));
        errorResponse(
          res,
          'RATE_LIMIT_EXCEEDED',
          { limit: limits.requestsPerMinute, window: '1 minuto', retryAfter: resetSec, plano: p.nome },
          // "Tente novamente em breve" não diz nada: o operador fica clicando e
          // renovando o bloqueio. Com o segundo exato ele espera e volta.
          `Limite de ${limits.requestsPerMinute} requisicoes por minuto do plano `
          + `${p.nome} atingido. Tente de novo em ${resetSec}s.`,
        );
        return;
      }
    }

    if (limits.requestsPerDay > 0) {
      const dayKey = `rpd:${identifier}`;
      const day = await janela(dayKey, 86_400_000);
      if (day.contador > limits.requestsPerDay) {
        errorResponse(res, 'RATE_LIMIT_EXCEEDED', {
          limit: limits.requestsPerDay,
          window: '24 horas',
        });
        return;
      }
    }

    next();
  };
}

// A limpeza das janelas vencidas passou para o cron (`limparVencidas`), junto do
// reprocessamento de webhooks. Aqui havia um `setInterval`: em serverless ele
// morre com a invocacao e nunca chega a rodar, e sem `unref` ainda segurava o
// event loop — bastava importar este modulo para o Jest travar depois do ultimo
// teste. Timer periodico nao existe neste ambiente; o que existe e cron.
