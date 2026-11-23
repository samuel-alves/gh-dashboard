'use strict';

/* ---------- Configuration (edit freely) ---------- */
const CONFIG = {
  cleanupYears: 3,      // "Para limpar": forks untouched for N years
  ownerMin: 2,          // Stars sidebar "Donos": owners with at least N starred repos
  suggestMin: 3,        // Following "Sugestões para seguir": unfollowed owners with N+ starred repos
  // Lifecycle states (filter "Estado" + row badges), by days since the last push
  quietDays: 180,       // up to here: "Ativo"; after: "Pouco ativo"
  stalledDays: 365,     // after: "Parado"
  abandonedDays: 1095,  // after (3 years): "Abandonado"
  // Description text that marks a project as deprecated, end-of-life or moved
  deprecated: /\b(deprecated|unmaintained|no longer (maintained|supported|developed|active)|end[- ]of[- ]life|EOL|superseded|replaced by|has been replaced|moved to|new home|not maintained|abandoned)\b/i,
  // "Ranking" sort: weights (sum 100) of each 0–1 factor. See score().
  ranking: {
    stars: { popularidade: 45, atividade: 35, forks: 10, mantido: 10 },
    repos: { atividade: 50, popularidade: 20, original: 20, mantido: 10 },
  },
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
  repos: [], stars: [], following: [], lists: [], suggestions: [],
  section: 'stars', cat: 'all', q: '', lang: '', sort: '', state: '',
  loadedAt: null, busy: false,
};


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

const REPO_FIELDS = 'id nameWithOwner name owner{login avatarUrl __typename} url description isPrivate isFork isArchived stargazerCount forkCount pushedAt homepageUrl primaryLanguage{name color} repositoryTopics(first:10){nodes{topic{name}}}';
const fromGql = (n, starredAt) => ({
  id: n.id, full: n.nameWithOwner, owner: n.owner.login, name: n.name, url: n.url,
  ownerAvatar: n.owner.avatarUrl || '', ownerOrg: n.owner.__typename === 'Organization',
  desc: n.description || '', lang: n.primaryLanguage?.name || '', langColor: n.primaryLanguage?.color || '',
  stars: n.stargazerCount, forks: n.forkCount ?? 0, pushedAt: n.pushedAt, starredAt: starredAt || null,
  private: n.isPrivate, fork: n.isFork, archived: n.isArchived,
  topics: (n.repositoryTopics?.nodes || []).map(t => t.topic.name), homepage: n.homepageUrl || '',
});

// GraphQL `viewer.following` returns users only; REST also returns followed organizations.
async function loadFollowing(path) {
  const base = (await restAll(path)).map(f => ({
    login: f.login, org: f.type === 'Organization', name: '', avatar: f.avatar_url, url: f.html_url,
    bio: '', company: '', location: '', repos: null, followers: null,
  }));
  await enrichOwners(base);
  return base;
}

// Fills name, bio, location and counts for users/organizations, 50 per GraphQL request.
async function enrichOwners(list) {
  if (!S.token) return;
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
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
}

// How many of your stars belong to each owner (lowercase login → count).
const starCountCache = new WeakMap();
function starsByOwner() {
  if (!starCountCache.has(S.stars)) {
    const m = new Map();
    for (const r of S.stars) m.set(r.owner.toLowerCase(), (m.get(r.owner.toLowerCase()) || 0) + 1);
    starCountCache.set(S.stars, m);
  }
  return starCountCache.get(S.stars);
}
const myStarsOf = login => starsByOwner().get(login.toLowerCase()) || 0;

// Owners you star CONFIG.suggestMin+ times but don't follow (and aren't you).
async function loadSuggestions() {
  const skip = new Set([S.login.toLowerCase(), ...S.following.map(u => u.login.toLowerCase())]);
  const seen = new Map();
  for (const r of S.stars) {
    const k = r.owner.toLowerCase();
    if (skip.has(k) || seen.has(k) || myStarsOf(k) < CONFIG.suggestMin) continue;
    seen.set(k, {
      login: r.owner, org: !!r.ownerOrg, avatar: r.ownerAvatar, url: `https://github.com/${r.owner}`,
      name: '', bio: '', company: '', location: '', repos: null, followers: null, suggested: true,
    });
  }
  const list = [...seen.values()];
  await enrichOwners(list);
  return list;
}

async function loadAll() {
  if (S.token) { // the page shows nothing without a token (see renderGate)
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
    S.suggestions = await loadSuggestions();
  }
  S.loadedAt = Date.now();
  saveCache();
}

/* ---------- Cache (this browser only) ---------- */
const cacheKey = () => 'ghindex:cache';
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
      suggestions: d.suggestions || [],
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
    return [
      { title: 'Todos', items: [{ key: 'all', name: 'Todos', test: () => true }] },
      { title: 'Categorias', items: CONFIG.repoGroups.map(g => ({ key: `g:${g.key}`, name: g.name, test: r => groupOf(r) === g.key })) },
      { title: 'Tipo', items: [
        { key: 't:sources', name: 'Originais (não forks)', test: r => !r.fork },
        { key: 't:private', name: 'Privados', test: r => r.private },
        { key: 't:public', name: 'Públicos', test: r => !r.private },
        { key: 't:forks', name: 'Forks', test: r => r.fork },
        { key: 't:nodesc', name: 'Sem descrição', hint: 'Repositórios sem descrição no GitHub', test: r => !r.desc },
      ] },
    ];
  }
  if (S.section === 'stars') {
    const lists = [...S.lists].sort((a, b) => collator.compare(a.name, b.name));
    const followed = new Set(S.following.map(u => u.login.toLowerCase()));
    return [
      { title: 'Todas', items: [
        { key: 'all', name: 'Todas as stars', test: () => true },
        ...(S.lists.length ? [{ key: 'unlisted', name: 'Sem lista', test: r => !listsOf(r.full).length }] : []),
        { key: 'followed', name: 'De quem segues', hint: 'Repositórios de pessoas ou organizações que segues',
          test: r => followed.has(r.owner.toLowerCase()) },
      ] },
      ...(lists.length ? [{ title: 'Listas', items: lists.map(l => ({ key: `list:${l.slug}`, name: l.name, list: l, test: r => l.repos.has(r.full) })) }] : []),
      ...ownerGroups(followed),
    ];
  }
  return [{ title: 'Following', items: [
    { key: 'all', name: 'Todos', test: () => true },
    { key: 'f:users', name: 'Pessoas', test: u => !u.org },
    { key: 'f:orgs', name: 'Organizações', test: u => u.org },
  ] }, { title: 'Descobrir', items: [
    // Virtual category: its rows come from S.suggestions, not from S.following
    { key: 'suggest', name: 'Sugestões para seguir', source: () => S.suggestions, test: () => true,
      hint: `Donos de ${CONFIG.suggestMin}+ repositórios com star tua que ainda não segues` },
  ] }];
}
/* Owners: users or organizations with CONFIG.ownerMin+ starred repos become sidebar entries. */
function ownerGroups(followed) {
  const by = new Map();
  for (const r of S.stars) {
    const k = r.owner.toLowerCase();
    if (!by.has(k)) by.set(k, { login: r.owner, avatar: r.ownerAvatar, org: r.ownerOrg, n: 0 });
    by.get(k).n++;
  }
  const owners = [...by.values()].filter(o => o.n >= CONFIG.ownerMin)
    .sort((a, b) => b.n - a.n || collator.compare(a.login, b.login));
  if (!owners.length) return [];
  return [{ title: 'Donos', items: owners.map(o => ({
    key: `owner:${o.login}`, name: o.login, avatar: o.avatar, owner: o,
    hint: `${o.org ? 'Organização' : 'Utilizador'}${followed.has(o.login.toLowerCase()) ? ' que segues' : ''}`,
    test: r => r.owner.toLowerCase() === o.login.toLowerCase(),
  })) }];
}
// A link like #stars/owner:<login> must work even for owners below ownerMin (e.g. from Following).
function ownerCat(key) {
  const login = key.slice('owner:'.length);
  return { key, name: login, owner: { login }, test: r => r.owner.toLowerCase() === login.toLowerCase() };
}

/* Lifecycle: one state per repo, shown as a badge and used by the "Estado" filter. */
const LIFECYCLE = {
  active:     { name: 'Ativo',        filter: 'Ativos',        hint: d => `Push nos últimos ${d.quietDays} dias` },
  quiet:      { name: 'Pouco ativo',  filter: 'Pouco ativos',  hint: d => `Último push entre ${d.quietDays} dias e 1 ano` },
  stalled:    { name: 'Parado',       filter: 'Parados',       hint: d => `Último push entre 1 e ${d.abandonedDays / 365} anos` },
  abandoned:  { name: 'Abandonado',   filter: 'Abandonados',   hint: d => `Sem push há mais de ${d.abandonedDays / 365} anos e não arquivado` },
  deprecated: { name: 'Descontinuado', filter: 'Descontinuados ou movidos', hint: () => 'A descrição diz deprecated, end-of-life, substituído ou movido' },
  archived:   { name: 'Arquivado',    filter: 'Arquivados',    hint: () => 'Arquivado pelo dono (só leitura)' },
};
function lifecycle(r) {
  if (r.archived) return 'archived';
  if (CONFIG.deprecated.test(r.desc || '')) return 'deprecated';
  const days = (Date.now() - new Date(r.pushedAt || 0)) / DAY;
  if (days > CONFIG.abandonedDays) return 'abandoned';
  if (days > CONFIG.stalledDays) return 'stalled';
  if (days > CONFIG.quietDays) return 'quiet';
  return 'active';
}
// Filter options for the "Estado" select: each lifecycle state plus review shortcuts.
function states() {
  if (S.section === 'following') return [];
  const base = Object.entries(LIFECYCLE).map(([k, v]) => ({ key: k, name: v.filter, hint: v.hint(CONFIG), test: r => lifecycle(r) === k }));
  const review = S.section === 'stars'
    ? { key: 'review', name: 'Para rever (candidatos a tirar star)', hint: 'Arquivados, descontinuados ou abandonados',
        test: r => ['archived', 'deprecated', 'abandoned'].includes(lifecycle(r)) }
    : { key: 'review', name: 'Para rever (arquivar ou apagar)', hint: 'Abandonados ou descontinuados, ainda não arquivados',
        test: r => ['deprecated', 'abandoned'].includes(lifecycle(r)) };
  const extra = S.section === 'repos'
    ? [{ key: 'cleanup', name: 'Para limpar (forks antigos)', hint: `Forks sem alterações há ${CONFIG.cleanupYears}+ anos`,
        test: r => r.fork && !r.archived && Date.now() - new Date(r.pushedAt) > CONFIG.cleanupYears * 365 * DAY }]
    : [{ key: 'oldstar', name: 'Star antiga e projeto parado', hint: 'Star há 3+ anos e sem push há 1+ ano',
        test: r => Date.now() - new Date(r.starredAt || 0) > 1095 * DAY && ['stalled', 'abandoned', 'archived', 'deprecated'].includes(lifecycle(r)) }];
  return [review, ...extra, ...base];
}
const currentState = () => states().find(s => s.key === S.state);

const allCats = () => categories().flatMap(g => g.items);
const currentCat = () => allCats().find(c => c.key === S.cat)
  || (S.section === 'stars' && S.cat.startsWith('owner:') ? ownerCat(S.cat) : allCats()[0]);

/* Ranking: weighted 0–100 score from factors that are each normalized to 0–1. */
// Stars and forks are log-scaled relative to the largest value in the whole section
// (not the filtered view), so scores stay stable across filters and the top does not saturate.
const scoreCache = { repos: new WeakMap(), stars: new WeakMap() };
const maxCache = new WeakMap();
function sectionMax(section) {
  const arr = S[section];
  if (!maxCache.has(arr)) {
    maxCache.set(arr, {
      stars: Math.max(0, ...arr.map(r => r.stars || 0)),
      forks: Math.max(0, ...arr.map(r => r.forks || 0)),
    });
  }
  return maxCache.get(arr);
}
const logShare = (v, max) => (max > 0 ? Math.log1p(v || 0) / Math.log1p(max) : 0);
function score(r, section = S.section) {
  const cache = scoreCache[section];
  if (cache.has(r)) return cache.get(r);
  const max = sectionMax(section);
  const days = (Date.now() - new Date(r.pushedAt || 0)) / DAY;
  const factors = {
    popularidade: logShare(r.stars, max.stars),
    atividade: Math.exp(-Math.max(0, days) / 365),   // pushed today = 1, a year ago ≈ 0.37
    forks: logShare(r.forks, max.forks),
    mantido: r.archived ? 0 : 1,
    original: r.fork ? 0 : 1,
  };
  const weights = CONFIG.ranking[section];
  let value = 0;
  const detail = [];
  for (const [k, w] of Object.entries(weights)) {
    value += w * factors[k];
    detail.push(`${k}: ${Math.round(factors[k] * 100)}% × ${w}`);
  }
  const out = { value: Math.round(value), detail: `Score ${Math.round(value)}/100\n${detail.join('\n')}` };
  cache.set(r, out);
  return out;
}
const rankingFormula = () => Object.entries(CONFIG.ranking[S.section] || {}).map(([k, w]) => `${k} ${w}%`).join(', ');

const SORTS = {
  repos: [['pushed', 'Atualizados recentemente'], ['rank', 'Ranking'], ['name', 'Nome'], ['stars', 'Stars']],
  stars: [['starred', 'Star mais recente'], ['rank', 'Ranking'], ['pushed', 'Atualizados recentemente'], ['stars', 'Mais populares'], ['name', 'Nome']],
  following: [['login', 'Nome'], ['mystars', 'Mais stars tuas'], ['followers', 'Mais seguidos']],
};
function sorter(key) {
  return {
    pushed: (a, b) => (b.pushedAt || '').localeCompare(a.pushedAt || ''),
    starred: (a, b) => (b.starredAt || '').localeCompare(a.starredAt || ''),
    stars: (a, b) => b.stars - a.stars,
    rank: (a, b) => score(b).value - score(a).value || b.stars - a.stars,
    name: (a, b) => collator.compare(a.name, b.name),
    login: (a, b) => collator.compare(a.login, b.login),
    followers: (a, b) => (b.followers || 0) - (a.followers || 0),
    mystars: (a, b) => myStarsOf(b.login) - myStarsOf(a.login) || collator.compare(a.login, b.login),
  }[key];
}
const terms = () => S.q.toLowerCase().split(/\s+/).filter(Boolean);
function haystack(x) {
  if (S.section === 'following') return [x.login, x.name, x.bio, x.company, x.location].join(' ').toLowerCase();
  const lists = S.section === 'stars' ? listsOf(x.full).map(l => l.name).join(' ') : '';
  return [x.full, x.desc, x.lang, x.topics.join(' '), lists].join(' ').toLowerCase();
}
// Items after search + language + state. skipState: used to count each state option.
function baseItems(skipState, items = S[S.section]) {
  const t = terms();
  const st = skipState ? null : currentState();
  return items.filter(x => (!S.lang || x.lang === S.lang) && (!st || st.test(x)) && t.every(w => haystack(x).includes(w)));
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

  // State counts follow search, language and the selected category/list
  const opts2 = states();
  $('state').closest('.field').hidden = !opts2.length;
  if (S.state && !opts2.some(s => s.key === S.state)) S.state = '';
  const inCat = baseItems(true).filter(currentCat().test);
  $('state').innerHTML = '<option value="">Todos</option>' + opts2.map(s =>
    `<option value="${s.key}"${s.key === S.state ? ' selected' : ''} title="${esc(s.hint)}">${esc(s.name)} (${inCat.filter(s.test).length})</option>`).join('');
}

function renderSide() {
  const base = baseItems();
  const active = currentCat().key;
  $('side').innerHTML = categories().map(g => `
    <h3>${esc(g.title)}</h3>
    ${g.items.map(c => {
      const n = c.source ? baseItems(false, c.source()).length : base.filter(c.test).length;
      return `<button type="button" data-cat="${esc(c.key)}" aria-pressed="${c.key === active}" class="${n ? '' : 'empty'}"${c.hint ? ` title="${esc(c.hint)}"` : ''}>
        ${c.avatar ? `<img class="mini${c.owner?.org ? ' org' : ''}" src="${esc(c.avatar)}&s=40" alt="" loading="lazy">` : ''}<span>${esc(c.name)}</span><span class="count">${n}</span></button>`;
    }).join('')}`).join('');
}

function repoRow(r, i) {
  const ranked = S.sort === 'rank';
  const sc = ranked ? score(r) : null;
  const lists = S.section === 'stars' ? listsOf(r.full) : [];
  const lc = lifecycle(r);
  const badges = [r.private && 'Privado', r.fork && 'Fork'].filter(Boolean).map(b => `<span class="badge">${b}</span>`).join('')
    + (lc !== 'active' ? `<span class="badge state-${lc}" title="${esc(LIFECYCLE[lc].hint(CONFIG))}">${LIFECYCLE[lc].name}</span>` : '');
  const meta = [
    sc && `<span class="score" title="${esc(sc.detail)}"><span class="bar"><i style="width:${sc.value}%"></i></span>Score ${sc.value}</span>`,
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
  return `<article class="row${ranked ? ' ranked' : ''}">
    ${ranked ? `<span class="rank" aria-label="Posição ${i + 1}">${i + 1}</span>` : ''}
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
  const starred = S.stars.filter(r => r.owner.toLowerCase() === u.login.toLowerCase()).length;
  const starLink = starred
    ? `<a class="tag" href="#stars/owner:${encodeURIComponent(u.login)}" title="Ver as tuas stars deste dono">${starred} ${starred === 1 ? 'star tua' : 'stars tuas'}</a>`
    : '';
  return `<article class="row person">
    <img src="${esc(u.avatar)}&s=88" alt="" loading="lazy">
    <div class="row-main">
      <a class="name" href="${esc(u.url)}" target="_blank" rel="noopener">${hl(u.login)}</a>${u.org ? '<span class="badge">Organização</span>' : ''}
      ${u.name ? `<span class="muted"> ${hl(u.name)}</span>` : ''}
      ${u.bio ? `<p class="desc">${hl(u.bio)}</p>` : ''}
      <div class="meta">${meta}${starLink}
        <a href="${esc(u.url)}?tab=repositories">Repositórios</a>
        <a href="${esc(u.url)}?tab=stars">Stars</a></div>
    </div>
    <div class="row-actions">${!S.token ? '' : u.suggested
      ? `<button type="button" class="btn primary" data-act="follow" data-id="${esc(u.login)}">Seguir</button>`
      : `<button type="button" class="btn danger" data-act="unfollow" data-id="${esc(u.login)}">Deixar de seguir</button>`}</div>
  </article>`;
}

function renderList() {
  const cat = currentCat(); // falls back to "all" until data (e.g. star lists) has loaded; S.cat is kept
  const items = (cat.source ? baseItems(false, cat.source()) : baseItems().filter(cat.test)).sort(sorter(S.sort));
  $('listTitle').textContent = cat.name;
  const noun = S.section === 'following' ? 'contas' : 'repositórios';
  const st = currentState();
  $('listInfo').textContent = [`${items.length} ${noun}.`, cat.hint && `${cat.hint}.`, cat.list?.desc && `${cat.list.desc}.`,
    st && `Estado: ${st.name} (${st.hint}).`,
    S.sort === 'rank' && `Ranking: ${rankingFormula()}.`].filter(Boolean).join(' ');
  const link = $('listLink');
  if (cat.list && S.login) { link.href = `https://github.com/stars/${S.login}/lists/${cat.list.slug}`; link.hidden = false; }
  else if (cat.owner) { link.href = `https://github.com/${encodeURIComponent(cat.owner.login)}`; link.hidden = false; }
  else if (S.login) { link.href = `https://github.com/${S.login}?tab=${S.section === 'repos' ? 'repositories' : S.section}`; link.hidden = false; }
  else link.hidden = true;

  const rows = $('rows');
  if (!items.length) {
    rows.innerHTML = `<p class="empty-state">${S.loadedAt
      ? (S.q || S.lang ? 'Nada corresponde à pesquisa e aos filtros. Limpa a pesquisa (Esc) ou escolhe outra categoria.' : 'Esta categoria está vazia.')
      : 'A carregar dados do GitHub…'}</p>`;
    return;
  }
  rows.innerHTML = items.map(S.section === 'following' ? personRow : repoRow).join('');
}

// Without a token nothing is fetched or shown: only the "connect a token" screen.
function renderGate() {
  const locked = !S.token;
  document.body.classList.toggle('locked', locked);
  $('gate').hidden = !locked;
  return locked;
}

function render() {
  if (renderGate()) return;
  renderHeader(); renderToolbar(); renderSide(); renderList();
  $('status').textContent = S.busy ? 'A atualizar…' : (S.loadedAt ? `Atualizado ${ago(new Date(S.loadedAt).toISOString())}` : '');
  $('refreshBtn').disabled = S.busy;
}

/* ---------- Routing: #section/category ---------- */
// Format: #<section>[/<category>][?sort=<key>], e.g. #stars/list:security?sort=rank
function readHash() {
  const [path, query = ''] = decodeURIComponent(location.hash.slice(1)).split('?');
  const [section, ...rest] = path.split('/');
  if (['repos', 'stars', 'following'].includes(section)) {
    if (section !== S.section) { S.lang = ''; S.sort = ''; S.state = ''; }
    S.section = section;
    S.cat = rest.join('/') || 'all';
    const params = new URLSearchParams(query);
    if (params.get('sort')) S.sort = params.get('sort');
    S.state = params.get('state') || '';
  }
}
function writeHash() {
  const params = new URLSearchParams();
  if (S.sort && S.sort !== SORTS[S.section][0][0]) params.set('sort', S.sort);
  if (S.state) params.set('state', S.state);
  const qs = params.toString();
  const h = `#${S.section}${S.cat !== 'all' ? `/${S.cat}` : ''}${qs ? `?${qs}` : ''}`;
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
  if (S.busy || !S.token) return;
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
    const gone = S.following.find(u => u.login === login);
    S.following = S.following.filter(u => u.login !== login);
    // Back to suggestions if it still qualifies
    if (gone && myStarsOf(login) >= CONFIG.suggestMin) S.suggestions = [...S.suggestions, { ...gone, suggested: true }];
    saveCache(); render(); toast(`Deixaste de seguir ${login}`);
  } catch (e) { toast(explain(e), true); }
}
async function follow(login) {
  try {
    await rest(`/user/following/${encodeURIComponent(login)}`, { method: 'PUT' });
    const s = S.suggestions.find(u => u.login === login);
    S.suggestions = S.suggestions.filter(u => u.login !== login);
    if (s) S.following = [...S.following, { ...s, suggested: false }];
    saveCache(); render(); toast(`Passaste a seguir ${login}`);
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
  if (t.dataset.act === 'follow') { t.disabled = true; follow(id).finally(() => { t.disabled = false; }); }
  if (t.dataset.act === 'lists') openLists(id);
  if (t.dataset.act === 'token') openToken();
});
document.querySelectorAll('.tabs a').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  if (S.section !== a.dataset.section) { S.section = a.dataset.section; S.cat = 'all'; S.lang = ''; S.sort = ''; S.state = ''; }
  writeHash(); render();
}));
$('q').addEventListener('input', e => { S.q = e.target.value; renderSide(); renderList(); });
$('lang').addEventListener('change', e => { S.lang = e.target.value; renderSide(); renderList(); });
$('sort').addEventListener('change', e => { S.sort = e.target.value; writeHash(); renderList(); });
$('state').addEventListener('change', e => { S.state = e.target.value; writeHash(); renderSide(); renderList(); });
$('refreshBtn').addEventListener('click', refresh);
$('tokenBtn').addEventListener('click', openToken);
$('listsDlg').addEventListener('close', () => { if ($('listsDlg').returnValue === 'ok') saveLists(); });
$('tokenDlg').addEventListener('close', () => {
  if ($('tokenDlg').returnValue !== 'ok') return;
  const v = $('tokenInput').value.trim();
  if (!v) return;
  store.del('ghindex:token');
  store.set('ghindex:token', v, !$('remember').checked);
  store.del('ghindex:cache'); // a different token may belong to a different account
  S.token = v;
  Object.assign(S, { login: null, profile: null, repos: [], stars: [], following: [], lists: [], suggestions: [], loadedAt: null });
  render(); refresh();
});
$('disconnectBtn').addEventListener('click', () => {
  store.del('ghindex:token');
  store.del('ghindex:cache');
  S.token = null; $('tokenDlg').close('cancel');
  Object.assign(S, { login: null, profile: null, repos: [], stars: [], following: [], lists: [], suggestions: [], loadedAt: null });
  render();
});
$('gateBtn').addEventListener('click', openToken);
window.addEventListener('hashchange', () => { readHash(); render(); });
document.addEventListener('keydown', e => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
  if (e.key === '/' && !typing) { e.preventDefault(); $('q').focus(); $('q').select(); }
  if (e.key === 'Escape' && document.activeElement === $('q') && S.q) { S.q = ''; $('q').value = ''; renderSide(); renderList(); }
});

/* ---------- Start ---------- */
loadToken();
readHash();
const hadCache = S.token && loadCache();
render();
if (S.token && (!hadCache || Date.now() - (S.loadedAt || 0) > 10 * 60 * 1000)) refresh();
