import { h, clear, plural } from './util.js';
import * as catalogueView from './views/catalogue.js';
import * as matrixView from './views/matrix.js';
import * as networkView from './views/network.js';
import * as roadmapView from './views/roadmap.js';
import { openForm, entryToYaml } from './form.js';

const VIEWS = { catalogue: catalogueView, matrix: matrixView, network: networkView, roadmap: roadmapView };
const TYPE_LABEL = { tool: 'Tool', research_question: 'Research question', publication: 'Publication', dataset: 'Dataset' };

const ctx = {
  data: null, byId: {}, filters: { search: '', endpoint: '', kind: '', maturity: '', verification: '' },
  currentView: null,
};

// ---------- data helpers ----------
ctx.label = (vocab, key) => ctx.data.vocab[vocab]?.[key] ?? key;
ctx.get = (type, id) => ctx.byId[type]?.get(id);
ctx.all = (type) => ctx.data.entities[type] || [];
ctx.toolsFor = (rqId) => ctx.all('tool').filter((t) => (t.research_questions || []).includes(rqId));
ctx.datasetsFor = (rqId) => ctx.all('dataset').filter((d) => (d.research_questions || []).includes(rqId));

function haystack(e) {
  const pubs = (e.publications || []).map((d) => ctx.get('publication', d)).filter(Boolean);
  return [e.id, e.name, e.title, e.description, e.notes, ...(e.endpoints || []).map((k) => ctx.label('endpoints', k)),
    ...pubs.flatMap((p) => [p.title, p.authors, p.journal, p.doi])].join(' ').toLowerCase();
}

/** Tools and datasets passing the current filters. */
ctx.filtered = (type = 'tool') => {
  const f = ctx.filters;
  const q = f.search.trim().toLowerCase();
  return ctx.all(type).filter((e) =>
    (!q || haystack(e).includes(q)) &&
    (!f.endpoint || (e.endpoints || []).includes(f.endpoint)) &&
    (type !== 'tool' || !f.kind || e.kind === f.kind) &&
    (type !== 'tool' || !f.maturity || e.maturity === f.maturity) &&
    (type !== 'tool' || !f.verification || e.verification === f.verification));
};
ctx.filtersActive = () => Object.values(ctx.filters).some(Boolean);

// ---------- GitHub links ----------
ctx.gh = {
  configured: () => !/^OWNER\/REPO$/.test(ctx.data.config.repo || 'OWNER/REPO'),
  repo: () => `https://github.com/${ctx.data.config.repo}`,
  file: (p) => `${ctx.gh.repo()}/blob/${ctx.data.config.branch}/${p}`,
  commits: (p) => `${ctx.gh.repo()}/commits/${ctx.data.config.branch}/${p}`,
  issue: (n) => `${ctx.gh.repo()}/issues/${n}`,
  pr: (n) => `${ctx.gh.repo()}/pull/${n}`,
  commit: (sha) => `${ctx.gh.repo()}/commit/${sha}`,
};

// ---------- routing ----------
ctx.open = (type, id) => { location.hash = `#/${ctx.currentView || 'catalogue'}/${type}/${encodeURIComponent(id)}`; };
ctx.closePanel = () => { location.hash = `#/${ctx.currentView || 'catalogue'}`; };

function route() {
  const [, view = 'catalogue', type, id] = location.hash.split('/');
  const v = VIEWS[view] ? view : 'catalogue';
  if (v !== ctx.currentView) {
    ctx.currentView = v;
    document.querySelectorAll('.tabs a').forEach((a) => a.setAttribute('aria-selected', String(a.dataset.view === v)));
    document.getElementById('filters').hidden = v === 'roadmap';
    renderView();
  }
  if (type && id) showPanel(type, decodeURIComponent(id)); else hidePanel();
}

ctx.rerender = () => renderView();
function renderView() {
  const main = clear(document.getElementById('view'));
  VIEWS[ctx.currentView].render(main, ctx);
}

// ---------- detail panel ----------
const chips = (vocab, keys, cls = 'chip') => h('div', { class: 'chips' }, (keys || []).map((k) => h('span', { class: cls }, ctx.label(vocab, k))));
const link = (url, text) => h('a', { href: url, target: '_blank', rel: 'noopener' }, text || url);
const entityLink = (type, id, text) => h('a', { href: `#/${ctx.currentView}/${type}/${encodeURIComponent(id)}` }, text);
function row(label, value) {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return null;
  return [h('dt', {}, label), h('dd', {}, value)];
}

function pubItem(doi) {
  const p = ctx.get('publication', doi);
  if (!p) return h('li', {}, link(`https://doi.org/${doi}`, doi));
  return h('li', {}, entityLink('publication', p.doi, p.title), ' ', h('span', { class: 'muted' },
    `${p.authors || ''} (${p.year}) ${p.journal || ''}. `), link(`https://doi.org/${p.doi}`, 'doi.org ↗'));
}

function historyBlock(e) {
  const hist = e._history || [];
  const items = hist.map((c) => h('li', {},
    h('div', {}, h('strong', {}, c.date), ' · ', c.message),
    h('div', { class: 'muted small' }, 'by ', c.author,
      c.coauthors?.length ? ` with ${c.coauthors.join(', ')}` : '',
      c.pr && ctx.gh.configured() ? [' · ', link(ctx.gh.pr(c.pr), `PR #${c.pr}`)] : '',
      ctx.gh.configured() ? [' · ', link(ctx.gh.commit(c.sha), c.sha.slice(0, 7))] : '')));
  const prov = e.provenance || {};
  return [
    h('h3', {}, 'Change history'),
    items.length ? h('ul', { class: 'history' }, items)
      : h('p', { class: 'muted small' }, 'No changes recorded in the repository history yet.'),
    h('p', { class: 'muted small' }, `Origin: ${prov.source || 'unknown'}, added ${prov.added || '?'}`,
      prov.issue && ctx.gh.configured() ? [' · last submission ', link(ctx.gh.issue(prov.issue), `#${prov.issue}`)] : '',
      prov.on_behalf_of ? ` · on behalf of ${prov.on_behalf_of}` : ''),
  ];
}

function actionButtons(type, e) {
  const btns = [h('button', { class: 'btn primary', type: 'button', onclick: () => openForm(ctx, type, e) }, 'Suggest edit')];
  if (ctx.gh.configured() && e._path) {
    btns.push(h('a', { class: 'btn', href: ctx.gh.file(e._path), target: '_blank', rel: 'noopener' }, 'Source on GitHub'));
    btns.push(h('a', { class: 'btn', href: ctx.gh.commits(e._path), target: '_blank', rel: 'noopener' }, 'Full history'));
  }
  return h('div', { class: 'btnrow' }, btns);
}

function panelContent(type, e) {
  const head = [h('p', { class: 'muted small' }, TYPE_LABEL[type])];
  if (type === 'tool') {
    return [...head, h('h2', {}, e.name),
      h('div', { class: 'chips' }, h('span', { class: 'badge' }, ctx.label('kinds', e.kind)),
        h('span', { class: 'badge' }, ctx.label('maturity', e.maturity)),
        h('span', { class: `badge verify-${e.verification}` }, ctx.label('verification', e.verification))),
      e.verification === 'seeded_unverified' ? h('p', { class: 'note' },
        'This entry was created by the WG coordinators from the 2025 survey. If you know this tool, please check it and suggest corrections.') : null,
      h('p', {}, e.description),
      h('dl', {},
        row('Endpoints', chips('endpoints', e.endpoints, 'chip ep')),
        row('Research questions', (e.research_questions || []).length ? h('div', {}, (e.research_questions).map((id) =>
          h('div', {}, entityLink('research_question', id, ctx.get('research_question', id)?.title || id)))) : null),
        row('Methods', e.methods?.length ? chips('methods', e.methods) : null),
        row('Input data', e.input_data?.length ? chips('input_data', e.input_data) : null),
        row('Output', e.output),
        row('Availability', e.availability?.length ? chips('availability', e.availability) : null),
        row('License', e.license),
        row('Website', e.url ? link(e.url) : null),
        row('Code', e.code_url ? link(e.code_url) : null),
        row('Contacts', e.contacts?.length ? e.contacts.map((c) => h('div', {}, c.name, c.affiliation ? ` (${c.affiliation})` : '',
          c.github ? [' · ', link(`https://github.com/${c.github}`, '@' + c.github)] : '')) : null),
        row('Notes', e.notes)),
      e.publications?.length ? [h('h3', {}, 'Publications'), h('ul', { class: 'pubs' }, e.publications.map(pubItem))] : null,
      actionButtons(type, e), historyBlock(e)];
  }
  if (type === 'research_question') {
    const tools = ctx.toolsFor(e.id), ds = ctx.datasetsFor(e.id), sd = e.survey_demand, rm = e.roadmap || {};
    return [...head, h('h2', {}, e.title),
      h('div', { class: 'chips' }, h('span', { class: 'badge' }, ctx.label('rq_categories', e.category)),
        h('span', { class: `badge prio-${rm.priority}` }, `Priority: ${ctx.label('priority', rm.priority)}`),
        h('span', { class: 'badge' }, ctx.label('roadmap_status', rm.status))),
      h('p', {}, e.description),
      h('dl', {},
        row('Endpoint', e.endpoint ? ctx.label('endpoints', e.endpoint) : null),
        row('Survey 2025', sd ? `${sd.q8_need} of ${sd.q8_respondents} respondents name this as urgent; ${sd.q6_have_tool} report own tools` : null),
        row('Lead', rm.lead),
        row('Roadmap updated', rm.updated)),
      rm.next_steps?.length ? [h('h3', {}, 'Next steps'), h('ul', { class: 'steps' }, rm.next_steps.map((s) => h('li', {}, s)))] : null,
      h('h3', {}, `Tools addressing this (${tools.length})`),
      tools.length ? h('ul', { class: 'pubs' }, tools.map((t) => h('li', {}, entityLink('tool', t.id, t.name), ' ',
        h('span', { class: 'muted' }, `· ${ctx.label('maturity', t.maturity)}`))))
        : h('p', { class: 'muted' }, 'No tool in the catalogue yet – a gap. Know one? Propose it.'),
      ds.length ? [h('h3', {}, `Datasets (${ds.length})`), h('ul', { class: 'pubs' }, ds.map((d) => h('li', {}, entityLink('dataset', d.id, d.name))))] : null,
      actionButtons(type, e), historyBlock(e)];
  }
  if (type === 'publication') {
    const tools = ctx.all('tool').filter((t) => (t.publications || []).includes(e.doi));
    return [...head, h('h2', {}, e.title), h('p', { class: 'muted' }, `${e.authors || ''} (${e.year}). ${e.journal || ''}`),
      h('p', {}, link(`https://doi.org/${e.doi}`, `https://doi.org/${e.doi}`)),
      h('h3', {}, 'Cited by'), h('ul', { class: 'pubs' }, tools.map((t) => h('li', {}, entityLink('tool', t.id, t.name)))),
      actionButtons(type, e), historyBlock(e)];
  }
  // dataset
  return [...head, h('h2', {}, e.name), h('p', {}, e.description),
    h('dl', {}, row('Data type', chips('input_data', e.data_type)), row('Matrices', e.matrices?.length ? chips('matrices', e.matrices) : null),
      row('Endpoints', e.endpoints?.length ? chips('endpoints', e.endpoints, 'chip ep') : null), row('Size', e.size), row('Labels', e.labels),
      row('Access', e.access), row('Link', e.url ? link(e.url) : null),
      row('Research questions', (e.research_questions || []).map((id) => h('div', {}, entityLink('research_question', id, ctx.get('research_question', id)?.title || id))))),
    actionButtons(type, e), historyBlock(e)];
}

let lastFocus = null;
function showPanel(type, id) {
  const e = ctx.get(type, id);
  const panel = document.getElementById('panel');
  if (!e) { hidePanel(); return; }
  if (panel.hidden) lastFocus = document.activeElement;
  clear(document.getElementById('panel-body')).append(...[panelContent(type, e)].flat(Infinity).filter(Boolean));
  panel.hidden = false;
  panel.scrollTop = 0;
  document.getElementById('panel-close').focus();
  VIEWS[ctx.currentView].highlight?.(type, id);
}
function hidePanel() {
  const panel = document.getElementById('panel');
  if (panel.hidden) return;
  panel.hidden = true;
  VIEWS[ctx.currentView].highlight?.(null, null);
  lastFocus?.focus?.();
}

// ---------- help ----------
function showHelp() {
  const c = ctx.data.config;
  const body = clear(document.getElementById('dlg-body'));
  body.append(h('h2', {}, 'How to contribute'),
    h('ol', {},
      h('li', {}, 'Use ', h('strong', {}, '+ Propose'), ' (new entry) or ', h('strong', {}, 'Suggest edit'), ' (on any entry). The form produces a structured entry.'),
      h('li', {}, 'Click ', h('strong', {}, 'Open on GitHub'), '. A pre-filled issue opens; submit it (a free GitHub account is needed).'),
      h('li', {}, 'A bot validates the entry. If something is wrong it comments on the issue; edit the issue and it re-checks.'),
      h('li', {}, 'If valid, the bot opens a pull request. A WG curator reviews it, may discuss changes with you, and merges it.'),
      h('li', {}, 'The site updates automatically. Every change keeps its author, date, reviewer and discussion in the public history.')),
    h('p', { class: 'note' }, 'No GitHub account? ', c.curators_contact
      ? ['Send your entry to ', h('a', { href: `mailto:${c.curators_contact}` }, c.curators_contact), ' and a curator submits it on your behalf.']
      : 'Send your entry to the WG coordinators and a curator submits it on your behalf.'),
    h('h3', {}, 'About the data'),
    h('p', { class: 'small muted' }, `Initial entries come from the ${c.survey_reference}: research questions from the reported needs, tools from the publications respondents listed. `,
      'Categories were assigned by the coordinators and are marked “Seeded from survey – please verify” until checked by the tool owner or a curator.'));
  document.getElementById('dlg').showModal();
}

// ---------- filters & theme ----------
function initFilters() {
  const v = ctx.data.vocab;
  const fill = (id, vocab, keys) => {
    const sel = document.getElementById(id);
    for (const k of keys || Object.keys(v[vocab])) sel.append(h('option', { value: k }, v[vocab][k]));
  };
  fill('f-endpoint', 'endpoints'); fill('f-kind', 'kinds'); fill('f-maturity', 'maturity'); fill('f-verification', 'verification');
  const bind = (id, key, ev = 'change') => document.getElementById(id).addEventListener(ev, (e) => {
    ctx.filters[key] = e.target.value; renderView();
  });
  bind('f-search', 'search', 'input'); bind('f-endpoint', 'endpoint'); bind('f-kind', 'kind');
  bind('f-maturity', 'maturity'); bind('f-verification', 'verification');
  document.getElementById('f-reset').addEventListener('click', () => {
    for (const k of Object.keys(ctx.filters)) ctx.filters[k] = '';
    document.querySelectorAll('#filters input, #filters select').forEach((el) => { el.value = ''; });
    renderView();
  });
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('theme'); } catch { /* storage blocked */ }
  if (saved) document.documentElement.dataset.theme = saved;
  document.getElementById('btn-theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* ignore */ }
    renderView();
  });
}

// ---------- boot ----------
async function boot() {
  try {
    const res = await fetch('data/catalogue.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ctx.data = await res.json();
  } catch (err) {
    document.getElementById('view').append(h('p', { class: 'empty' }, `Could not load the catalogue (${err.message}).`));
    return;
  }
  for (const [type, list] of Object.entries(ctx.data.entities)) {
    ctx.byId[type] = new Map(list.map((e) => [type === 'publication' ? e.doi : e.id, e]));
  }
  const s = ctx.data.stats;
  document.getElementById('subtitle').textContent =
    `${plural(s.tool, 'tool')} · ${plural(s.research_question, 'research question')} · ${plural(s.publication, 'publication')} · ${plural(s.dataset, 'dataset')}`;
  document.getElementById('foot').append(
    'Maintained by the NORMAN Data Science working group. Content is community-contributed and curator-reviewed. ',
    ctx.gh.configured() ? h('a', { href: ctx.gh.repo(), target: '_blank', rel: 'noopener' }, 'Repository & full history') : '');
  initFilters(); initTheme();
  document.getElementById('btn-help').addEventListener('click', showHelp);
  document.getElementById('btn-propose').addEventListener('click', () => openForm(ctx, 'tool', null));
  document.getElementById('panel-close').addEventListener('click', () => ctx.closePanel());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('panel').hidden && !document.getElementById('dlg').open) ctx.closePanel();
  });
  window.addEventListener('hashchange', route);
  route();
}

ctx.entryToYaml = entryToYaml;
boot();
