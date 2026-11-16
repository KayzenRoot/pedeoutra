# Bootstrap do superadmin — passo a passo

O console `/admin` exige **AAL2 (TOTP)**. Enquanto o proprietário não concluir
este passo, o estado correto é `ADMIN_BOOTSTRAP_BLOCKED`.

## Pré-requisitos

- E-mail do proprietário: `goodzlanchonete@gmail.com` (o script já sugere).
- Senha da conta Supabase Auth desse e-mail.
- Um aplicativo autenticador (Google Authenticator, 1Password, Authy etc.).
- Os arquivos locais (fora do repositório):
  - `C:\Users\csn19\pedeoutra-secrets\bootstrap-admin.mjs`
  - `C:\Users\csn19\pedeoutra-secrets\admin-bootstrap-token.txt`
  - `.env.production.local` na raiz do projeto (URL/anon key pública)

Nunca cole senha, código TOTP ou token em issue, PR, chat, log ou commit.

## Executar

No PowerShell ou terminal:

```powershell
node C:\Users\csn19\pedeoutra-secrets\bootstrap-admin.mjs
```

O script fará, em ordem:

1. Pedir o e-mail (pressione Enter para usar `goodzlanchonete@gmail.com`).
2. Pedir a senha sem exibir caracteres.
3. Fazer login no Supabase Auth.
4. Se ainda não houver TOTP verificado, criar um fator e salvar o QR code em
   `C:\Users\csn19\pedeoutra-secrets\admin-totp-qr.svg`.
5. Pedir o código TOTP de 6 dígitos.
6. Confirmar AAL2 e chamar `admin-bootstrap` com o token dedicado.
7. Exibir `Bootstrap concluído` e o link `https://pedeoutra.pages.dev/admin`.

## Escanear o QR

1. Abra `C:\Users\csn19\pedeoutra-secrets\admin-totp-qr.svg` no visualizador de
   imagens.
2. No autenticador, escolha “Adicionar conta” → “Escanear QR code”.
3. Digite o código de 6 dígitos no terminal dentro da validade (30 s).

Se o código expirar, rode o script novamente. Um fator pendente não verificado
é removido e recriado; um fator já verificado é reutilizado.

## Verificar

1. Acesse `https://pedeoutra.pages.dev/admin`.
2. Faça login com o e-mail/senha e informe o TOTP.
3. O console deve abrir com visão geral, organizações, auditoria, analytics,
   financeiro, saúde e indicações.

## Problemas comuns

| Sintoma | Ação |
| --- | --- |
| `Falha no login` | Confirme e-mail/senha; a conta precisa existir no Supabase Auth de produção. |
| `Não foi possível iniciar o MFA TOTP` | Verifique se o projeto Supabase permite TOTP e tente novamente. |
| `Código TOTP inválido ou expirado` | Aguarde o próximo código e rode de novo. |
| `Bootstrap falhou` | Confirme se o token local é o mesmo configurado em `ADMIN_BOOTSTRAP_TOKEN` na Edge Function; não rotacione sem atualizar os dois lados. |
| `/admin` retorna 403 | A sessão não está em AAL2 ou a conta não está em `platform_admins`. |

## Segurança

- O token de bootstrap é dedicado e fica fora do repositório.
- O script não imprime URL, chave, senha, token nem código.
- O QR code é um segredo: não versionar, não anexar em issue e apagar depois do
  cadastro se desejar.
- O bootstrap é idempotente; repetir não cria um segundo admin.
- Nenhuma cobrança, e-mail ou envio externo é feito por este passo.
