import { NFeRepository } from '../db/NFeRepository';
import { NFeStatus } from '../db/migrations';

export class IdempotencyGuard {
  constructor(private repository: NFeRepository) {}

  async checkDuplicate(chaveAcesso: string): Promise<{ isDuplicate: boolean; existingStatus?: string; existingNProt?: string }> {
    const existing = await this.repository.findByChave(chaveAcesso);

    if (!existing) {
      return { isDuplicate: false };
    }

    if (existing.status === NFeStatus.AUTORIZADA || existing.status === NFeStatus.DENEGADA) {
      return {
        isDuplicate: true,
        existingStatus: existing.status,
        existingNProt: existing.nprot || undefined,
      };
    }

    if (existing.status === NFeStatus.CANCELADA) {
      return {
        isDuplicate: true,
        existingStatus: existing.status,
        existingNProt: existing.nprot || undefined,
      };
    }

    return { isDuplicate: false };
  }
}
