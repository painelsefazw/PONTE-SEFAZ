import { SoapClient } from '../../src/infrastructure/soap/SoapClient';

/**
 * A DistribuicaoDFe exige a SOAPAction COMPLETA. As outras nao.
 *
 * As SEFAZ estaduais ignoram o parametro `action` do Content-Type — mandar so
 * `NfeAutorizacao` sempre funcionou, e por isso ninguem notou que o valor
 * estava incompleto.
 *
 * A DistribuicaoDFe nao roda numa SEFAZ estadual: ela vive no Ambiente
 * Nacional, que e um `.asmx` e CONFERE a acao. Com o nome curto ele responde
 *
 *     Unable to handle request. The action 'NFeDistribuicaoDFe'
 *     was not recognized.
 *
 * — um SOAP Fault com cara de servico fora do ar, quando o problema esta no
 * cabecalho da propria requisicao. O radar de compras ficava vazio por isso.
 */

/**
 * Os metodos sao exercitados no prototipo, sem construir o cliente.
 *
 * O construtor abre o PFX de verdade — montar um so para ler um cabecalho
 * exigiria um certificado no repositorio, que e a ultima coisa que se põe num
 * teste. Nenhum dos dois metodos toca estado da instancia: eles so conversam
 * entre si.
 */
const proto = SoapClient.prototype as any;
const cliente = Object.create(proto) as SoapClient;

function acaoDe(_c: SoapClient, servico: string): string {
  return proto.resolveSoapAction.call(cliente, servico);
}

describe('SOAPAction da distribuicao', () => {
  test('a distribuicao ganha namespace + operacao', () => {
    expect(acaoDe(cliente, 'NFeDistribuicaoDFe'))
      .toBe('http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse');
  });

  test('o nome curto sozinho nao e mais enviado', () => {
    // Era exatamente este valor que o Ambiente Nacional recusava.
    expect(acaoDe(cliente, 'NFeDistribuicaoDFe')).not.toBe('NFeDistribuicaoDFe');
  });

  test('os outros servicos continuam como estavam', () => {
    // Conservador de proposito: trocar a acao deles mexeria na emissao de todo
    // cliente para corrigir algo que hoje nao falha. Essa troca precisa ser
    // provada contra cada SEFAZ, nao deduzida a partir desta.
    for (const s of ['NfeAutorizacao', 'NFeRecepcaoEvento', 'NfeStatusServico',
      'NfeConsultaProtocolo', 'NfeInutilizacao', 'CadConsultaCadastro4']) {
      expect(acaoDe(cliente, s)).toBe(s);
    }
  });

  test('o corpo vem envolvido no elemento da operacao', () => {
    // Este teste ja disse o contrario — "a acao mudou; o corpo nao" —, e a
    // frase estava errada. Corrigir so a acao levou a SEFAZ a aceitar a
    // requisicao e entao responder
    //
    //     Server was unable to process request.
    //     ---> Object reference not set to an instance of an object.
    //
    // que e um NullReferenceException do .NET vazando como SOAP Fault: com a
    // mensagem solta no corpo, o servico procura o parametro da operacao, nao
    // acha, e estoura. A cautela de mudar uma coisa de cada vez estava certa —
    // errada estava a conclusao de que a segunda mudanca era desnecessaria.
    const envelope = proto.buildEnvelope.call(cliente, '<x/>', 'NFeDistribuicaoDFe') as string;
    expect(envelope).toContain(
      '<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">');
    expect(envelope).toContain('<nfeDadosMsg>');
    // A mensagem fica DENTRO da operacao, nao ao lado dela.
    expect(envelope.indexOf('<nfeDistDFeInteresse'))
      .toBeLessThan(envelope.indexOf('<nfeDadosMsg>'));
  });

  test('o corpo dos servicos estaduais continua sem envelope de operacao', () => {
    // Eles declaram a mensagem direto no corpo. Envolver mudaria a emissao de
    // todo cliente para consertar algo que hoje funciona.
    const envelope = proto.buildEnvelope.call(cliente, '<enviNFe/>', 'NfeAutorizacao') as string;
    expect(envelope).toContain(
      '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">');
    expect(envelope).not.toContain('nfeDistDFeInteresse');
  });
});
