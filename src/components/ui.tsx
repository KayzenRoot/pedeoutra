import { useState, type ReactNode } from 'react'
import { copyText } from '../lib/format'

export function LoadingScreen({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function BackendNotice() {
  return (
    <div className="backend-notice">
      <div className="backend-card">
        <span className="eyebrow">Configuração necessária</span>
        <h1>Backend ainda não conectado</h1>
        <p>
          Esta instalação está em modo demonstração. Para usar cadastro, catálogo e painel,
          configure as variáveis públicas do Supabase e publique as Edge Functions.
        </p>
        <pre>
          <code>{`VITE_SUPABASE_URL=https://<projeto>.supabase.co\nVITE_SUPABASE_ANON_KEY=<chave anon>`}</code>
        </pre>
        <p className="muted">
          As chaves de serviço, Asaas e webhook ficam apenas no servidor. Nunca coloque
          `service_role` no frontend.
        </p>
        <a className="button button-primary" href="/demo">
          Ver demonstração
        </a>
      </div>
    </div>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    new: 'Novo',
    confirmed: 'Confirmado',
    completed: 'Concluído',
    canceled: 'Cancelado',
  }
  return <span className={`badge badge-${status}`}>{labels[status] ?? status}</span>
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        ✦
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function FormMessage({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'success' | 'info'
  children: ReactNode
}) {
  return (
    <div className={`form-message form-message-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

export function CopyButton({
  value,
  label = 'Copiar link',
  className = 'button button-secondary',
}: {
  value: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    const ok = await copyText(value)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    }
  }

  return (
    <button type="button" className={className} onClick={() => void handleCopy()}>
      {copied ? 'Copiado!' : label}
    </button>
  )
}

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 999,
  step = 1,
  label,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  label: string
}) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - step))}
        disabled={value <= min}
        aria-label={`Diminuir ${label}`}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (!Number.isFinite(next)) return
          const safeStep = Math.max(1, step)
          const steps = Math.max(0, Math.round((next - min) / safeStep))
          onChange(Math.min(max, min + steps * safeStep))
        }}
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + step))}
        disabled={value >= max}
        aria-label={`Aumentar ${label}`}
      >
        +
      </button>
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-header-action">{action}</div>}
    </header>
  )
}

export function Icon({
  name,
  className = '',
}: {
  name:
    | 'home'
    | 'orders'
    | 'products'
    | 'customers'
    | 'prices'
    | 'quotes'
    | 'team'
    | 'billing'
    | 'settings'
    | 'external'
    | 'check'
  className?: string
}) {
  const paths: Record<typeof name, ReactNode> = {
    home: <path d="M3 10.5 12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-4.5v-6h-6v6H4.5A1.5 1.5 0 0 1 3 19.5z" />,
    orders: (
      <>
        <path d="M5 3h14v18l-7-4-7 4z" />
        <path d="M8 8h8M8 12h5" />
      </>
    ),
    products: (
      <>
        <path d="m12 2 9 5v10l-9 5-9-5V7z" />
        <path d="M3 7l9 5 9-5M12 12v10" />
      </>
    ),
    customers: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 21a6.5 6.5 0 0 1 13 0M16 5.5a3 3 0 0 1 0 5.8M18 21a5.5 5.5 0 0 0-3-4.9" />
      </>
    ),
    prices: (
      <>
        <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
        <circle cx="7.5" cy="7.5" r="1.2" />
      </>
    ),
    quotes: (
      <>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M15 3v5h4M9 12h6M9 16h4" />
      </>
    ),
    team: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5.8M18 21a5.5 5.5 0 0 0-3-4.9" />
      </>
    ),
    billing: (
      <>
        <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
        <path d="M2.5 10h19M6 15h4" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.23.6.8 1 1.45 1H21a2 2 0 1 1 0 4h-.09c-.65 0-1.22.4-1.45 1z" />
      </>
    ),
    external: <path d="M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />,
    check: <path d="m4 12 5 5L20 6" />,
  }

  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
