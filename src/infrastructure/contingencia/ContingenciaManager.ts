import { TipoEmissao } from '../../domain/models';
import { SefazEndpointMap, getEndpoints } from '../soap/SefazEndpoints';
import { getSvcEndpoints, getSvcType } from './SvcEndpoints';

export interface ContingenciaState {
  ativa: boolean;
  motivo: string;
  tpEmis: TipoEmissao;
  dhContingencia: string;
}

export interface ContingenciaConfig {
  uf: string;
  ambiente: '1' | '2';
}

export class ContingenciaManager {
  private state: ContingenciaState = {
    ativa: false,
    motivo: '',
    tpEmis: TipoEmissao.NORMAL,
    dhContingencia: '',
  };

  private readonly config: ContingenciaConfig;

  constructor(config: ContingenciaConfig) {
    this.config = config;
  }

  ativarSvc(motivo: string, dhContingencia: string): void {
    if (!motivo || motivo.length < 15) {
      throw new Error('Motivo da contingencia deve ter no minimo 15 caracteres');
    }

    const svcType = getSvcType(this.config.uf);
    const tpEmis = svcType === 'SVC_AN'
      ? TipoEmissao.CONTINGENCIA_SVC_AN
      : TipoEmissao.CONTINGENCIA_SVC_RS;

    this.state = {
      ativa: true,
      motivo,
      tpEmis,
      dhContingencia,
    };
  }

  desativar(): void {
    this.state = {
      ativa: false,
      motivo: '',
      tpEmis: TipoEmissao.NORMAL,
      dhContingencia: '',
    };
  }

  getState(): ContingenciaState {
    return { ...this.state };
  }

  isAtiva(): boolean {
    return this.state.ativa;
  }

  resolveEndpoints(): SefazEndpointMap {
    if (!this.state.ativa) {
      return getEndpoints(this.config.uf, this.config.ambiente);
    }

    if (
      this.state.tpEmis === TipoEmissao.CONTINGENCIA_SVC_AN ||
      this.state.tpEmis === TipoEmissao.CONTINGENCIA_SVC_RS
    ) {
      return getSvcEndpoints(this.config.uf, this.config.ambiente);
    }

    throw new Error(`Tipo de emissao em contingencia nao suportado: ${this.state.tpEmis}`);
  }

  resolveTpEmis(): TipoEmissao {
    return this.state.tpEmis;
  }
}
