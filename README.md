# GitHub Index

One page to browse your GitHub: your repositories, your stars (with star lists) and the people and organizations you follow. Static HTML/CSS/JS, no build step, hosted on GitHub Pages.

**Live:** https://samuel-alves.github.io/gh-dashboard/

## What it does

| Section | Categories | Actions (with token) |
| --- | --- | --- |
| Repositórios | Categories: Salesforce, Mobile & Cordova, Web & Node, Outros. Type: Originais, Privados, Públicos, Forks, Sem descrição | — |
| Stars | Every star list, "Sem lista" (stars in no list) | Change a repo's lists, unstar |
| Following | Pessoas, Organizações | Unfollow |

Everywhere: instant search (`/` to focus, `Esc` to clear) over name, description, topics, language and list names; language and state filters; sorting; click a topic or list tag to filter by it. The URL keeps the view (`#stars/list:security?state=review&sort=rank`), so views can be bookmarked.

## Estado (lifecycle)

Every repository gets one state, shown as a badge on its row (except "Ativo") and filterable with **Estado**. The filter combines with the selected category or list, language and search; counts update accordingly.

| State | Rule |
| --- | --- |
| Ativo | Last push within 180 days |
| Pouco ativo | Last push between 180 days and 1 year |
| Parado | Last push between 1 and 3 years |
| Abandonado | No push for 3+ years and not archived |
| Descontinuado | Description says deprecated, end-of-life, replaced, moved, ... |
| Arquivado | Archived by the owner (read-only) |

Review shortcuts:

| Section | Filter | Matches |
| --- | --- | --- |
| Stars | Para rever | Archived, deprecated or abandoned: candidates to unstar |
| Stars | Star antiga e projeto parado | Starred 3+ years ago and no push for 1+ year |
| Repositórios | Para rever | Abandoned or deprecated, not yet archived: archive or delete |
| Repositórios | Para limpar | Forks untouched for 3+ years |

## Ranking

Sort **Ranking** (Repositórios and Stars) orders the current view by a 0–100 score and shows each item's position, score and a bar; hover the score for the breakdown. Each factor is 0–1, then weighted:

| Factor | How it is measured |
| --- | --- |
| popularidade | Stars, log scale, relative to the most-starred repo in the section |
| atividade | Days since last push: today = 1, one year ≈ 0.37 |
| forks | Forks, log scale, relative to the most-forked repo in the section |
| mantido | 0 if archived, else 1 |
| original | 0 if fork, else 1 (own repos only) |

| Section | Weights |
| --- | --- |
| Stars | popularidade 45, atividade 35, forks 10, mantido 10 |
| Repositórios | atividade 50, popularidade 20, original 20, mantido 10 |

Change weights in `CONFIG.ranking`. Positions are within the current view, so a star list sorted by Ranking shows that list's top. Shareable: `#stars/list:security?sort=rank`.

## Token

The page contains no data. Without a token it only shows a "connect a token" screen; with a token it shows the data of the account that owns the token, so a visitor with their own token sees their own account, never yours. Use a **classic** token:

- `user`: star lists and unfollow (also needed to change lists)
- `repo`: only if you want private repositories

[Create token](https://github.com/settings/tokens/new?scopes=repo,user&description=GitHub%20Index). The token is stored only in your browser (`localStorage`, or `sessionStorage` if "Lembrar" is off) and sent only to `api.github.com`. Data is cached in the browser and refreshed after 10 minutes or with **Atualizar**.

Step-by-step token setup, scopes, renewal and common errors: [docs/TOKEN.md](docs/TOKEN.md).

Hosting options and the plan to put the page behind a login (Cloudflare Pages + Access): [docs/HOSTING.md](docs/HOSTING.md).

## Customize

Edit `CONFIG` at the top of `app.js`:

- `repoGroups`: categories for your own repositories (first match wins)
- `quietDays`, `stalledDays`, `abandonedDays`, `cleanupYears`: lifecycle thresholds
- `deprecated`: regular expression matched against descriptions for "Descontinuado"
- `ranking`: ranking weights

## Run locally

```bash
python3 -m http.server 8765   # then open http://localhost:8765
```
