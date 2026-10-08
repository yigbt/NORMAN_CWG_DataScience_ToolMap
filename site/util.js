// Shared helpers. All catalogue content is community-submitted: build DOM with h() (textContent), never innerHTML.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'href') el.setAttribute('href', safeUrl(v));
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Only http(s), mailto and in-page links are rendered as links. */
export function safeUrl(u) {
  const s = String(u || '').trim();
  return /^(https?:\/\/|mailto:|#)/i.test(s) ? s : '#';
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

let tipEl;
export function tooltip(target, textFn) {
  tipEl ??= document.getElementById('tooltip');
  const show = (e) => {
    tipEl.textContent = textFn();
    tipEl.hidden = false;
    move(e);
  };
  const move = (e) => {
    const x = e.clientX ?? target.getBoundingClientRect().right;
    const y = e.clientY ?? target.getBoundingClientRect().top;
    const w = tipEl.offsetWidth;
    tipEl.style.left = Math.min(x + 12, window.innerWidth - w - 8) + 'px';
    tipEl.style.top = (y + 14) + 'px';
  };
  const hide = () => { tipEl.hidden = true; };
  target.addEventListener('mouseenter', show);
  target.addEventListener('mousemove', move);
  target.addEventListener('mouseleave', hide);
  target.addEventListener('focus', show);
  target.addEventListener('blur', hide);
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Element.append() that skips null/undefined/false (native append would print "null"). */
export function put(el, ...kids) {
  el.append(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  return el;
}
