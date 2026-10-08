import { describe, expect, it } from 'vitest';
import { BUILT_HOSTS, STANDALONE_HOSTS, findExternalUrls } from './check-no-network';

const hosts = (text: string) => findExternalUrls('x.ts', text).map((f) => f.host);

describe('findExternalUrls', () => {
  it('flags CDNs, remote fonts, analytics and APIs', () => {
    expect(hosts('<script src="https://cdn.example.com/lib.js"></script>')).toContain(
      'remote resource',
    );
    expect(hosts("@import url('https://fonts.example.com/css?family=X');")).toContain(
      'remote resource',
    );
    expect(hosts("fetch('https://api.example.org/v1/items')")).toEqual(['api.example.org']);
    expect(hosts('const u = "//tracker.example.net/pixel.gif";')).toEqual(['tracker.example.net']);
    expect(hosts("navigator.sendBeacon('http://metrics.example.io/collect')")).toEqual([
      'metrics.example.io',
    ]);
  });

  it('allows localhost and XML namespaces', () => {
    expect(hosts('http://127.0.0.1:4317/api')).toEqual([]);
    expect(hosts("target: 'http://localhost:5173'")).toEqual([]);
    expect(hosts('<svg xmlns="http://www.w3.org/2000/svg">')).toEqual([]);
  });

  it('allows library message text in built output only', () => {
    const text = 'see https://react.dev/errors/418 and https://reactrouter.com/x';
    expect(hosts(text)).toEqual(['react.dev', 'reactrouter.com']);
    expect(findExternalUrls('dist/a.js', text, BUILT_HOSTS)).toEqual([]);
    expect(findExternalUrls('dist/a.js', 'https://cdn.example.com/x.js', BUILT_HOSTS)).toHaveLength(
      1,
    );
  });

  it('reports the line number', () => {
    const found = findExternalUrls('a.css', 'a {}\nb {}\n@import "https://x.example.com/a.css";');
    expect(found[0]?.line).toBe(3);
  });

  it('ignores plain text that only looks like a name', () => {
    expect(hosts('const file = "index.html"; // see section 3.2')).toEqual([]);
  });
});

describe('the standalone web app', () => {
  const licence =
    ' * See https://emscripten.org/docs/introducing_emscripten/emscripten_license.html';

  it('may carry the names SQLite’s library mentions in its banners, which are never fetched', () => {
    expect(findExternalUrls('dist/standalone/a.js', licence, STANDALONE_HOSTS)).toEqual([]);
  });

  it('is not let off for any other build', () => {
    expect(findExternalUrls('dist/web/a.js', licence, BUILT_HOSTS)).toHaveLength(1);
  });

  it('still flags a real remote resource', () => {
    expect(
      findExternalUrls(
        'dist/standalone/a.html',
        '<script src="https://cdn.example.com/x.js">',
        STANDALONE_HOSTS,
      ),
    ).toHaveLength(1);
  });
});
