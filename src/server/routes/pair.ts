import { Hono, type Context } from 'hono';
import { setCookie } from 'hono/cookie';
import type { Env } from '../env';
import { AppError } from '../errors';
import { SESSION_COOKIE } from '../middleware/access';
import type { PhoneAccess } from '../phone/types';

/** A paired phone stays paired for a year; removing it from Settings ends that sooner. */
const SESSION_SECONDS = 365 * 24 * 60 * 60;

const STYLE = `
:root { color-scheme: light dark; }
body { font: 1.125rem/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 28rem; padding: 2rem 1rem; }
h1 { font-size: 1.5rem; margin: 0 0 1rem; }
form { display: flex; flex-direction: column; gap: 0.75rem; margin-top: 1.5rem; }
input, button { font: inherit; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid #888; }
input { text-transform: uppercase; letter-spacing: 0.1em; }
button { background: #2f6f4f; border-color: #2f6f4f; color: #fff; }
.problem { border-left: 4px solid #b3261e; padding-left: 0.75rem; }
`;

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The pairing page: plain HTML that needs no script, because the phone has no session yet. */
function page(problem: string | null): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pair this device · Mossnote</title>
<link rel="stylesheet" href="/pair/style.css">
</head>
<body>
<main>
<h1>Pair this device with Mossnote</h1>
<p>On the computer where Mossnote runs, open Settings, then Phone, and choose &ldquo;Show pairing code&rdquo;. Scan the QR code with this device&rsquo;s camera, or type the code here.</p>
${problem ? `<p class="problem" role="alert">${escape(problem)}</p>` : ''}
<form method="get" action="/pair">
<label for="code">Pairing code</label>
<input id="code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" required>
<button type="submit">Pair this device</button>
</form>
</main>
</body>
</html>`;
}

const PROBLEMS = {
  invalid: "That code isn't right. Check it and try again.",
  expired: 'That code has expired. Make a new one on the computer.',
  locked: 'Too many wrong codes. Wait a minute, then try again.',
} as const;

const respondPage = (c: Context<Env>, problem: string | null, status: 200 | 400 | 429) => {
  c.header('Cache-Control', 'no-store');
  return c.html(page(problem), status);
};

/**
 * `/pair`: where a phone exchanges a one-time code for a session. Reached from the QR code
 * (`/pair?code=…`) or by typing the code into the form. Anything else about the app stays locked
 * until this has been done.
 */
export const pairRoutes = (phone: PhoneAccess) =>
  new Hono<Env>()
    .use('*', async (_c, next) => {
      if (!phone.isEnabled()) throw new AppError('not_found', 'Not found.');
      await next();
    })
    .get('/style.css', (c) => c.body(STYLE, 200, { 'Content-Type': 'text/css; charset=utf-8' }))
    .get('/', (c) => {
      const code = c.req.query('code');
      if (code === undefined) return respondPage(c, null, 200);
      const result = phone.redeemCode(code, c.req.header('user-agent'));
      if (!result.ok) {
        return respondPage(c, PROBLEMS[result.reason], result.reason === 'locked' ? 429 : 400);
      }
      setCookie(c, SESSION_COOKIE, result.token, {
        httpOnly: true,
        sameSite: 'Strict',
        path: '/',
        maxAge: SESSION_SECONDS,
      });
      c.header('Cache-Control', 'no-store');
      return c.redirect('/', 303);
    });
