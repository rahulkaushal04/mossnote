// Deterministic 200-document corpus; no files committed, no randomness beyond a seeded PRNG.
export interface CorpusDoc {
  name: string;
  text: string;
}

function rng(seed: number) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

const bodies: string[] = [
  '# Title\n\nSome *emph* and **strong** text.\n\n- a\n- b\n  - c\n',
  '---\ntitle: Hi\ntags: [a, b]\n---\n\n# Body\n\ntext\n',
  '```ts\nconst x = 1;\n\n\tindented\n```\n\nafter fence\n',
  '| a | b |\n|---|:-:|\n| 1 | 2 |\n| 3 | 4 |\n',
  '<div class="x">\n  <p>html block</p>\n</div>\n\npara\n',
  'tabs:\n\t- one\n\t\t- two\n',
  'trailing spaces  \nhard break above   \n   \nlast',
  'emoji 😀👩‍👩‍👧‍👦 café naïve 日本語 é ​ zero-width\n',
  'RTL: שלום עולם مرحبا بالعالم ‫mixed‬ text\n',
  '> quote\n>\n> more\n\n1. one\n2. two\n\n[link](http://x.y "t") ![img](a.png)\n',
];

const endings = ['\n', '\r\n', 'mixed', 'cr'] as const;

export function makeCorpus(): CorpusDoc[] {
  const r = rng(42);
  const docs: CorpusDoc[] = [{ name: 'empty', text: '' }];
  docs.push({ name: 'only-newline', text: '\n' }, { name: 'only-crlf', text: '\r\n' });
  docs.push({ name: 'only-bom', text: '﻿' }, { name: 'lone-cr', text: 'a\rb\r' });
  docs.push({ name: 'long-line', text: 'x'.repeat(200_000) + '\n' });
  docs.push({ name: 'long-line-no-nl', text: 'word '.repeat(50_000) });
  for (let i = 0; docs.length < 200; i++) {
    let text = bodies[i % bodies.length]!;
    if (r() < 0.3) text += '\n' + bodies[Math.floor(r() * bodies.length)]!;
    const ending = endings[Math.floor(r() * endings.length)]!;
    if (ending === 'mixed') {
      let n = 0;
      text = text.replace(/\n/g, () => (n++ % 2 ? '\r\n' : '\n'));
    } else if (ending === 'cr') text = text.replace(/\n/g, '\r');
    else text = text.replace(/\n/g, ending);
    if (r() < 0.4)
      text = text.replace(/(\r\n|\r|\n)$/, ''); // no trailing newline
    else if (r() < 0.3) text += ending === 'mixed' || ending === 'cr' ? '\n\n' : ending + ending;
    if (r() < 0.25) text = '﻿' + text;
    docs.push({ name: `doc-${i}`, text });
  }
  return docs;
}
