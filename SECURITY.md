# Security policy

## Reporting a vulnerability

Please report it privately. Open the **Security** tab of this repository, choose **Report a vulnerability**, and describe what you found. Or use this link: https://github.com/rahulkaushal04/mossnote/security/advisories/new

Please do not open a public issue or pull request for a vulnerability, and do not post details anywhere public until a fix is out.

A useful report has:

- what the problem is and which part of the app it touches
- steps to reproduce it, or a small proof of concept
- what an attacker could do with it
- the commit or version you tested, and your operating system, browser and Node version

This is a volunteer project. I will aim to reply within a week and to fix serious problems first, but I cannot promise a timetable. If you want credit when the fix is published, say so in your report.

## Supported versions

Mossnote has no public release yet. Fixes go to `main`, and once releases exist, to the latest release. Run the newest version to get them.

## What Mossnote is, and what it is not

Mossnote is a single-user tool that runs on your own computer, or in your own browser. That shapes what counts as a vulnerability.

By default the server listens on loopback (`127.0.0.1`) only and has no login. It refuses to start on any other address unless you set `MOSS_ALLOW_REMOTE=1`, which prints a warning and is not supported. Do not expose it to a network that way.

The supported way to reach it from a phone or tablet is **phone access**, which is off until you turn it on in Settings (or start with `--lan`). While it is on, the server listens on every network interface, and the rules change as follows:

- **This computer is trusted; every other device must be paired.** Who is "this computer" is decided from the address on the other end of the connection, never from a header the sender chooses. A request whose sender cannot be determined is treated as another device.
- **Pairing.** A one-time code (50 bits, readable alphabet) is shown as a QR code on the computer. It works once, expires after ten minutes, and ten wrong tries lock pairing for a minute. Exchanging it sets a session cookie (`HttpOnly`, `SameSite=Strict`). The server keeps only a SHA-256 hash of each session token, in `phone-devices.json` in the data folder (mode 0600), and compares in constant time.
- **Management stays on the computer.** Turning phone access off, making codes, and removing devices are refused for paired phones.
- **Host check, widened.** The accepted `Host` values become the computer's own addresses (and `<name>.local`), read live. Any other name is refused, which keeps DNS rebinding out.
- **Plain HTTP.** The connection is not encrypted. Anyone who can watch your network traffic can read it, and can steal a paired phone's cookie. Use it on a network you trust, and remove devices you no longer use.

The web version (`npm run build:standalone`) has no server at all: the journal lives in the browser and the page's origin is the only thing that can reach it.

What the app does to keep other pages and processes away from your journal:

- **Host check.** Every request must carry an allowed `Host` header. This is the defence against DNS rebinding.
- **Origin check.** If a request has an `Origin` header, it must equal the app's own origin.
- **Custom header on writes.** Anything that changes data needs an `X-Moss-Client` header and a JSON content type. A web page on another site cannot send that without a CORS preflight, and preflights are refused.
- **No CORS.** The server sends no CORS headers, and `OPTIONS` requests are always refused.
- **Strict Content Security Policy.** Scripts may only load from the app itself, and styles get a per-response nonce. The app has no path that renders raw HTML, and ESLint bans `dangerouslySetInnerHTML`.
- **No outgoing connections.** The server does not call out, and a check in CI fails the build if the source or the output contains a non-local URL.
- **No string-built SQL.** Queries use bound parameters, and a lint rule blocks the alternatives.
- **File permissions.** The data folder is created with mode 0700 and the database with mode 0600.

## What is out of scope

These are known and accepted, so reports about them are not vulnerabilities:

- Another program running as you on the same machine can talk to the loopback port. Any local process can also just read your files.
- The database is plain SQLite and is not encrypted. Use full-disk encryption.
- Anything that needs you to run the server on a non-loopback address other than through phone access.
- Anyone who can already read your network traffic while phone access is on (see above: it is plain HTTP).
- In the web version, anything that needs another program with access to your browser profile, which can read the stored journal as it can any site's data.
- Findings that only exist in a development build (`npm run dev`).
- Missing hardening that does not lead to a real attack, such as a header that a local-only server does not need.

## Handling your own data safely

When you report a bug or a vulnerability, please do not include real journal text or your database. Make up some data that shows the problem.
