import { h, tooltip } from '../util.js';

let sortBy = 'coverage';

/** Research questions as columns: prediction needs by survey demand, then cross-cutting topics. */
export function orderedRQs(ctx) {
  const need = (r) => r.survey_demand?.q8_need ?? -1;
  return ctx.all('research_question').slice().sort((a, b) =>
    (a.category === b.category ? 0 : a.category === 'prediction' ? -1 : 1) || need(b) - need(a) || a.title.localeCompare(b.title));
}
export const shortTitle = (rq) => rq.short_title || rq.title;

export function render(main, ctx) {
  const rqs = orderedRQs(ctx);
  const tools = ctx.filtered('tool').slice();
  const n = (t) => (t.research_questions || []).length;
  tools.sort(sortBy === 'name' ? (a, b) => a.name.localeCompare(b.name)
    : (a, b) => n(b) - n(a) || a.name.localeCompare(b.name));
  const catalogueCount = Object.fromEntries(rqs.map((r) => [r.id, ctx.toolsFor(r.id).length]));

  main.append(h('div', { class: 'matrix-controls' },
    h('label', {}, 'Sort tools by ', h('select', { onchange: (e) => { sortBy = e.target.value; ctx.rerender(); } },
      h('option', { value: 'coverage', selected: sortBy === 'coverage' }, 'number of questions'),
      h('option', { value: 'name', selected: sortBy === 'name' }, 'name'))),
    h('div', { class: 'legend' },
      h('span', {}, h('span', { class: 'sw', style: 'background:var(--blue);border-radius:50%' }), 'tool addresses question'),
      h('span', {}, h('span', { class: 'sw', style: 'background:repeating-linear-gradient(45deg,var(--surface),var(--surface) 3px,var(--orange-soft) 3px,var(--orange-soft) 5px);border:1px solid var(--border)' }),
        'gap: no tool in the catalogue'),
      h('span', {}, 'Column numbers: respondents naming it urgent / respondents with own tools (survey 2025)'))));

  if (!tools.length) {
    main.append(h('p', { class: 'empty' }, 'No tool matches these filters.'));
    return;
  }

  const head = h('tr', {}, h('th', { class: 'rowhead', scope: 'col' }, `${tools.length} tools × ${rqs.length} questions`),
    rqs.map((r) => {
      const btn = h('button', { type: 'button', onclick: () => ctx.open('research_question', r.id) }, shortTitle(r));
      tooltip(btn, () => `${r.title} — ${catalogueCount[r.id]} tool(s) in catalogue`);
      const sd = r.survey_demand;
      return h('th', { class: 'colhead', scope: 'col' }, btn,
        h('span', { class: 'demand' }, sd ? `${sd.q8_need}/${sd.q6_have_tool}` : '–'));
    }));

  const body = tools.map((t) => h('tr', {},
    h('th', { class: 'rowhead', scope: 'row' }, h('button', { class: 'rowbtn', type: 'button', onclick: () => ctx.open('tool', t.id) }, t.name)),
    rqs.map((r) => {
      const hit = (t.research_questions || []).includes(r.id);
      const td = h('td', { class: `cell${catalogueCount[r.id] === 0 ? ' gapcol' : ''}` });
      if (hit) {
        const dot = h('span', { class: 'dot', tabindex: 0, role: 'img', 'aria-label': `${t.name} addresses ${shortTitle(r)}` });
        dot.addEventListener('click', () => ctx.open('tool', t.id));
        dot.addEventListener('keydown', (e) => { if (e.key === 'Enter') ctx.open('tool', t.id); });
        tooltip(dot, () => `${t.name} → ${shortTitle(r)}`);
        td.append(dot);
      }
      return td;
    })));

  const foot = h('tr', {}, h('th', { class: 'rowhead', scope: 'row' }, 'Tools shown per question'),
    rqs.map((r) => h('td', { class: 'cell' }, String(tools.filter((t) => (t.research_questions || []).includes(r.id)).length))));

  main.append(h('div', { class: 'matrix-wrap' }, h('table', { class: 'matrix' },
    h('thead', {}, head), h('tbody', {}, body), h('tfoot', {}, foot))));
}
