import { SignedXml } from 'xml-crypto';
import * as forge from 'node-forge';

/**
 * Typed error for all signer-related failures.
 */
export class SignerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SignerError';
    }
}

export interface CertificateInfo {
    subject: string;
    issuer: string;
    validFrom: Date;
    validTo: Date;
    serialNumber: string;
}

/**
 * Signs NFe XML using XMLDSig with a PKCS12 (PFX) certificate.
 *
 * Implements the enveloped signature pattern required by SEFAZ NF-e 4.00:
 * - Canonicalization: C14N 1.0
 * - Signature algorithm: RSA-SHA1
 * - Digest algorithm: SHA1
 * - Key info: X509Certificate (base64, no headers/newlines)
 */
export class Signer {
    private privateKeyPem: string;
    private certificatePem: string;
    private certificateBase64: string;
    private cert: forge.pki.Certificate;

    constructor(pfxBuffer: Buffer, password: string) {
        let p12Asn1: forge.asn1.Asn1;
        try {
            p12Asn1 = forge.asn1.fromDer(
                forge.util.createBuffer(pfxBuffer.toString('binary'))
            );
        } catch {
            throw new SignerError('Failed to parse PFX: invalid or corrupted binary structure.');
        }

        let p12: forge.pkcs12.Pkcs12Pfx;
        try {
            p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
        } catch {
            throw new SignerError('Failed to decrypt PFX: invalid password.');
        }

        let certFound: forge.pki.Certificate | null = null;
        let keyFound: forge.pki.PrivateKey | null = null;

        for (const safeContents of p12.safeContents) {
            for (const safeBag of safeContents.safeBags) {
                if (safeBag.cert && !certFound) {
                    certFound = safeBag.cert;
                }
                if (safeBag.key && !keyFound) {
                    keyFound = safeBag.key as forge.pki.PrivateKey;
                }
            }
        }

        if (!certFound) {
            throw new SignerError('No certificate found in PFX.');
        }
        if (!keyFound) {
            throw new SignerError('No private key found in PFX.');
        }

        // Validate certificate dates
        const now = new Date();
        if (certFound.validity.notAfter < now) {
            throw new SignerError('Certificate has expired.');
        }
        if (certFound.validity.notBefore > now) {
            throw new SignerError('Certificate is not yet valid.');
        }

        this.cert = certFound;
        this.certificatePem = forge.pki.certificateToPem(certFound);
        this.privateKeyPem = forge.pki.privateKeyToPem(keyFound);

        // Pre-compute the base64 certificate (no PEM headers, no newlines)
        this.certificateBase64 = this.certificatePem
            .replace(/-----BEGIN CERTIFICATE-----/g, '')
            .replace(/-----END CERTIFICATE-----/g, '')
            .replace(/\r?\n/g, '');
    }

    /**
     * Signs the NFe XML with an enveloped XMLDSig signature.
     *
     * The <Signature> element is inserted after </infNFe> inside <NFe>,
     * following the SEFAZ NF-e 4.00 specification.
     *
     * @param xml - The unsigned NFe XML string
     * @param referenceUri - The Id attribute value (e.g., "NFe3524051234...")
     * @returns Signed XML string
     */
    sign(xml: string, referenceUri: string): string {
        const sig = new SignedXml();

        // Configure canonicalization and signature algorithm
        sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
        sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';

        // Add reference with enveloped-signature + c14n transforms
        sig.addReference(
            `//*[@Id='${referenceUri}']`,
            [
                'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
                'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
            ],
            'http://www.w3.org/2000/09/xmldsig#sha1',
            `#${referenceUri}`,
            undefined,
            undefined,
            false,
        );

        // Set signing key
        sig.signingKey = this.privateKeyPem;

        // Configure KeyInfo with X509 certificate
        const certBase64 = this.certificateBase64;
        const certPem = this.certificatePem;
        sig.keyInfoProvider = {
            getKeyInfo(_key?: string, _prefix?: string): string {
                const pfx = _prefix ? `${_prefix}:` : '';
                return `<${pfx}X509Data><${pfx}X509Certificate>${certBase64}</${pfx}X509Certificate></${pfx}X509Data>`;
            },
            getKey(_keyInfo?: Node[] | null): Buffer {
                return Buffer.from(certPem);
            },
        } as any;

        // Compute signature, placing it right after the SIGNED element (o mesmo do referenceUri):
        // infNFe na NF-e, infEvento no cancelamento/CC-e, infInut na inutilização.
        try {
            sig.computeSignature(xml, {
                location: {
                    reference: `//*[@Id='${referenceUri}']`,
                    action: 'after',
                },
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            throw new SignerError(`Signature computation failed: ${message}`);
        }

        let signedXml = sig.getSignedXml();

        // Fix the Reference URI: xml-crypto may emit an empty URI; replace with the correct one
        signedXml = signedXml.replace(
            '<Reference URI="">',
            `<Reference URI="#${referenceUri}">`
        );

        return signedXml;
    }

    /**
     * Returns information about the loaded certificate.
     */
    getCertificateInfo(): CertificateInfo {
        const subjectAttrs = this.cert.subject.attributes
            .map((attr: any) => `${attr.shortName || attr.type}=${attr.value}`)
            .join(', ');

        const issuerAttrs = this.cert.issuer.attributes
            .map((attr: any) => `${attr.shortName || attr.type}=${attr.value}`)
            .join(', ');

        return {
            subject: subjectAttrs,
            issuer: issuerAttrs,
            validFrom: this.cert.validity.notBefore,
            validTo: this.cert.validity.notAfter,
            serialNumber: this.cert.serialNumber,
        };
    }
}
