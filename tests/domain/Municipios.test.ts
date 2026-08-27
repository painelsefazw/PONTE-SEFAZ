import {
  municipioPorCodigo, municipioUf, ufDoCodigo, totalMunicipios,
} from '../../src/domain/ibge';
import { UF_POR_CODIGO } from '../../src/domain/ibge/municipios';

describe('tabela de municípios do IBGE', () => {
  test('carrega os 5.571 municípios e as 27 UFs', () => {
    expect(totalMunicipios()).toBe(5571);
    expect(Object.keys(UF_POR_CODIGO)).toHaveLength(27);
  });

  test('resolve o município da nota real', () => {
    expect(municipioPorCodigo('3530607'))
      .toEqual({ codigo: '3530607', nome: 'Mogi das Cruzes', uf: 'SP' });
  });

  test('resolve capitais de regiões diferentes', () => {
    expect(municipioPorCodigo('3550308')).toMatchObject({ nome: 'São Paulo', uf: 'SP' });
    expect(municipioPorCodigo('3304557')).toMatchObject({ nome: 'Rio de Janeiro', uf: 'RJ' });
    expect(municipioPorCodigo('5300108')).toMatchObject({ nome: 'Brasília', uf: 'DF' });
    expect(municipioPorCodigo('1302603')).toMatchObject({ nome: 'Manaus', uf: 'AM' });
    expect(municipioPorCodigo('2304400')).toMatchObject({ nome: 'Fortaleza', uf: 'CE' });
  });

  test('preserva acento e caixa do nome oficial', () => {
    expect(municipioPorCodigo('4106902')?.nome).toBe('Curitiba');
    expect(municipioPorCodigo('3170206')?.nome).toBe('Uberlândia');
    // Preposição em minúscula é como o IBGE grafa.
    expect(municipioPorCodigo('3530607')?.nome).toBe('Mogi das Cruzes');
  });

  test('a UF sai dos dois primeiros dígitos do código', () => {
    expect(ufDoCodigo('3530607')).toBe('SP');
    expect(ufDoCodigo('4314902')).toBe('RS');
    expect(ufDoCodigo('123')).toBeUndefined();
  });

  test('aceita código pontuado e ignora o que não for dígito', () => {
    expect(municipioPorCodigo('3.530.607')?.nome).toBe('Mogi das Cruzes');
  });

  describe('código desconhecido', () => {
    test('não inventa município', () => {
      expect(municipioPorCodigo('9999999')).toBeUndefined();
      expect(municipioPorCodigo('')).toBeUndefined();
      expect(municipioPorCodigo(undefined)).toBeUndefined();
    });

    test('municipioUf devolve o que existir em vez de nada', () => {
      // Dado incompleto e verdadeiro vale mais que campo vazio.
      expect(municipioUf('9999999', 'SP')).toBe('9999999 / SP');
      expect(municipioUf(undefined, undefined)).toBeUndefined();
    });
  });

  test('municipioUf entrega o formato que a NT pede', () => {
    expect(municipioUf('3530607')).toBe('Mogi das Cruzes / SP');
    // A UF informada no XML não sobrepõe a da tabela: a do IBGE é a oficial.
    expect(municipioUf('3530607', 'RJ')).toBe('Mogi das Cruzes / SP');
  });

  test('todo código da tabela tem UF derivável', () => {
    const semUf: string[] = [];
    for (const linha of require('../../src/domain/ibge/municipios').TABELA_MUNICIPIOS.split('\n')) {
      const codigo = linha.slice(0, linha.indexOf(' '));
      if (!ufDoCodigo(codigo)) semUf.push(codigo);
    }
    expect(semUf).toEqual([]);
  });

  test('todo código tem 7 dígitos e não há repetido', () => {
    const codigos: string[] = require('../../src/domain/ibge/municipios').TABELA_MUNICIPIOS
      .split('\n').map((l: string) => l.slice(0, l.indexOf(' ')));
    expect(codigos.filter(c => !/^\d{7}$/.test(c))).toEqual([]);
    expect(new Set(codigos).size).toBe(codigos.length);
  });
});
