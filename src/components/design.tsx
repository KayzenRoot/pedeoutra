import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './ui'

/**
 * Componentes visuais reutilizáveis (#81). Sem lógica de negócio e sem
 * dependências novas; o fallback é sempre conteúdo estático legível.
 */

export function SectionHeading({
  eyebrow,
  title,
  description,
  id,
}: Readonly<{
  eyebrow: string
  title: string
  description?: string
  id?: string
}>) {
  return (
    <div className="section-heading" id={id}>
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  )
}

export function GlassCard({
  children,
  className = '',
}: Readonly<{
  children: ReactNode
  className?: string
}>) {
  return <div className={`glass-card ${className}`.trim()}>{children}</div>
}

export function StatCard({
  label,
  value,
  detail,
  accent = false,
  children,
}: Readonly<{
  label: string
  value: ReactNode
  detail?: ReactNode
  accent?: boolean
  children?: ReactNode
}>) {
  return (
    <article className={accent ? 'stat-card stat-card-accent' : 'stat-card'}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small className="cell-sub">{detail}</small>}
      {children}
    </article>
  )
}

export function FeatureCard({
  badge,
  badgeTone = '',
  title,
  items,
}: Readonly<{
  badge: string
  badgeTone?: string
  title: string
  items: string[]
}>) {
  return (
    <article className="feature-card">
      <span className={`pill ${badgeTone}`.trim()}>{badge}</span>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <Icon name="check" /> {item}
          </li>
        ))}
      </ul>
    </article>
  )
}

export function PricingCard({
  children,
  professional = false,
}: Readonly<{
  children: ReactNode
  professional?: boolean
}>) {
  return (
    <article className={professional ? 'price-card price-card-pro' : 'price-card'}>
      {children}
    </article>
  )
}

export function IconButton({
  label,
  onClick,
  children,
  className = '',
}: Readonly<{
  label: string
  onClick: () => void
  children: ReactNode
  className?: string
}>) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`.trim()}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function finePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  )
}

/**
 * Tilt 3D sutil (máx. 4°) apenas em ponteiro fino. Teclado, toque e
 * `prefers-reduced-motion` não recebem transform. O conteúdo continua no DOM
 * e focável; a animação é só composição visual.
 */
export function TiltCard({
  children,
  className = '',
}: Readonly<{
  children: ReactNode
  className?: string
}>) {
  const ref = useRef<HTMLDivElement>(null)

  function reset() {
    const node = ref.current
    if (!node) return
    node.style.setProperty('--tilt-x', '0deg')
    node.style.setProperty('--tilt-y', '0deg')
  }

  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (reducedMotion() || !finePointer()) return
    const node = ref.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const x = (event.clientX - rect.left) / rect.width - 0.5
    const y = (event.clientY - rect.top) / rect.height - 0.5
    node.style.setProperty('--tilt-x', `${(-y * 4).toFixed(2)}deg`)
    node.style.setProperty('--tilt-y', `${(x * 4).toFixed(2)}deg`)
  }

  return (
    <div
      ref={ref}
      className={`tilt-wrap ${className}`.trim()}
      onPointerMove={move}
      onPointerLeave={reset}
      onPointerCancel={reset}
    >
      {children}
    </div>
  )
}

/**
 * Entrada suave ao entrar na viewport. O conteúdo já nasce visível; a classe
 * apenas adiciona uma animação curta. Sem IntersectionObserver, sem JS ou com
 * reduced motion, nada é escondido.
 */
export function Reveal({
  children,
  className = '',
  delay = 0,
}: Readonly<{
  children: ReactNode
  className?: string
  delay?: number
}>) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node || reducedMotion() || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -32px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? 'reveal-visible' : ''} ${className}`.trim()}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  )
}
