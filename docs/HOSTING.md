# Hosting e acesso

Estado em 2026-11-23: publicado no GitHub Pages (repositório público), com a página bloqueada até ligar um token. Este documento guarda a opção para fechar também o link, que ainda **não foi executada**.

## Situação atual

- A página não guarda dados. Tudo vem da API do GitHub com o token de quem a abre.
- Sem token: só aparece o ecrã "Liga um token para continuar" e não é feito nenhum pedido.
- Com token: mostra a conta dona do token. Um visitante com token próprio vê a conta dele, nunca a tua.
- O que continua público: o código da página (repositório público) e o perfil GitHub em si. As stars são sempre públicas, e as listas também, a não ser que sejam marcadas como privadas.

## Opções comparadas

| Opção | Fecha o link? | Repositório privado? | Custo |
| --- | --- | --- | --- |
| GitHub Pages + token (atual) | Não, só os dados | Não | Grátis |
| **Cloudflare Pages + Cloudflare Access** | Sim, login antes de carregar | Sim | Grátis até 50 utilizadores |
| Netlify / Vercel com password | Sim | Sim | Só nos planos pagos |
| GitHub Pages privado | Sim | Sim | Só no GitHub Enterprise Cloud |

**Recomendação:** se for preciso fechar o link, usar Cloudflare Pages com Cloudflare Access.

## Plano: Cloudflare Pages + Access

O que muda: URL do tipo `gh-dashboard.pages.dev`, login com email (código enviado por email) ou com a conta GitHub antes de a página carregar, e o repositório pode voltar a privado.

### 1. Publicar no Cloudflare Pages

1. Criar conta em https://dash.cloudflare.com (uma vez).
2. **Workers & Pages → Create → Pages → Connect to Git**. Autorizar a app Cloudflare na conta GitHub `samuel-alves`, só para o repositório `gh-dashboard`.
3. Configuração do build:
    - Production branch: `main`
    - Framework preset: None
    - Build command: vazio
    - Build output directory: `/`
4. Guardar e esperar pelo primeiro deploy. Confirmar que `https://gh-dashboard.pages.dev` abre.

### 2. Proteger com Cloudflare Access

1. Abrir **Zero Trust** no painel Cloudflare e escolher o plano Free. Pode pedir um método de pagamento, mesmo sendo grátis.
2. **Access → Applications → Add an application → Self-hosted**.
3. Domínios a proteger:
    - `gh-dashboard.pages.dev` (produção)
    - `*.gh-dashboard.pages.dev` (previews de cada commit, que também são públicos se não forem protegidos)
4. Policy: Action **Allow**, Include **Emails** = `samuel91a@hotmail.com`.
5. Métodos de login: **One-time PIN** (código por email) já vem ativo. Opcional: adicionar **GitHub** em Settings → Authentication → Login methods.
6. Testar numa janela anónima: tem de pedir login antes de mostrar a página.

### 3. Fechar o GitHub Pages e o repositório

Só depois de o passo 2 estar a funcionar:

```bash
gh api -X DELETE repos/samuel-alves/gh-dashboard/pages
gh repo edit samuel-alves/gh-dashboard --visibility private --accept-visibility-change-consequences
gh repo edit samuel-alves/gh-dashboard --homepage "https://gh-dashboard.pages.dev"
```

Atualizar o link **Live** no `README.md`.

### 4. Depois da mudança

- O token fica guardado por origem (domínio). Em `gh-dashboard.pages.dev` é preciso ligar o token outra vez.
- Cada `git push` para `main` faz deploy automático no Cloudflare.
- O token continua a ser necessário: o Access protege a página e o token dá acesso aos dados.
