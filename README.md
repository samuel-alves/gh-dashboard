# GitHub Index

One page to browse your GitHub: your repositories, your stars (with star lists) and the people and organizations you follow. Static HTML/CSS/JS, no build step, hosted on GitHub Pages.

**Live:** https://samuel-alves.github.io/gh-dashboard/

## What it does

| Section | Categories | Actions (with token) |
| --- | --- | --- |
| Repositórios | Salesforce, Mobile & Cordova, Web & Node, Outros · Ativos, Originais, Privados, Forks, Arquivados, Para limpar (forks untouched for 3+ years) | — |
| Stars | Every star list, "Sem lista" (stars in no list) | Change a repo's lists, unstar |
| Following | Pessoas, Organizações | Unfollow |

Everywhere: instant search (`/` to focus, `Esc` to clear) over name, description, topics, language and list names; language filter; sorting; click a topic or list tag to filter by it. The URL keeps the view (`#stars/list:salesforce`), so views can be bookmarked.

## Token

Without a token the page shows public data for the user in the URL (`?user=<login>`, default: the `*.github.io` owner). Star lists, private repositories and the actions need a **classic** token:

- `user`: star lists and unfollow (also needed to change lists)
- `repo`: only if you want private repositories

[Create token](https://github.com/settings/tokens/new?scopes=repo,user&description=GitHub%20Index). The token is stored only in your browser (`localStorage`, or `sessionStorage` if "Lembrar" is off) and sent only to `api.github.com`. Data is cached in the browser and refreshed after 10 minutes or with **Atualizar**.

## Customize

Edit `CONFIG` at the top of `app.js`:

- `repoGroups`: categories for your own repositories (first match wins)
- `activeDays`, `cleanupYears`: thresholds for "Ativos" and "Para limpar"

## Run locally

```bash
python3 -m http.server 8765   # then open http://localhost:8765
```
