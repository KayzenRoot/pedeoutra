import { describe, expect, it } from 'vitest'
import { formatTaxId, launchIdentity, taxIdLabel } from './launch-info'

describe('identificação fiscal do lançamento', () => {
  it('rotula e formata CNPJ', () => {
    expect(taxIdLabel('32140158000180')).toBe('CNPJ')
    expect(formatTaxId('32140158000180')).toBe('32.140.158/0001-80')
    expect(taxIdLabel('32.140.158/0001-80')).toBe('CNPJ')
  })

  it('rotula e formata CPF', () => {
    expect(taxIdLabel('32140115880')).toBe('CPF')
    expect(formatTaxId('321.401.158-80')).toBe('321.401.158-80')
  })

  it('mantém valor desconhecido como Documento', () => {
    expect(taxIdLabel('123')).toBe('Documento')
    expect(formatTaxId('123')).toBe('123')
  })

  it('omite o endereço quando ele não foi definido', () => {
    expect(
      launchIdentity({
        legalName: 'PedeOutra',
        taxId: '32140158000180',
        supportEmail: 'suporte@pedeoutra.com.br',
        privacyEmail: 'admin@pedeoutra.com.br',
        updatedAt: '18/11/2026',
        legalReview: 'pending',
      }),
    ).toBe('PedeOutra, CNPJ 32.140.158/0001-80')
  })

  it('inclui o endereço quando ele existe', () => {
    expect(
      launchIdentity({
        legalName: 'PedeOutra',
        taxId: '32140158000180',
        address: 'Rua Exemplo, 1, São Paulo/SP',
        supportEmail: 'suporte@pedeoutra.com.br',
        privacyEmail: 'admin@pedeoutra.com.br',
        updatedAt: '18/11/2026',
        legalReview: 'pending',
      }),
    ).toBe('PedeOutra, CNPJ 32.140.158/0001-80, com endereço em Rua Exemplo, 1, São Paulo/SP')
  })
})
