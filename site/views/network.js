import { h, put, cssVar } from '../util.js';
import { shortTitle } from './matrix.js';

let cy = null;
let showPubs = false;
let showLabels = true;

export function render(main, ctx) {
  const ctl = h('div', { class: 'net-controls' },
    h('label', {}, h('input', { type: 'checkbox', checked: showPubs, onchange: (e) => { showPubs = e.target.checked; ctx.rerender(); } }), ' show publications'),
    h('label', {}, h('input', { type: 'checkbox', checked: showLabels, onchange: (e) => { showLabels = e.target.checked; ctx.rerender(); } }), ' tool labels'),
    h('button', { class: 'btn', type: 'button', onclick: () => cy?.fit(undefined, 30) }, 'Fit'),
    h('div', { class: 'legend' },
      h('span', {}, h('span', { class: 'sw', style: 'background:var(--blue)' }), 'research question (size = survey demand; dashed = no tool yet)'),
      h('span', {}, h('span', { class: 'sw', style: 'background:var(--orange);border-radius:50%' }), 'tool / model'),
      h('span', {}, h('span', { class: 'sw', style: 'background:var(--aqua);clip-path:polygon(50% 0,100% 100%,0 100%)' }), 'dataset'),
      showPubs ? h('span', {}, h('span', { class: 'sw', style: 'background:var(--gray);transform:rotate(45deg) scale(.8)' }), 'publication') : null));
  const wrap = h('div', { class: 'net-wrap' }, h('div', { id: 'cy', role: 'img', 'aria-label': 'Network of research questions, tools and datasets. Use the Catalogue or Matrix view for an accessible list.' }));
  put(main, ctl, wrap);

  if (typeof window.cytoscape !== 'function') {
    // the CDN script is deferred; retry once it has loaded
    if (document.readyState !== 'complete') { window.addEventListener('load', () => ctx.rerender(), { once: true }); return; }
    wrap.replaceChildren(h('p', { class: 'empty' }, 'The network library could not be loaded. Use the Catalogue or Matrix view.'));
    return;
  }

  const tools = ctx.filtered('tool');
  const datasets = ctx.filtered('dataset');
  const rqs = ctx.all('research_question');
  const maxNeed = Math.max(1, ...rqs.map((r) => r.survey_demand?.q8_need || 0));
  const els = [];
  for (const r of rqs) {
    const need = r.survey_demand?.q8_need ?? 0;
    els.push({ data: { id: `research_question:${r.id}`, type: 'research_question', key: r.id, label: shortTitle(r),
      size: 34 + 40 * (need / maxNeed), gap: ctx.toolsFor(r.id).length === 0 ? 1 : 0 } });
  }
  const pubsUsed = new Set();
  for (const t of tools) {
    els.push({ data: { id: `tool:${t.id}`, type: 'tool', key: t.id, label: t.name.length > 42 ? t.name.slice(0, 40) + '…' : t.name } });
    for (const rq of t.research_questions || []) els.push({ data: { source: `tool:${t.id}`, target: `research_question:${rq}`, kind: 'rq' } });
    if (showPubs) for (const d of t.publications || []) {
      pubsUsed.add(d);
      els.push({ data: { source: `tool:${t.id}`, target: `publication:${d}`, kind: 'pub' } });
    }
  }
  for (const d of pubsUsed) {
    const p = ctx.get('publication', d);
    els.push({ data: { id: `publication:${d}`, type: 'publication', key: d, label: p ? `${(p.authors || '').split(/[;,]/)[0]} ${p.year}` : d } });
  }
  for (const d of datasets) {
    els.push({ data: { id: `dataset:${d.id}`, type: 'dataset', key: d.id, label: d.name } });
    for (const rq of d.research_questions || []) els.push({ data: { source: `dataset:${d.id}`, target: `research_question:${rq}`, kind: 'rq' } });
  }

  const c = { ink: cssVar('--ink'), ink2: cssVar('--ink-2'), surface: cssVar('--surface'), blue: cssVar('--blue'),
    orange: cssVar('--orange'), aqua: cssVar('--aqua'), gray: cssVar('--gray'), border: cssVar('--border'), focus: cssVar('--focus') };
  cy?.destroy();
  cy = window.cytoscape({
    container: document.getElementById('cy'),
    elements: els,
    style: [
      { selector: 'node', style: { 'label': 'data(label)', 'color': c.ink, 'font-size': 12, 'text-wrap': 'wrap', 'text-max-width': 120,
        'text-valign': 'bottom', 'text-margin-y': 4, 'text-background-color': c.surface, 'text-background-opacity': 0.8,
        'text-background-padding': 1, 'border-width': 2, 'border-color': c.surface, 'min-zoomed-font-size': 5 } },
      { selector: 'node[type="research_question"]', style: { 'shape': 'round-rectangle', 'background-color': c.blue, 'width': 'data(size)',
        'height': 'data(size)', 'font-size': 15, 'font-weight': 600, 'z-index': 10 } },
      { selector: 'node[type="research_question"][gap = 1]', style: { 'background-opacity': 0.25, 'border-color': c.blue, 'border-style': 'dashed' } },
      { selector: 'node[type="tool"]', style: { 'shape': 'ellipse', 'background-color': c.orange, 'width': 18, 'height': 18,
        'label': showLabels ? 'data(label)' : '' } },
      { selector: 'node[type="dataset"]', style: { 'shape': 'triangle', 'background-color': c.aqua, 'width': 22, 'height': 22 } },
      { selector: 'node[type="publication"]', style: { 'shape': 'diamond', 'background-color': c.gray, 'width': 12, 'height': 12, 'font-size': 8 } },
      { selector: 'edge', style: { 'width': 1.5, 'line-color': c.border, 'curve-style': 'haystack', 'opacity': 0.9 } },
      { selector: 'edge[kind="pub"]', style: { 'line-style': 'dotted' } },
      { selector: '.faded', style: { 'opacity': 0.15 } },
      { selector: 'node.hl', style: { 'border-color': c.focus, 'border-width': 4, 'label': 'data(label)' } },
      { selector: 'edge.hl', style: { 'line-color': c.ink2, 'width': 2.5 } },
    ],
    layout: { name: 'cose', animate: false, randomize: false, nodeRepulsion: () => 9000, idealEdgeLength: () => 70,
      nodeOverlap: 12, padding: 30, componentSpacing: 120 },
  });
  cy.on('tap', 'node', (e) => ctx.open(e.target.data('type'), e.target.data('key')));
  cy.on('mouseover', 'node', (e) => focusOn(e.target));
  cy.on('mouseout', 'node', () => focusOn(null));
  const [, , type, id] = location.hash.split('/');
  if (type && id) highlight(type, decodeURIComponent(id));
}

function focusOn(node) {
  if (!cy) return;
  cy.elements().removeClass('faded hl');
  if (!node) return;
  const hood = node.closedNeighborhood();
  cy.elements().not(hood).addClass('faded');
  hood.addClass('hl');
}

export function highlight(type, id) {
  if (!cy) return;
  const node = type ? cy.getElementById(`${type}:${id}`) : null;
  focusOn(node && node.nonempty() ? node : null);
}
