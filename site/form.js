// Schema-driven propose/edit form. Produces YAML and opens a pre-filled GitHub issue (curator-reviewed via PR).
import { h, put, clear } from './util.js';

const TEMPLATES = { tool: '1-new-tool.yml', research_question: '2-new-research-question.yml', dataset: '3-new-dataset.yml' };
const TYPE_LABEL = { tool: 'Tool', research_question: 'Research question', dataset: 'Dataset', publication: 'Publication' };
const SERVER_FIELDS = new Set(['provenance', 'survey_demand', 'contacts']);  // set by bot/curators or edited in YAML
const MAX_URL = 7500;
const LABELS = { id: 'ID', url: 'Website', code_url: 'Code repository', research_questions: 'Research questions',
  input_data: 'Input data', data_type: 'Data type', next_steps: 'Next steps (one per line)', publications: 'Publications (DOIs, one per line)' };
const humanize = (k) => LABELS[k] || k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export function entryToYaml(entry) {
  const clean = Object.fromEntries(Object.entries(entry).filter(([k]) => !k.startsWith('_') && k !== 'provenance'));
  return window.jsyaml ? window.jsyaml.dump(clean, { lineWidth: 100, noRefs: true }) : JSON.stringify(clean, null, 2);
}

export function openForm(ctx, type, existing) {
  const dlg = document.getElementById('dlg');
  const body = clear(document.getElementById('dlg-body'));
  const editing = Boolean(existing);
  if (type === 'publication' && !editing) type = 'tool';

  body.append(h('h2', {}, editing ? `Suggest an edit: ${existing.name || existing.title || existing.doi}` : 'Propose a new entry'));
  if (!editing) {
    body.append(h('div', { class: 'typepick', role: 'group', 'aria-label': 'Entry type' },
      ['tool', 'research_question', 'dataset'].map((t) => h('button', {
        class: 'btn', type: 'button', 'aria-pressed': String(t === type), onclick: () => openForm(ctx, t, null),
      }, TYPE_LABEL[t]))));
  }
  const schema = ctx.data.schemas[type];
  const fields = [];
  const grid = h('div', { class: 'form-grid' });
  const yamlOut = h('textarea', { class: 'yaml-out', rows: 12, spellcheck: 'false', 'aria-label': 'Entry as YAML' });
  const status = h('p', { class: 'small', 'aria-live': 'polite' });

  const props = Object.entries(schema.properties).filter(([k]) => !SERVER_FIELDS.has(k));
  for (const [key, spec] of props) {
    if (key === 'roadmap') {
      for (const [sub, sspec] of Object.entries(spec.properties).filter(([s]) => s !== 'updated')) {
        fields.push(makeField(ctx, `roadmap.${sub}`, sspec, (spec.required || []).includes(sub), existing?.roadmap?.[sub], editing, grid));
      }
      continue;
    }
    fields.push(makeField(ctx, key, spec, (schema.required || []).includes(key), existing?.[key], editing, grid));
  }

  // suggest an id from the name/title for new entries
  if (!editing) {
    const idF = fields.find((f) => f.key === 'id');
    const nameF = fields.find((f) => f.key === 'name' || f.key === 'title');
    let touched = false;
    idF?.input.addEventListener('input', () => { touched = true; });
    nameF?.input.addEventListener('input', () => {
      if (!touched && idF) idF.input.value = (type === 'research_question' ? 'rq-' : '') + slugify(nameF.input.value);
    });
  }

  function collect() {
    const out = editing ? Object.fromEntries(Object.entries(existing).filter(([k]) => !k.startsWith('_') && k !== 'provenance')) : {};
    for (const f of fields) {
      const v = f.get();
      const [a, b] = f.key.split('.');
      if (b) {
        out[a] = { ...(out[a] || {}) };
        if (v === undefined) delete out[a][b]; else out[a][b] = v;
      } else if (v === undefined) delete out[a]; else out[a] = v;
    }
    return out;
  }
  function validate(entry) {
    let ok = true;
    for (const f of fields) {
      const msg = f.check(f.get(), ctx, type, editing);
      f.setError(msg);
      if (msg) ok = false;
    }
    return ok && entry;
  }
  const refresh = () => { yamlOut.value = entryToYaml(collect()); };
  grid.addEventListener('input', refresh);
  grid.addEventListener('change', refresh);
  refresh();

  const configured = ctx.gh.configured();
  const submit = h('button', { class: 'btn primary', type: 'button', disabled: !configured }, 'Open on GitHub');
  const copy = h('button', { class: 'btn', type: 'button' }, 'Copy YAML');
  submit.addEventListener('click', () => {
    const entry = collect();
    if (!validate(entry)) { status.textContent = 'Please fix the highlighted fields.'; return; }
    const label = entry.name || entry.title || entry.id;
    const params = new URLSearchParams({
      template: editing ? '4-edit-entry.yml' : TEMPLATES[type],
      title: `[${editing ? 'Edit' : TYPE_LABEL[type]}] ${label}`,
      entry_type: TYPE_LABEL[type],
      change: editing ? 'Edit existing entry' : 'New entry',
      entry_yaml: yamlOut.value,
    });
    const url = `${ctx.gh.repo()}/issues/new?${params}`;
    if (url.length > MAX_URL) {
      navigator.clipboard?.writeText(yamlOut.value).catch(() => {});
      status.textContent = 'The entry is too long for a link. The YAML was copied to your clipboard; paste it into the "Entry (YAML)" field of the issue that opens.';
      params.delete('entry_yaml');
      window.open(`${ctx.gh.repo()}/issues/new?${params}`, '_blank', 'noopener');
      return;
    }
    window.open(url, '_blank', 'noopener');
    status.textContent = 'A GitHub issue opened in a new tab — review and submit it there.';
  });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(yamlOut.value); status.textContent = 'YAML copied.'; }
    catch { yamlOut.select(); status.textContent = 'Select the YAML and copy it manually.'; }
  });

  put(body,
    h('p', { class: 'small muted' }, 'Fill in the form; the YAML below is what will be submitted. Submission opens a GitHub issue, which a bot validates and a curator reviews before it goes live.'),
    grid,
    h('details', { open: editing }, h('summary', {}, 'YAML preview (advanced: you can edit it directly, e.g. to add contacts)'), yamlOut),
    h('div', { class: 'btnrow', style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' }, submit, copy),
    configured ? null : h('p', { class: 'note' }, 'The GitHub repository is not configured yet (config.yaml → repo). Copy the YAML and send it to the WG coordinators.'),
    status);
  if (!dlg.open) dlg.showModal();
  fields[0]?.input?.focus();
}

function makeField(ctx, key, spec, required, value, editing, grid) {
  const name = key.split('.').pop();
  const wrap = h('label', { class: 'field' });
  const err = h('span', { class: 'err' });
  const title = h('span', {}, humanize(name), required ? ' *' : '');
  let input, get;
  const isArray = spec.type === 'array';
  const itemEnum = spec.items?.enum;
  const vocabFor = (enumVals) => {
    const v = ctx.data.vocab;
    return Object.keys(v).find((k) => JSON.stringify(Object.keys(v[k])) === JSON.stringify(enumVals));
  };

  if (name === 'research_questions') {
    const rqs = ctx.all('research_question');
    input = h('div', { class: 'checks' }, rqs.map((r) => h('label', {},
      h('input', { type: 'checkbox', value: r.id, checked: (value || []).includes(r.id) }), r.short_title || r.title)));
    get = () => { const v = [...input.querySelectorAll('input:checked')].map((i) => i.value); return v.length ? v : undefined; };
  } else if (isArray && itemEnum) {
    const voc = vocabFor(itemEnum);
    input = h('div', { class: 'checks' }, itemEnum.map((k) => h('label', {},
      h('input', { type: 'checkbox', value: k, checked: (value || []).includes(k) }), voc ? ctx.label(voc, k) : k)));
    get = () => { const v = [...input.querySelectorAll('input:checked')].map((i) => i.value); return v.length ? v : undefined; };
  } else if (isArray) {  // publications, next_steps: one per line
    input = h('textarea', { rows: 3 });
    input.value = (value || []).join('\n');
    get = () => {
      const v = input.value.split('\n').map((s) => s.trim()).filter(Boolean)
        .map((s) => (name === 'publications' ? s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase() : s));
      return v.length ? v : undefined;
    };
  } else if (spec.enum) {
    const voc = vocabFor(spec.enum);
    input = h('select', {}, required ? null : h('option', { value: '' }, '—'),
      spec.enum.map((k) => h('option', { value: k, selected: value === k }, voc ? ctx.label(voc, k) : k)));
    if (!value && name === 'verification') input.value = 'owner_verified';
    get = () => input.value || undefined;
  } else if (spec.type === 'integer') {
    input = h('input', { type: 'number', value: value ?? '' });
    get = () => (input.value === '' ? undefined : Number(input.value));
  } else {
    const long = (spec.maxLength || 0) > 400;
    input = long ? h('textarea', { rows: 3 }) : h('input', { type: name.endsWith('url') ? 'url' : 'text' });
    input.value = value ?? '';
    if ((name === 'id' || name === 'doi') && editing) input.readOnly = true;
    get = () => (input.value.trim() === '' ? undefined : input.value.trim());
  }

  const full = isArray || (spec.maxLength || 0) > 400;
  wrap.classList.toggle('full', full);
  put(wrap, title, spec.description ? h('span', { class: 'hint' }, spec.description) : null, input, err);
  grid.append(wrap);

  const check = (v, ctx2, type, isEdit) => {
    if (required && (v === undefined || (Array.isArray(v) && !v.length))) return 'Required.';
    if (v === undefined) return '';
    if (typeof v === 'string') {
      if (spec.minLength && v.length < spec.minLength) return `At least ${spec.minLength} characters.`;
      if (spec.maxLength && v.length > spec.maxLength) return `At most ${spec.maxLength} characters.`;
      if (spec.pattern && !new RegExp(spec.pattern).test(v)) {
        return name === 'id' ? 'Lower-case letters, digits and single dashes only.' : 'Invalid format (http(s):// address expected).';
      }
      if (name === 'id' && !isEdit && ctx2.get(type, v)) return 'This ID already exists – use "Suggest edit" on that entry.';
    }
    if (name === 'publications') {
      const bad = v.filter((d) => !/^10\.\d{4,9}\/\S+$/.test(d));
      if (bad.length) return `Not a DOI: ${bad.join(', ')}`;
    }
    return '';
  };
  const setError = (msg) => { err.textContent = msg; wrap.classList.toggle('invalid', Boolean(msg)); };
  return { key, input, get, check, setError };
}
