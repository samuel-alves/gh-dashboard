# Token do GitHub

O dashboard precisa de um **token classic** do GitHub para mostrar dados. Sem token só aparece o ecrã "Liga um token para continuar".

Tokens fine-grained **não servem**: as alterações a listas de stars na API do GitHub só aceitam o scope `user` de um token classic.

## Scopes

| Scope | Para quê | Necessário? |
| --- | --- | --- |
| `user` | Ler e mudar listas de stars, deixar de seguir, perfil | Sim |
| `repo` | Ver repositórios privados e tirar stars | Sim, se quiseres ver os repositórios privados |
| `public_repo` | Tirar stars (só repositórios públicos) | Alternativa a `repo` se não quiseres dar acesso aos privados |

Não marcar mais nada: `workflow`, `admin:*`, `delete_repo` e os restantes não são usados.

Atenção: `repo` dá controlo total sobre todos os teus repositórios, privados incluídos. Quem tiver o token pode alterar ou apagar código. Por isso: prazo de validade curto, só em browsers teus, e revogar se houver dúvida.

## Criar o token

1. Abrir o link já preenchido: https://github.com/settings/tokens/new?scopes=repo,user&description=GitHub%20Index
   (sem repositórios privados: https://github.com/settings/tokens/new?scopes=public_repo,user&description=GitHub%20Index)
2. Confirmar que estás na conta `samuel-alves` (canto superior direito).
3. **Expiration:** 90 dias (recomendado). Evitar "No expiration".
4. Confirmar os scopes da tabela acima e clicar em **Generate token**.
5. Copiar o token (`ghp_…`). O GitHub só o mostra uma vez.

## Ligar no dashboard

1. Abrir o dashboard e clicar em **Ligar token**.
2. Colar o token.
3. **Lembrar neste browser:**
    - ligado: fica guardado no `localStorage` e sobrevive a fechar o browser (só em computadores teus);
    - desligado: fica no `sessionStorage` e desaparece ao fechar o separador (computadores partilhados).
4. Clicar em **Ligar**. Os dados carregam em poucos segundos e ficam em cache no browser; **Atualizar** força um novo carregamento.

O token só é enviado para `api.github.com`. Fica guardado por domínio: se o dashboard mudar de endereço (por exemplo para Cloudflare Pages, ver [HOSTING.md](HOSTING.md)), é preciso ligá-lo outra vez.

## Desligar, renovar e revogar

- **Desligar neste browser:** **Token ligado → Desligar token**. Apaga o token e a cache deste browser.
- **Token expirado ou revogado:** o dashboard mostra "O token foi recusado pelo GitHub". Criar ou regenerar o token e ligá-lo de novo.
- **Regenerar** (mesmos scopes, valor novo): https://github.com/settings/tokens → abrir o token → **Regenerate token**. O valor antigo deixa de funcionar de imediato.
- **Revogar** (token exposto ou fora de uso): https://github.com/settings/tokens → **Delete**.
- **Mudar scopes:** editar o token na mesma página. O valor não muda, mas é preciso clicar em **Atualizar** no dashboard.

## Erros comuns

| Mensagem | Causa | Correção |
| --- | --- | --- |
| "Confirma que o token tem os scopes user e repo" | Falta um scope | Editar o token e marcar `user` (e `repo` ou `public_repo`) |
| "O token foi recusado pelo GitHub" | Token expirado, revogado ou mal colado | Criar ou regenerar e ligar de novo |
| Repositórios privados não aparecem | Token sem `repo` | Adicionar `repo` e clicar em **Atualizar** |
| Mostra outra conta | O token pertence a outra conta GitHub | Criar o token com a sessão da conta certa |
