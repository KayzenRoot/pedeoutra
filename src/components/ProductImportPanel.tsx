import { useState } from 'react'
import { callAuthedFunction, EdgeFunctionError } from '../lib/edge'
import { formatBRL } from '../lib/format'
import {
  MAX_IMPORT_ROWS,
  importTemplateCsv,
  parseImportFile,
  type ImportRowInput,
} from '../lib/import'
import { FormMessage } from './ui'

interface ImportPlanRow {
  line: number
  action: 'create' | 'update' | 'ignore' | 'error'
  error: string | null
  name: string
  sku: string | null
  category: string | null
  category_new: boolean
  unit: string
  price_cents: number | null
  active: boolean
  min_quantity: number
  quantity_increment: number
  product_id: string | null
}

interface DryRunResponse {
  mode: 'dry_run'
  job_id: string | null
  rows: ImportPlanRow[]
  summary: {
    total: number
    creates: number
    updates: number
    ignores: number
    errors: number
  }
}

interface CommitResponse {
  mode: 'commit'
  job_id: string
  summary: {
    created_count: number
    updated_count: number
    ignored_count: number
    error_count: number
    total_rows: number
  }
}

function actionLabel(action: ImportPlanRow['action']): string {
  if (action === 'create') return 'Criar'
  if (action === 'update') return 'Atualizar'
  if (action === 'ignore') return 'Ignorar'
  return 'Erro'
}

export function ProductImportPanel({
  onImported,
}: {
  readonly onImported: () => Promise<void> | void
}) {
  const [rows, setRows] = useState<ImportRowInput[]>([])
  const [plan, setPlan] = useState<ImportPlanRow[]>([])
  const [summary, setSummary] = useState<DryRunResponse['summary'] | null>(null)
  const [commitResult, setCommitResult] = useState<CommitResponse['summary'] | null>(null)
  const [jobId, setJobId] = useState('')
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  function reset() {
    setRows([])
    setPlan([])
    setSummary(null)
    setCommitResult(null)
    setJobId('')
    setFileName('')
    setError(null)
    setSuccess(null)
  }

  async function validate(parsedRows: ImportRowInput[], currentJobId: string) {
    const response = await callAuthedFunction<DryRunResponse>('product-import', {
      mode: 'dry_run',
      job_id: currentJobId,
      rows: parsedRows,
    })
    setPlan(response.rows)
    setSummary(response.summary)
    return response
  }

  async function handleFile(file: File | null) {
    reset()
    if (!file) return
    setFileName(file.name)
    setBusy(true)
    try {
      const parsed = await parseImportFile(file)
      const currentJobId = crypto.randomUUID()
      setRows(parsed.rows)
      setJobId(currentJobId)
      await validate(parsed.rows, currentJobId)
    } catch (parseError) {
      setError(
        parseError instanceof Error ? parseError.message : 'Não foi possível ler o arquivo.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function revalidate() {
    if (rows.length === 0) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await validate(rows, jobId)
    } catch (validationError) {
      if (validationError instanceof EdgeFunctionError) {
        setError(validationError.message)
        const detailRows = validationError.details.rows
        if (Array.isArray(detailRows)) setPlan(detailRows as ImportPlanRow[])
      } else {
        setError('Não foi possível validar a importação.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    if (rows.length === 0 || !jobId) return
    if (!summary || summary.errors > 0) {
      setError('Corrija as linhas com erro antes de confirmar.')
      return
    }
    if (
      !window.confirm(
        `Importar ${summary.total} linha(s)? Serão ${summary.creates} criação(ões) e ${summary.updates} atualização(ões).`,
      )
    ) {
      return
    }

    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await callAuthedFunction<CommitResponse>('product-import', {
        mode: 'commit',
        job_id: jobId,
        rows,
      })
      setCommitResult(response.summary)
      setSuccess(
        `Importação concluída: ${response.summary.created_count} criado(s), ${response.summary.updated_count} atualizado(s), ${response.summary.ignored_count} ignorado(s).`,
      )
      await onImported()
    } catch (commitError) {
      if (commitError instanceof EdgeFunctionError) {
        setError(commitError.message)
        const detailRows = commitError.details.rows
        if (Array.isArray(detailRows)) setPlan(detailRows as ImportPlanRow[])
      } else {
        setError('Não foi possível concluir a importação.')
      }
    } finally {
      setBusy(false)
    }
  }

  function downloadTemplate() {
    const blob = new Blob([`\uFEFF${importTemplateCsv()}`], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'modelo-importacao-produtos.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const preview = plan.slice(0, 20)

  return (
    <section className="card media-card">
      <div className="card-heading">
        <div>
          <span className="eyebrow">Importação em lote</span>
          <h2>CSV ou XLSX</h2>
        </div>
        <button type="button" className="button button-secondary" onClick={downloadTemplate}>
          Baixar modelo
        </button>
      </div>
      <p className="muted">
        Até {MAX_IMPORT_ROWS} linhas por arquivo, 5 MB. Use SKU para atualizar itens
        existentes; sem SKU, o item é criado. Nada é gravado antes da confirmação.
      </p>
      <label className="field">
        <span>Arquivo</span>
        <input
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
        />
      </label>
      {fileName && <p className="form-note">Arquivo: {fileName}</p>}
      {error && <FormMessage>{error}</FormMessage>}
      {success && <FormMessage tone="success">{success}</FormMessage>}

      {summary && (
        <div className="import-summary" aria-label="Resumo da validação">
          <span>Total: {summary.total}</span>
          <span>Criar: {summary.creates}</span>
          <span>Atualizar: {summary.updates}</span>
          <span>Ignorar: {summary.ignores}</span>
          <span className={summary.errors > 0 ? 'text-danger' : ''}>
            Erros: {summary.errors}
          </span>
        </div>
      )}

      {preview.length > 0 && (
        <div className="table-wrap">
          <table className="data-table import-table">
            <thead>
              <tr>
                <th>Linha</th>
                <th>Ação</th>
                <th>Nome</th>
                <th>SKU</th>
                <th>Categoria</th>
                <th>Unidade</th>
                <th>Preço</th>
                <th>Regra</th>
                <th>Erro</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr key={`${row.line}-${row.sku ?? row.name}`} className={row.error ? 'row-error' : ''}>
                  <td>{row.line}</td>
                  <td>{actionLabel(row.action)}</td>
                  <td>{row.name || '—'}</td>
                  <td>{row.sku ?? '—'}</td>
                  <td>
                    {row.category ?? '—'}
                    {row.category_new ? ' (nova)' : ''}
                  </td>
                  <td>{row.unit || '—'}</td>
                  <td>{row.price_cents === null ? 'A combinar' : formatBRL(row.price_cents)}</td>
                  <td>
                    {row.min_quantity}/{row.quantity_increment}
                  </td>
                  <td>{row.error ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {plan.length > preview.length && (
        <p className="form-note">Mostrando 20 de {plan.length} linhas validadas.</p>
      )}

      {rows.length > 0 && (
        <div className="import-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void revalidate()}
            disabled={busy}
          >
            {busy ? 'Validando…' : 'Validar novamente'}
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => void commit()}
            disabled={busy || !summary || summary.errors > 0 || commitResult !== null}
          >
            {busy ? 'Importando…' : 'Confirmar importação'}
          </button>
        </div>
      )}
    </section>
  )
}
