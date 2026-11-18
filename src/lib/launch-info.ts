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
  /** CNPJ ou identificação fiscal equivalente. */
  taxId: string
  /** Endereço comercial completo. */
  address: string
  /** Canal oficial de suporte. */
  supportEmail: string
  /** Canal oficial de privacidade e titulares de dados. */
  privacyEmail: string
  /** Data da última revisão jurídica, no formato DD/MM/AAAA. */
  updatedAt: string
}

export const LAUNCH_INFO: LaunchInfo | null = null
