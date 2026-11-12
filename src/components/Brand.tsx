import { Link } from 'react-router-dom'

export function Brand({ to = '/', compact = false }: { to?: string; compact?: boolean }) {
  return (
    <Link to={to} className="brand" aria-label="PedeOutra — início">
      <span className="brand-mark" aria-hidden="true">
        <span>↻</span>
      </span>
      {!compact && (
        <span className="brand-text">
          <strong>PedeOutra</strong>
          <small>pediu uma vez? pede outra!</small>
        </span>
      )}
    </Link>
  )
}
