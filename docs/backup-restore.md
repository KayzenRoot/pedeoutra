# Backup e Restore

## Estado atual (2026-11-16)

- Projeto Supabase: `waygtbclkxklexnabwvj`, região East US/Ohio, plano **Free**.
- Free **não possui PITR**. O keepalive diário reduz o risco de pausa, mas não é
  backup.
- `npm run test:restore` prova export/restore com dados sintéticos em ambiente
  isolado (contagens e checksums idênticos).
- **Backup lógico diário criptografado configurado** no GitHub Actions, com
  retenção de 30 dias (ver seção abaixo). Ainda não substitui PITR.

## Opções e custos

| Opção | Custo | RPO | RTO estimado | Retenção | Residência |
| --- | --- | --- | --- | --- | --- |
| Free + export manual | US$ 0 | desde o último export | ~1–2h + validação | definir (30–90 dias off-site) | Ohio |
| Pro diário | US$ 25/mês | até 24h | ~1–2h (depende do tamanho) | 7 dias | Ohio |
| Pro + PITR | +US$ 100/mês | até 2 min | depende do banco; projeto indisponível durante restore | 7 dias | Ohio |
| Pro em `sa-east-1` | US$ 25/mês + migração | até 24h | ~1–2h | 7 dias | São Paulo |

Referências oficiais: página de preços Supabase e guia de backups/PITR. A região
`sa-east-1` existe, mas migrar exige recriar projeto, chaves, Auth, secrets,
Edge Functions e webhook Asaas, com janela e novo smoke.

## Backup automático criptografado (2026-11-16)

O workflow `.github/workflows/backup.yml` roda diariamente às 06:00 UTC
(03:00 em America/Sao_Paulo) e também pode ser disparado manualmente:

1. Linka o projeto de produção com `SUPABASE_ACCESS_TOKEN` e
   `SUPABASE_DB_PASSWORD` (GitHub Secrets).
2. Exporta schema público, schema `auth` e dados.
3. Compacta e cifra com GPG AES-256 usando `BACKUP_PASSPHRASE` (GitHub Secret).
4. Publica o artefato cifrado + SHA-256 com retenção de **30 dias**.

Segredos configurados em 2026-11-16: `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_DB_PASSWORD`, `BACKUP_PASSPHRASE`. A passphrase também está em
`C:\Users\csn19\pedeoutra-secrets\backup-passphrase.txt`, fora do repositório.
Nunca versionar a passphrase, o dump ou o artefato decifrado.

Restore do artefato:

```bash
gh run download <run-id> -n pedeoutra-backup-<run-id>
sha256sum -c backup.tar.gz.gpg.sha256
gpg --decrypt --batch --passphrase "$BACKUP_PASSPHRASE" \
  -o backup.tar.gz backup.tar.gz.gpg
tar -xzf backup.tar.gz
```

Depois seguir a seção “Restore (ambiente isolado)”. O backup lógico diário
**não substitui PITR**: RPO de até 24h, não 2 minutos. Para lançamento pago com
garantia de continuidade, manter ADR-009/Pro como decisão separada.

## Export manual (quando aprovado)

Pré-requisitos: `SUPABASE_DB_PASSWORD` no ambiente, projeto linkado e destino
off-site criptografado. Nunca versionar o dump.

```bash
npx supabase db dump --project-ref waygtbclkxklexnabwvj -f backup-$(date +%Y%m%d).sql
```

Procedimento:
1. Gerar o dump em horário de baixa atividade.
2. Criptografar e armazenar off-site com retenção definida.
3. Registrar data, tamanho, hash SHA-256 e operador.
4. Testar restore trimestral em projeto isolado.
5. Excluir dumps além da retenção aprovada.

## Restore (ambiente isolado)

1. Criar projeto Supabase novo e isolado.
2. Aplicar as migrations versionadas (`supabase db push`).
3. Restaurar o dump com `psql`/`supabase db reset` conforme o formato.
4. Rodar `npm run test:db`, `npm run test:postgrest` e verificações de
   contagem/checksum.
5. Se o restore virar produção: atualizar chaves, secrets das funções, Pages e
   webhook Asaas; executar smoke completo antes de apontar tráfego.

## RPO/RTO e LGPD

- Sem backup automático, o RPO é indefinido; não declarar continuidade de
  produção no Free.
- Pro diário: RPO de até 24h. PITR: RPO de até 2 minutos, conforme documentação
  Supabase.
- RTO deve ser medido no primeiro restore real de produção; meta operacional de
  1–2h para um banco pequeno.
- Backups podem reter dados excluídos; solicitações LGPD devem considerar a
  retenção dos backups e ser registradas manualmente.
- Nenhum dado real deve ser destruído durante testes de restore.
