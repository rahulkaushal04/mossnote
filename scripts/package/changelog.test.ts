import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** The changelog is shown on the release page, so it may only promise what the app does. */
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('what the changelog says about questions', () => {
  it('does not offer a state the app lacks: a question is open or solved', () => {
    const changelog = read('CHANGELOG.md');
    const line = changelog.split('\n').find((l) => l.includes('Discoveries and questions'));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/ignored|dismissed|snoozed|archived/i);
    expect(line).toMatch(/open or solved/);
  });

  it('is not argued with by the docs, which only need to state what the app has', () => {
    const page = read('docs/content/questions-and-discoveries.html');
    expect(page).not.toMatch(/changelog/i);
    expect(page).toContain('<em>open</em> or <em>solved</em>');
  });
});
