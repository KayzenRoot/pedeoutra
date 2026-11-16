# Backup automático de produção — 2026-11-16

## Implementação

- Workflow: `.github/workflows/backup.yml`.
- Disparo: diário às 06:00 UTC + `workflow_dispatch`.
- Ações fixadas por SHA (Sonar/segurança).
- Exporta schema, schema `auth` e dados via Supabase CLI linkado.
- Compacta e cifra com GPG AES-256 (`BACKUP_PASSPHRASE` em GitHub Secret).
- Publica artefato cifrado + SHA-256 com retenção de 30 dias.
- Segredos configurados fora do repositório: `SUPABASE_ACCESS_TOKEN`,
  `SUPABASE_DB_PASSWORD`, `BACKUP_PASSPHRASE`.
- Passphrase local em `C:\Users\csn19\pedeoutra-secrets\backup-passphrase.txt`.

## Teste real

- Run `43908416616` (`Production backup`) concluído com sucesso em 1m19s.
- Artefato `pedeoutra-backup-43908416616` baixado.
- `sha256sum -c` = OK.
- Decifragem GPG = OK.
- Conteúdo: `schema.sql` (335 KB, 51 CREATE TABLE), `auth-schema.sql`
  (53 KB, 27 CREATE TABLE), `data.sql` (25 KB, 22 INSERT).
- Arquivos decifrados removidos após a validação.

## Limites

- RPO de até 24h; não é PITR (2 min).
- O artefato fica no GitHub Actions com retenção de 30 dias; para retenção maior
  ou off-site próprio, configurar destino adicional.
- Restore trimestral em ambiente isolado continua obrigatório.
- A passphrase é única e deve ser guardada em local seguro; perdê-la inviabiliza
  a decifragem dos artefatos antigos.

## Estado

`BACKUP_BLOCKED` foi reduzido para **PITR_BLOCKED**: há backup lógico diário
criptografado e testado, mas não há recuperação point-in-time nem retenção
gerenciada. A decisão de Supabase Pro/PITR continua separada (ADR-009).
