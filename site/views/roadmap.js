import { h, put, tooltip } from '../util.js';
import { openForm } from '../form.js';

const PRIO = { high: 0, medium: 1, low: 2 };

export function render(main, ctx) {
  const rqs = ctx.all('research_question');
  const count = (r) => ctx.toolsFor(r.id).length;
  const sorter = (a, b) => (PRIO[a.roadmap?.priority] ?? 3) - (PRIO[b.roadmap?.priority] ?? 3)
    || (b.survey_demand?.q8_need ?? -1) - (a.survey_demand?.q8_need ?? -1) || a.title.localeCompare(b.title);
  const pred = rqs.filter((r) => r.category === 'prediction').sort(sorter);
  const cross = rqs.filter((r) => r.category !== 'prediction').sort(sorter);
  const scale = Math.max(1, ...rqs.flatMap((r) => [r.survey_demand?.q8_need || 0, r.survey_demand?.q6_have_tool || 0, count(r)]));
  const gaps = pred.filter((r) => count(r) === 0);

  put(main,
    h('p', { class: 'muted' }, 'Each research question with its demand from the 2025 survey, the tools currently in the catalogue, and the agreed next steps. ',
      'Priorities and next steps are edited like any other entry (Suggest edit → curator review).'),
    gaps.length ? h('p', { class: 'note' }, `Not yet covered by any catalogued tool: ${gaps.map((r) => r.short_title || r.title).join(', ')}.`) : null,
    h('h2', { class: 'section-title' }, 'Prediction needs'), h('div', { class: 'rm' }, pred.map((r) => row(ctx, r, scale))),
    h('h2', { class: 'section-title' }, 'Cross-cutting topics'), h('div', { class: 'rm' }, cross.map((r) => row(ctx, r, scale))));
}

function bar(label, value, scale, color, tip) {
  const el = h('div', { class: 'bar' }, h('span', {}, label),
    h('span', { class: 'track' }, h('span', { class: 'fill', style: `width:${(100 * value) / scale}%;background:${color}` })),
    h('span', { class: 'num' }, String(value)));
  tooltip(el, () => tip);
  return el;
}

function row(ctx, r, scale) {
  const rm = r.roadmap || {};
  const sd = r.survey_demand;
  const tools = ctx.toolsFor(r.id);
  const byMat = {};
  for (const t of tools) byMat[t.maturity] = (byMat[t.maturity] || 0) + 1;
  const matOrder = Object.keys(ctx.data.vocab.maturity).reverse();

  return h('article', { class: 'rm-row' },
    h('div', {},
      h('h3', {}, h('button', { type: 'button', onclick: () => ctx.open('research_question', r.id) }, r.short_title || r.title)),
      h('div', { class: 'chips' },
        h('span', { class: `badge prio-${rm.priority}` }, `Priority: ${ctx.label('priority', rm.priority)}`),
        h('span', { class: 'badge' }, ctx.label('roadmap_status', rm.status))),
      h('p', { class: 'small muted', style: 'margin:6px 0 0' }, r.title),
      rm.lead ? h('p', { class: 'small', style: 'margin:4px 0 0' }, `Lead: ${rm.lead}`) : null),
    h('div', { class: 'bars' },
      sd ? bar('Survey: urgent', sd.q8_need, scale, 'var(--blue)', `${sd.q8_need} of ${sd.q8_respondents} respondents named this as urgent (Q8)`) : null,
      sd ? bar('Survey: have tool', sd.q6_have_tool, scale, 'var(--orange)', `${sd.q6_have_tool} respondents reported own tools for this (Q6)`) : null,
      bar('In catalogue', tools.length, scale, 'var(--aqua)', `${tools.length} tool(s) currently linked in the catalogue`),
      !sd ? h('span', { class: 'small' }, 'No survey item (raised in free-text answers).') : null),
    h('div', {},
      h('div', { class: 'small muted' }, tools.length
        ? matOrder.filter((m) => byMat[m]).map((m) => `${byMat[m]} ${ctx.label('maturity', m).toLowerCase()}`).join(' · ')
        : 'No tool yet'),
      rm.next_steps?.length
        ? h('ul', { class: 'steps' }, rm.next_steps.map((s) => h('li', {}, s)))
        : h('p', { class: 'small', style: 'margin:6px 0 0' }, 'No next steps defined. ',
          h('button', { class: 'btn link', type: 'button', onclick: () => openForm(ctx, 'research_question', r) }, 'Suggest some'))));
}
