/**
 * Identidade e canais oficiais do lançamento comercial.
 *
 * Preencher somente depois da revisão jurídica e da definição dos canais.
 * Enquanto `LAUNCH_INFO` for `null`, as páginas legais e a landing mantêm o
 * aviso de documento preliminar e não fazem afirmação de lançamento.
 */
export interface LaunchInfo {
  /** Razão social ou nome empresarial que opera o PedeOutra. */
  legalName: string
  /** CNPJ ou CPF, com ou sem formatação. */
  taxId: string
  /** Endereço comercial completo; omitido quando vazio. */
  address?: string
  /** Canal oficial de suporte. */
  supportEmail: string
  /** Canal oficial de privacidade e titulares de dados. */
  privacyEmail: string
  /** Data da última revisão jurídica, no formato DD/MM/AAAA. */
  updatedAt: string
  /** Revisão jurídica humana concluída? */
  legalReview: 'pending' | 'approved'
}

export const LAUNCH_INFO: LaunchInfo | null = {
  legalName: 'PedeOutra',
  taxId: '30.317.383/0001-97',
  supportEmail: 'suporte@pedeoutra.com.br',
  privacyEmail: 'admin@pedeoutra.com.br',
  updatedAt: '18/11/2026',
  legalReview: 'pending',
}

export function taxIdLabel(value: string): 'CNPJ' | 'CPF' | 'Documento' {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 14) return 'CNPJ'
  if (digits.length === 11) return 'CPF'
  return 'Documento'
}

export function formatTaxId(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  }
  return value.trim()
}

/** Identificação usada nos documentos, sem endereço quando ele foi omitido. */
export function launchIdentity(info: LaunchInfo): string {
  const identity = `${info.legalName}, ${taxIdLabel(info.taxId)} ${formatTaxId(info.taxId)}`
  const address = info.address?.trim()
  return address ? `${identity}, com endereço em ${address}` : identity
}
