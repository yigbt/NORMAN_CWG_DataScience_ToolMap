import { h, plural } from '../util.js';

export function render(main, ctx) {
  const tools = ctx.filtered('tool').slice().sort((a, b) => a.name.localeCompare(b.name));
  const datasets = ctx.filtered('dataset');
  const total = ctx.all('tool').length;

  main.append(h('p', { class: 'count-line', 'aria-live': 'polite' },
    ctx.filtersActive() ? `${tools.length} of ${plural(total, 'tool')} match the filters` : plural(total, 'tool')));

  if (!tools.length) {
    main.append(h('p', { class: 'empty' }, 'No tool matches these filters. ',
      h('button', { class: 'btn link', type: 'button', onclick: () => document.getElementById('f-reset').click() }, 'Reset filters')));
  } else {
    main.append(h('div', { class: 'grid' }, tools.map((t) => card(ctx, t))));
  }

  main.append(h('h2', { class: 'section-title' }, `Datasets (${datasets.length})`));
  if (!ctx.all('dataset').length) {
    main.append(h('p', { class: 'empty' },
      'No datasets listed yet. Survey respondents reported mostly HRMS screening data from many matrices — ',
      h('button', { class: 'btn link', type: 'button', onclick: () => import('../form.js').then((m) => m.openForm(ctx, 'dataset', null)) },
        'offer a dataset'), '.'));
  } else {
    main.append(h('div', { class: 'grid' }, datasets.map((d) => h('button', {
      class: 'card', type: 'button', onclick: () => ctx.open('dataset', d.id),
    }, h('h3', {}, d.name), h('p', { class: 'desc' }, d.description),
      h('div', { class: 'meta' }, (d.data_type || []).map((k) => h('span', { class: 'chip' }, ctx.label('input_data', k))))))));
  }
}

function card(ctx, t) {
  const pubs = (t.publications || []).length;
  return h('button', { class: 'card', type: 'button', onclick: () => ctx.open('tool', t.id), 'aria-label': `${t.name}: details` },
    h('div', { class: 'chips' },
      h('span', { class: 'badge' }, ctx.label('kinds', t.kind)),
      h('span', { class: `badge verify-${t.verification}` }, t.verification === 'seeded_unverified' ? 'unverified' : ctx.label('verification', t.verification))),
    h('h3', {}, t.name),
    h('p', { class: 'desc' }, t.description),
    h('div', { class: 'chips' }, (t.endpoints || []).map((k) => h('span', { class: 'chip ep' }, ctx.label('endpoints', k)))),
    h('div', { class: 'meta small muted' }, ctx.label('maturity', t.maturity), pubs ? ` · ${plural(pubs, 'publication')}` : ''));
}
