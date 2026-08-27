import { IdempotencyGuard } from '../../src/infrastructure/retry/IdempotencyGuard';

const mockRepository = {
  findByChave: jest.fn(),
} as any;

describe('IdempotencyGuard', () => {
  const guard = new IdempotencyGuard(mockRepository);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return isDuplicate false when NF-e not found', async () => {
    mockRepository.findByChave.mockResolvedValue(null);
    const result = await guard.checkDuplicate('31240512345678000199550010000000011000000019');
    expect(result.isDuplicate).toBe(false);
  });

  test('should return isDuplicate true for AUTORIZADA status', async () => {
    mockRepository.findByChave.mockResolvedValue({
      status: 'AUTORIZADA',
      nprot: '131240000000001',
    });
    const result = await guard.checkDuplicate('31240512345678000199550010000000011000000019');
    expect(result.isDuplicate).toBe(true);
    expect(result.existingStatus).toBe('AUTORIZADA');
    expect(result.existingNProt).toBe('131240000000001');
  });

  test('should return isDuplicate true for CANCELADA status', async () => {
    mockRepository.findByChave.mockResolvedValue({
      status: 'CANCELADA',
      nprot: '131240000000002',
    });
    const result = await guard.checkDuplicate('31240512345678000199550010000000011000000019');
    expect(result.isDuplicate).toBe(true);
    expect(result.existingStatus).toBe('CANCELADA');
  });

  test('should return isDuplicate false for PENDENTE status (allow re-send)', async () => {
    mockRepository.findByChave.mockResolvedValue({
      status: 'PENDENTE',
      nprot: null,
    });
    const result = await guard.checkDuplicate('31240512345678000199550010000000011000000019');
    expect(result.isDuplicate).toBe(false);
  });

  test('should return isDuplicate false for ERRO status (allow retry)', async () => {
    mockRepository.findByChave.mockResolvedValue({
      status: 'ERRO',
      nprot: null,
    });
    const result = await guard.checkDuplicate('31240512345678000199550010000000011000000019');
    expect(result.isDuplicate).toBe(false);
  });

  test('should return isDuplicate true for DENEGADA status', async () => {
    mockRepository.findByChave.mockResolvedValue({
      status: 'DENEGADA',
      nprot: null,
    });
    const result = await guard.checkDuplicate('31240512345678000199550010000000011000000019');
    expect(result.isDuplicate).toBe(true);
    expect(result.existingStatus).toBe('DENEGADA');
  });
});
