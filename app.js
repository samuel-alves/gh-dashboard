'use strict';

/* ---------- Configuration (edit freely) ---------- */
const CONFIG = {
  defaultUser: 'samuel-alves',
  activeDays: 180,      // "Ativos": pushed in the last N days
  cleanupYears: 3,      // "Para limpar": forks untouched for N years
  // Categories for your own repositories. First match wins.
  repoGroups: [
    { key: 'salesforce', name: 'Salesforce',
      match: r => r.lang === 'Apex' || /salesforce|sfdx|\bsf[-_]|lwc|apex|trailhead|flow|force|marketing.?cloud|\bmc-/i.test(`${r.name} ${r.desc}`) },
    { key: 'mobile', name: 'Mobile & Cordova',
      match: r => /cordova|android|\bios\b|hybrid|mobile|stayaway/i.test(`${r.name} ${r.desc}`) },
    { key: 'web', name: 'Web & Node',
      match: r => ['JavaScript', 'TypeScript', 'HTML', 'CSS', 'PHP'].includes(r.lang) },
    { key: 'other', name: 'Outros', match: () => true },
  ],
};

/* ---------- Small helpers ---------- */
const $ = id => document.getElementById(id);
const DAY = 864e5;
const store = {
  get(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch { return null; } },
  set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch { /* storage blocked */ } },
  del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* storage blocked */ } },
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rtf = new Intl.RelativeTimeFormat('pt-PT', { numeric: 'auto' });
function ago(iso) {
  if (!iso) return '';
  const days = (Date.now() - new Date(iso)) / DAY;
  if (days < 1) return 'hoje';
  if (days < 30) return rtf.format(-Math.round(days), 'day');
  if (days < 365) return rtf.format(-Math.round(days / 30), 'month');
  return rtf.format(-Math.round(days / 365), 'year');
}
const fmtNum = n => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
const collator = new Intl.Collator('pt-PT', { sensitivity: 'base' });

/* ---------- State ---------- */
const S = {
  login: null, profile: null, token: null,
  repos: [], stars: [], following: [], lists: [],
  section: 'stars', cat: 'all', q: '', lang: '', sort: '',
  loadedAt: null, busy: false,
};

function guessUser() {
  const p = new URLSearchParams(location.search).get('user');
  if (p) return p;
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  return m ? m[1] : CONFIG.defaultUser;
}

/* ---------- GitHub API ---------- */
function apiError(status, body) {
  const e = (body && body.errors && body.errors[0]) || body || {};
  const err = new Error(e.message || `O GitHub respondeu ${status}`);
  err.type = e.type; err.status = status;
  return err;
}
async function gql(query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${S.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) throw apiError(res.status, body);
  return body.data;
}
async function rest(path, opts = {}) {
  const headers = { Accept: 'application/vnd.github+json', ...(opts.headers || {}) };
  if (S.token) headers.Authorization = `token ${S.token}`;
  const res = await fetch(`https://api.github.com${path}`, { ...opts, headers });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw apiError(res.status, body);
  return body;
}
async function restAll(path, accept) {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = await rest(`${path}${sep}per_page=100&page=${page}`, accept ? { headers: { Accept: accept } } : {});
    out.push(...batch);
    if (batch.length < 100) return out;
  }
}
async function paginate(field, selection, args = '') {
  const out = [];
  let after = null;
  for (;;) {
    const d = await gql(`query($after:String){viewer{${field}(first:100,after:$after${args}){pageInfo{hasNextPage endCursor} ${selection}}}}`, { after });
    const c = d.viewer[field];
    out.push(...(c.edges || c.nodes));
    if (!c.pageInfo.hasNextPage) return out;
    after = c.pageInfo.endCursor;
  }
}

const REPO_FIELDS = 'id nameWithOwner name owner{login} url description isPrivate isFork isArchived stargazerCount pushedAt homepageUrl primaryLanguage{name color} repositoryTopics(first:10){nodes{topic{name}}}';
const fromGql = (n, starredAt) => ({
  id: n.id, full: n.nameWithOwner, owner: n.owner.login, name: n.name, url: n.url,
  desc: n.description || '', lang: n.primaryLanguage?.name || '', langColor: n.primaryLanguage?.color || '',
  stars: n.stargazerCount, pushedAt: n.pushedAt, starredAt: starredAt || null,
  private: n.isPrivate, fork: n.isFork, archived: n.isArchived,
  topics: (n.repositoryTopics?.nodes || []).map(t => t.topic.name), homepage: n.homepageUrl || '',
});
// REST has no language colors; these match GitHub's linguist colors for common languages.
const LANG_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Apex: '#1797c0', Java: '#b07219', Swift: '#F05138',
  Go: '#00ADD8', Rust: '#dea584', C: '#555555', 'C++': '#f34b7d', Shell: '#89e051', HTML: '#e34c26', CSS: '#663399',
  PHP: '#4F5D95', Ruby: '#701516', Kotlin: '#A97BFF', 'Objective-C': '#438eff', PowerShell: '#012456', SCSS: '#c6538c',
};
const fromRest = (r, starredAt) => ({
  id: r.node_id, full: r.full_name, owner: r.owner.login, name: r.name, url: r.html_url,
  desc: r.description || '', lang: r.language || '', langColor: LANG_COLORS[r.language] || '',
  stars: r.stargazers_count, pushedAt: r.pushed_at, starredAt: starredAt || null,
  private: r.private, fork: r.fork, archived: r.archived, topics: r.topics || [], homepage: r.homepage || '',
});

// GraphQL `viewer.following` returns users only; REST also returns followed organizations.
async function loadFollowing(path) {
  const base = (await restAll(path)).map(f => ({
    login: f.login, org: f.type === 'Organization', name: '', avatar: f.avatar_url, url: f.html_url,
    bio: '', company: '', location: '', repos: null, followers: null,
  }));
  if (!S.token) return base;
  for (let i = 0; i < base.length; i += 50) {
    const chunk = base.slice(i, i + 50);
    const q = chunk.map((u, j) => `u${j}:repositoryOwner(login:${JSON.stringify(u.login)}){repositories{totalCount}
      ... on User{name bio company location followers{totalCount}} ... on Organization{name description location}}`).join('\n');
    const d = await gql(`{${q}}`);
    chunk.forEach((u, j) => {
      const o = d[`u${j}`];
      if (!o) return;
      Object.assign(u, {
        name: o.name || '', bio: o.bio || o.description || '', company: o.company || '', location: o.location || '',
        repos: o.repositories?.totalCount ?? null, followers: o.followers?.totalCount ?? null,
      });
    });
  }
  return base;
}

async function loadAll() {
  if (S.token) {
    const v = (await gql('{viewer{login name avatarUrl url}}')).viewer;
    S.login = v.login;
    S.profile = { name: v.name, avatar: v.avatarUrl, url: v.url };
    const [repos, stars, following, lists] = await Promise.all([
      paginate('repositories', `nodes{${REPO_FIELDS}}`, ',ownerAffiliations:OWNER,orderBy:{field:PUSHED_AT,direction:DESC}'),
      paginate('starredRepositories', `edges{starredAt node{${REPO_FIELDS}}}`, ',orderBy:{field:STARRED_AT,direction:DESC}'),
      loadFollowing('/user/following'),
      paginate('lists', 'nodes{id name slug description items(first:100){nodes{... on Repository{nameWithOwner}}}}'),
    ]);
    S.repos = repos.map(n => fromGql(n));
    S.stars = stars.map(e => fromGql(e.node, e.starredAt));
    S.following = following;
    S.lists = lists.map(l => ({
      id: l.id, name: l.name, slug: l.slug, desc: l.description || '',
      repos: new Set(l.items.nodes.filter(Boolean).map(i => i.nameWithOwner)),
    }));
  } else {
    const login = guessUser();
    const [u, repos, stars, following] = await Promise.all([
      rest(`/users/${encodeURIComponent(login)}`),
      restAll(`/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed`),
      restAll(`/users/${encodeURIComponent(login)}/starred`, 'application/vnd.github.star+json'),
      loadFollowing(`/users/${encodeURIComponent(login)}/following`),
    ]);
    S.login = u.login;
    S.profile = { name: u.name, avatar: u.avatar_url, url: u.html_url };
    S.repos = repos.map(r => fromRest(r));
    S.stars = stars.map(s => fromRest(s.repo, s.starred_at));
    S.following = following;
    S.lists = [];
  }
  S.loadedAt = Date.now();
  saveCache();
}

/* ---------- Cache (this browser only) ---------- */
const cacheKey = () => `ghindex:cache:${S.token ? 'auth' : guessUser()}`;
function saveCache() {
  const data = { ...S, token: undefined, lists: S.lists.map(l => ({ ...l, repos: [...l.repos] })) };
  store.set(cacheKey(), JSON.stringify(data));
}
function loadCache() {
  const raw = store.get(cacheKey());
  if (!raw) return false;
  try {
    const d = JSON.parse(raw);
    Object.assign(S, {
      login: d.login, profile: d.profile, repos: d.repos, stars: d.stars, following: d.following, loadedAt: d.loadedAt,
      lists: d.lists.map(l => ({ ...l, repos: new Set(l.repos) })),
    });
    return true;
  } catch { return false; }
}

/* ---------- Categories, filters, sorting ---------- */
function groupOf(r) { return CONFIG.repoGroups.find(g => g.match(r)).key; }
const listsOf = full => S.lists.filter(l => l.repos.has(full));

function categories() {
  if (S.section === 'repos') {
    const now = Date.now();
    return [
      { title: 'Todos', items: [{ key: 'all', name: 'Todos', test: () => true }] },
      { title: 'Categorias', items: CONFIG.repoGroups.map(g => ({ key: `g:${g.key}`, name: g.name, test: r => groupOf(r) === g.key })) },
      { title: 'Estado', items: [
        { key: 's:active', name: 'Ativos', test: r => now - new Date(r.pushedAt) < CONFIG.activeDays * DAY },
        { key: 's:sources', name: 'Originais (não forks)', test: r => !r.fork },
        { key: 's:private', name: 'Privados', test: r => r.private },
        { key: 's:forks', name: 'Forks', test: r => r.fork },
        { key: 's:archived', name: 'Arquivados', test: r => r.archived },
        { key: 's:cleanup', name: 'Para limpar', hint: `Forks sem alterações há ${CONFIG.cleanupYears}+ anos`,
          test: r => r.fork && !r.archived && now - new Date(r.pushedAt) > CONFIG.cleanupYears * 365 * DAY },
      ] },
    ];
  }
  if (S.section === 'stars') {
    const lists = [...S.lists].sort((a, b) => collator.compare(a.name, b.name));
    return [
      { title: 'Todas', items: [
        { key: 'all', name: 'Todas as stars', test: () => true },
        ...(S.lists.length ? [{ key: 'unlisted', name: 'Sem lista', test: r => !listsOf(r.full).length }] : []),
      ] },
      ...(lists.length ? [{ title: 'Listas', items: lists.map(l => ({ key: `list:${l.slug}`, name: l.name, list: l, test: r => l.repos.has(r.full) })) }] : []),
    ];
  }
  return [{ title: 'Following', items: [
    { key: 'all', name: 'Todos', test: () => true },
    { key: 'f:users', name: 'Pessoas', test: u => !u.org },
    { key: 'f:orgs', name: 'Organizações', test: u => u.org },
  ] }];
}
const allCats = () => categories().flatMap(g => g.items);
const currentCat = () => allCats().find(c => c.key === S.cat) || allCats()[0];

const SORTS = {
  repos: [['pushed', 'Atualizados recentemente'], ['name', 'Nome'], ['stars', 'Stars']],
  stars: [['starred', 'Star mais recente'], ['pushed', 'Atualizados recentemente'], ['stars', 'Mais populares'], ['name', 'Nome']],
  following: [['login', 'Nome'], ['followers', 'Mais seguidos']],
};
function sorter(key) {
  return {
    pushed: (a, b) => (b.pushedAt || '').localeCompare(a.pushedAt || ''),
    starred: (a, b) => (b.starredAt || '').localeCompare(a.starredAt || ''),
    stars: (a, b) => b.stars - a.stars,
    name: (a, b) => collator.compare(a.name, b.name),
    login: (a, b) => collator.compare(a.login, b.login),
    followers: (a, b) => (b.followers || 0) - (a.followers || 0),
  }[key];
}
const terms = () => S.q.toLowerCase().split(/\s+/).filter(Boolean);
function haystack(x) {
  if (S.section === 'following') return [x.login, x.name, x.bio, x.company, x.location].join(' ').toLowerCase();
  const lists = S.section === 'stars' ? listsOf(x.full).map(l => l.name).join(' ') : '';
  return [x.full, x.desc, x.lang, x.topics.join(' '), lists].join(' ').toLowerCase();
}
function baseItems() {
  const items = S[S.section];
  const t = terms();
  return items.filter(x => (!S.lang || x.lang === S.lang) && t.every(w => haystack(x).includes(w)));
}

/* ---------- Rendering ---------- */
function hl(text) {
  let html = esc(text);
  for (const w of terms()) {
    const re = new RegExp(`(${esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    html = html.replace(re, '<mark>$1</mark>');
  }
  return html;
}

function renderHeader() {
  const total = S.repos.length + S.stars.length + S.following.length;
  $('title').textContent = S.profile?.name || S.login || 'GitHub Index';
  const link = $('profileLink');
  link.textContent = S.login ? `@${S.login}` : '';
  link.href = S.profile?.url || '#';
  const av = $('avatar');
  if (S.profile?.avatar) { av.src = S.profile.avatar; av.hidden = false; }
  $('n-repos').textContent = total ? S.repos.length : '';
  $('n-stars').textContent = total ? S.stars.length : '';
  $('n-following').textContent = total ? S.following.length : '';
  document.querySelectorAll('.tabs a').forEach(a => a.setAttribute('aria-current', a.dataset.section === S.section ? 'page' : 'false'));
  $('tokenBtn').textContent = S.token ? 'Token ligado' : 'Ligar token';
}

function renderToolbar() {
  const sortSel = $('sort');
  const opts = SORTS[S.section];
  if (!opts.some(([k]) => k === S.sort)) S.sort = opts[0][0];
  sortSel.innerHTML = opts.map(([k, l]) => `<option value="${k}"${k === S.sort ? ' selected' : ''}>${l}</option>`).join('');
  const langField = $('lang').closest('.field');
  langField.hidden = S.section === 'following';
  const counts = {};
  for (const x of S[S.section]) if (x.lang) counts[x.lang] = (counts[x.lang] || 0) + 1;
  const langs = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  if (S.lang && !counts[S.lang]) S.lang = '';
  $('lang').innerHTML = `<option value="">Todas</option>` + langs.map(l => `<option value="${esc(l)}"${l === S.lang ? ' selected' : ''}>${esc(l)} (${counts[l]})</option>`).join('');
}

function renderSide() {
  const base = baseItems();
  const active = currentCat().key;
  $('side').innerHTML = categories().map(g => `
    <h3>${esc(g.title)}</h3>
    ${g.items.map(c => {
      const n = base.filter(c.test).length;
      return `<button type="button" data-cat="${esc(c.key)}" aria-pressed="${c.key === active}" class="${n ? '' : 'empty'}"${c.hint ? ` title="${esc(c.hint)}"` : ''}>
        <span>${esc(c.name)}</span><span class="count">${n}</span></button>`;
    }).join('')}`).join('');
}

function repoRow(r) {
  const lists = S.section === 'stars' ? listsOf(r.full) : [];
  const badges = [r.private && 'Privado', r.fork && 'Fork', r.archived && 'Arquivado'].filter(Boolean)
    .map(b => `<span class="badge">${b}</span>`).join('');
  const meta = [
    r.lang && `<span><span class="dot" style="background:${/^#[0-9a-f]{3,8}$/i.test(r.langColor) ? r.langColor : 'var(--muted)'}"></span>${hl(r.lang)}</span>`,
    `<span title="Stars">★ ${fmtNum(r.stars)}</span>`,
    r.pushedAt && `<span title="${esc(new Date(r.pushedAt).toLocaleString('pt-PT'))}">Atualizado ${ago(r.pushedAt)}</span>`,
    r.starredAt && `<span>Star ${ago(r.starredAt)}</span>`,
    r.homepage && /^https?:\/\//.test(r.homepage) && `<a href="${esc(r.homepage)}" target="_blank" rel="noopener">Site</a>`,
  ].filter(Boolean).join('');
  const tags = [
    ...lists.map(l => `<button type="button" class="tag" data-cat="list:${esc(l.slug)}" title="Ver lista">${esc(l.name)}</button>`),
    ...(S.section === 'stars' && S.lists.length && !lists.length ? ['<span class="tag topic">Sem lista</span>'] : []),
    ...r.topics.slice(0, 5).map(t => `<button type="button" class="tag topic" data-q="${esc(t)}" title="Pesquisar tópico">${hl(t)}</button>`),
  ].join(' ');
  const actions = S.token && S.section === 'stars' ? `
      ${S.lists.length ? `<button type="button" class="btn" data-act="lists" data-id="${esc(r.full)}">Listas</button>` : ''}
      <button type="button" class="btn danger" data-act="unstar" data-id="${esc(r.full)}">Tirar star</button>` : '';
  return `<article class="row">
    <div class="row-main">
      <a class="name" href="${esc(r.url)}" target="_blank" rel="noopener"><span class="owner">${hl(r.owner)}/</span>${hl(r.name)}</a>${badges}
      ${r.desc ? `<p class="desc">${hl(r.desc)}</p>` : ''}
      <div class="meta">${meta}</div>
      ${tags ? `<div class="meta" style="margin-top:6px">${tags}</div>` : ''}
    </div>
    <div class="row-actions">${actions}</div>
  </article>`;
}

function personRow(u) {
  const meta = [
    u.company && `<span>${hl(u.company)}</span>`,
    u.location && `<span>${hl(u.location)}</span>`,
    u.repos !== null && `<span>${u.repos} repositórios</span>`,
    u.followers !== null && `<span>${fmtNum(u.followers)} seguidores</span>`,
  ].filter(Boolean).join('');
  return `<article class="row person">
    <img src="${esc(u.avatar)}&s=88" alt="" loading="lazy">
    <div class="row-main">
      <a class="name" href="${esc(u.url)}" target="_blank" rel="noopener">${hl(u.login)}</a>${u.org ? '<span class="badge">Organização</span>' : ''}
      ${u.name ? `<span class="muted"> ${hl(u.name)}</span>` : ''}
      ${u.bio ? `<p class="desc">${hl(u.bio)}</p>` : ''}
      <div class="meta">${meta}
        <a href="${esc(u.url)}?tab=repositories">Repositórios</a>
        <a href="${esc(u.url)}?tab=stars">Stars</a></div>
    </div>
    <div class="row-actions">${S.token ? `<button type="button" class="btn danger" data-act="unfollow" data-id="${esc(u.login)}">Deixar de seguir</button>` : ''}</div>
  </article>`;
}

function renderList() {
  const cat = currentCat(); // falls back to "all" until data (e.g. star lists) has loaded; S.cat is kept
  const items = baseItems().filter(cat.test).sort(sorter(S.sort));
  $('listTitle').textContent = cat.name;
  const noun = S.section === 'following' ? 'pessoas' : 'repositórios';
  $('listInfo').textContent = [`${items.length} ${noun}.`, cat.hint && `${cat.hint}.`, cat.list?.desc && `${cat.list.desc}.`].filter(Boolean).join(' ');
  const link = $('listLink');
  if (cat.list && S.login) { link.href = `https://github.com/stars/${S.login}/lists/${cat.list.slug}`; link.hidden = false; }
  else if (S.login) { link.href = `https://github.com/${S.login}?tab=${S.section === 'repos' ? 'repositories' : S.section}`; link.hidden = false; }
  else link.hidden = true;

  const notice = $('notice');
  if (!S.token && S.section === 'stars') {
    notice.innerHTML = 'As listas de stars só aparecem com um token ligado (a API pública do GitHub não as mostra). <button type="button" class="btn" data-act="token">Ligar token</button>';
    notice.hidden = false;
  } else notice.hidden = true;

  const rows = $('rows');
  if (!items.length) {
    rows.innerHTML = `<p class="empty-state">${S.loadedAt
      ? (S.q || S.lang ? 'Nada corresponde à pesquisa e aos filtros. Limpa a pesquisa (Esc) ou escolhe outra categoria.' : 'Esta categoria está vazia.')
      : 'A carregar dados do GitHub…'}</p>`;
    return;
  }
  rows.innerHTML = items.map(S.section === 'following' ? personRow : repoRow).join('');
}

function render() {
  renderHeader(); renderToolbar(); renderSide(); renderList();
  $('status').textContent = S.busy ? 'A atualizar…' : (S.loadedAt ? `Atualizado ${ago(new Date(S.loadedAt).toISOString())}` : '');
  $('refreshBtn').disabled = S.busy;
}

/* ---------- Routing: #section/category ---------- */
function readHash() {
  const [section, ...rest] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (['repos', 'stars', 'following'].includes(section)) {
    if (section !== S.section) { S.lang = ''; S.sort = ''; }
    S.section = section;
    S.cat = rest.join('/') || 'all';
  }
}
function writeHash() {
  const h = `#${S.section}${S.cat !== 'all' ? `/${S.cat}` : ''}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}

/* ---------- Actions ---------- */
let toastTimer;
function toast(msg, isError) {
  const t = $('toast');
  t.textContent = msg; t.className = `toast${isError ? ' error' : ''}`; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 7000 : 3000);
}
function explain(err) {
  if (err.type === 'INSUFFICIENT_SCOPES' || err.status === 403 || err.status === 404) {
    return `${err.message} Confirma que o token tem os scopes "user" e "repo".`;
  }
  if (err.status === 401) return 'O token foi recusado pelo GitHub (expirado ou revogado). Liga um token novo.';
  return err.message;
}

async function refresh() {
  if (S.busy) return;
  S.busy = true; render();
  try { await loadAll(); toast('Dados atualizados'); }
  catch (e) { toast(`Não foi possível carregar: ${explain(e)}`, true); }
  finally { S.busy = false; render(); }
}

function arm(btn, label, run) {
  if (btn.classList.contains('armed')) { btn.disabled = true; run().finally(() => { btn.disabled = false; }); return; }
  const original = btn.textContent;
  btn.classList.add('armed'); btn.textContent = label;
  setTimeout(() => { btn.classList.remove('armed'); btn.textContent = original; }, 3500);
}

async function unstar(full) {
  try {
    await rest(`/user/starred/${full}`, { method: 'DELETE' });
    S.stars = S.stars.filter(r => r.full !== full);
    S.lists.forEach(l => l.repos.delete(full));
    saveCache(); render(); toast(`Star removida de ${full}`);
  } catch (e) { toast(explain(e), true); }
}
async function unfollow(login) {
  try {
    await rest(`/user/following/${encodeURIComponent(login)}`, { method: 'DELETE' });
    S.following = S.following.filter(u => u.login !== login);
    saveCache(); render(); toast(`Deixaste de seguir ${login}`);
  } catch (e) { toast(explain(e), true); }
}

let editing = null;
function openLists(full) {
  editing = S.stars.find(r => r.full === full);
  if (!editing) return;
  $('listsDlgTitle').textContent = `Listas de ${full}`;
  const current = new Set(listsOf(full).map(l => l.id));
  $('listsChecks').innerHTML = [...S.lists].sort((a, b) => collator.compare(a.name, b.name)).map(l =>
    `<label><input type="checkbox" value="${esc(l.id)}"${current.has(l.id) ? ' checked' : ''}> ${esc(l.name)}</label>`).join('');
  $('listsDlg').showModal();
}
async function saveLists() {
  const r = editing; if (!r) return;
  const ids = [...$('listsChecks').querySelectorAll('input:checked')].map(i => i.value);
  try {
    await gql('mutation($i:ID!,$l:[ID!]!){updateUserListsForItem(input:{itemId:$i,listIds:$l}){user{login}}}', { i: r.id, l: ids });
    S.lists.forEach(l => (ids.includes(l.id) ? l.repos.add(r.full) : l.repos.delete(r.full)));
    saveCache(); render(); toast(`Listas guardadas para ${r.full}`);
  } catch (e) { toast(explain(e), true); }
}

/* ---------- Token ---------- */
function loadToken() { S.token = store.get('ghindex:token') || store.get('ghindex:token', true) || null; }
function openToken() {
  $('tokenInput').value = '';
  $('disconnectBtn').hidden = !S.token;
  $('tokenDlg').showModal();
  $('tokenInput').focus();
}

/* ---------- Events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-cat],[data-act],[data-q]');
  if (!t) return;
  if (t.dataset.cat) { S.cat = t.dataset.cat; writeHash(); render(); window.scrollTo({ top: 0 }); return; }
  if (t.dataset.q) { S.q = t.dataset.q; $('q').value = S.q; render(); return; }
  const id = t.dataset.id;
  if (t.dataset.act === 'unstar') arm(t, 'Confirmar', () => unstar(id));
  if (t.dataset.act === 'unfollow') arm(t, 'Confirmar', () => unfollow(id));
  if (t.dataset.act === 'lists') openLists(id);
  if (t.dataset.act === 'token') openToken();
});
document.querySelectorAll('.tabs a').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  if (S.section !== a.dataset.section) { S.section = a.dataset.section; S.cat = 'all'; S.lang = ''; S.sort = ''; }
  writeHash(); render();
}));
$('q').addEventListener('input', e => { S.q = e.target.value; renderSide(); renderList(); });
$('lang').addEventListener('change', e => { S.lang = e.target.value; renderSide(); renderList(); });
$('sort').addEventListener('change', e => { S.sort = e.target.value; renderList(); });
$('refreshBtn').addEventListener('click', refresh);
$('tokenBtn').addEventListener('click', openToken);
$('listsDlg').addEventListener('close', () => { if ($('listsDlg').returnValue === 'ok') saveLists(); });
$('tokenDlg').addEventListener('close', () => {
  if ($('tokenDlg').returnValue !== 'ok') return;
  const v = $('tokenInput').value.trim();
  if (!v) return;
  store.del('ghindex:token');
  store.set('ghindex:token', v, !$('remember').checked);
  S.token = v; S.lists = [];
  loadCache(); render(); refresh();
});
$('disconnectBtn').addEventListener('click', () => {
  store.del('ghindex:token');
  store.del('ghindex:cache:auth');
  S.token = null; $('tokenDlg').close('cancel');
  Object.assign(S, { repos: [], stars: [], following: [], lists: [], loadedAt: null });
  loadCache(); render(); refresh();
});
window.addEventListener('hashchange', () => { readHash(); render(); });
document.addEventListener('keydown', e => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
  if (e.key === '/' && !typing) { e.preventDefault(); $('q').focus(); $('q').select(); }
  if (e.key === 'Escape' && document.activeElement === $('q') && S.q) { S.q = ''; $('q').value = ''; renderSide(); renderList(); }
});

/* ---------- Start ---------- */
loadToken();
readHash();
const hadCache = loadCache();
render();
if (!hadCache || Date.now() - (S.loadedAt || 0) > 10 * 60 * 1000) refresh();
