// Optional helpers for the documentation. Every page reads fine without this file: it only adds
// a search box (from search-index.json), marks the section being read in "On this page", and
// closes the mobile menu after a link is followed.
(() => {
  const root = document.documentElement.dataset.root || './';

  // ---- "On this page": mark the heading nearest the top ----
  const links = [...document.querySelectorAll('.toc:not(.toc-inline) a')];
  if (links.length > 0 && 'IntersectionObserver' in window) {
    const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
    const visible = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = [...byId.keys()].find((id) => visible.has(id));
        if (first) {
          for (const a of links) a.removeAttribute('aria-current');
          byId.get(first).setAttribute('aria-current', 'true');
        }
      },
      { rootMargin: '-72px 0px -70% 0px' },
    );
    for (const id of byId.keys()) {
      const heading = document.getElementById(id);
      if (heading) observer.observe(heading);
    }
  }

  // ---- Search ----
  const form = document.getElementById('docs-find');
  const input = document.getElementById('docs-find-input');
  const list = document.getElementById('docs-find-results');
  if (!form || !input || !list || !('fetch' in window)) return;
  form.hidden = false;

  let index = null;
  let loading = null;
  const load = () => {
    loading ??= fetch(`${root}search-index.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        index = data;
      })
      .catch(() => {
        index = [];
      });
    return loading;
  };

  const score = (entry, words) => {
    const title = entry.t.toLowerCase();
    const heads = entry.h.join(' ').toLowerCase();
    const text = entry.x.toLowerCase();
    let total = 0;
    for (const w of words) {
      let s = 0;
      if (title.includes(w)) s += 10;
      if (heads.includes(w)) s += 4;
      if (text.includes(w)) s += 1;
      if (s === 0) return 0;
      total += s;
    }
    return total;
  };

  const snippet = (entry, words) => {
    const text = entry.x;
    const lower = text.toLowerCase();
    const at = lower.indexOf(words[0]);
    if (at < 0) return entry.s;
    const start = Math.max(0, at - 40);
    return `${start > 0 ? '…' : ''}${text.slice(start, start + 110)}…`;
  };

  let selected = -1;
  const show = (items) => {
    list.replaceChildren();
    selected = -1;
    if (items === null) {
      list.hidden = true;
      return;
    }
    if (items.length === 0) {
      const none = document.createElement('li');
      none.className = 'none';
      none.textContent = 'Nothing found. Try fewer or different words.';
      list.append(none);
    }
    for (const { entry, words } of items) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `${root}${entry.u}`;
      const strong = document.createElement('strong');
      strong.textContent = entry.t;
      const small = document.createElement('small');
      small.textContent = snippet(entry, words);
      a.append(strong, small);
      li.append(a);
      list.append(li);
    }
    list.hidden = false;
  };

  const run = async () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) return show(null);
    await load();
    const words = q.split(/\s+/);
    const found = index
      .map((entry) => ({ entry, words, s: score(entry, words) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8);
    show(found);
  };

  input.addEventListener('focus', () => void load());
  input.addEventListener('input', () => void run());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const first = list.querySelector('a');
    if (first) window.location.href = first.href;
  });
  input.addEventListener('keydown', (e) => {
    const items = [...list.querySelectorAll('a')];
    if (e.key === 'Escape') {
      show(null);
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length > 0) {
      e.preventDefault();
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((a, i) => a.setAttribute('aria-selected', String(i === selected)));
      items[selected].focus();
    }
  });
  list.addEventListener('keydown', (e) => {
    const items = [...list.querySelectorAll('a')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < items.length - 1) {
      e.preventDefault();
      items[i + 1].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (i > 0 ? items[i - 1] : input).focus();
    } else if (e.key === 'Escape') {
      input.focus();
      show(null);
    }
  });
  document.addEventListener('click', (e) => {
    if (!form.contains(e.target)) show(null);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) {
      e.preventDefault();
      input.focus();
    }
  });
})();
