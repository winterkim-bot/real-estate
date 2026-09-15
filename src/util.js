/** 가벼운 DOM/포맷 유틸. 프레임워크 없이 쓰기 위한 최소한의 도구들. */

/** el('div.card', { onclick }, [자식…]) 형태로 엘리먼트를 만든다. */
export function el(spec, props = {}, children = []) {
  const [tagPart, ...classes] = spec.split('.');
  const node = document.createElement(tagPart || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function debounce(fn, wait = 300) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function todayISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/** "3일 전"처럼 사람이 읽기 좋은 상대 시각. */
export function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const minute = 60000, hour = 3600000, day = 86400000;
  if (diff < minute) return '방금';
  if (diff < hour) return `${Math.floor(diff / minute)}분 전`;
  if (diff < day) return `${Math.floor(diff / hour)}시간 전`;
  if (diff < day * 30) return `${Math.floor(diff / day)}일 전`;
  return new Date(ts).toLocaleDateString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric' });
}

const CHOSUNG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

/** 한글 문자열의 초성만 뽑는다. "종암동" → "ㅈㅇㄷ" */
export function toChosung(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out += (code >= 0xac00 && code <= 0xd7a3) ? CHOSUNG[Math.floor((code - 0xac00) / 588)] : ch;
  }
  return out;
}

/** 입력이 전부 초성 자모인지 (= 초성 검색을 해야 하는지) 판단. */
export function isChosungQuery(text) {
  const stripped = text.replace(/\s/g, '');
  return stripped.length > 0 && [...stripped].every((ch) => CHOSUNG.includes(ch));
}

export function escapeHTML(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
