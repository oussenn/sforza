# Security

## Reporting a problem

Use GitHub's private reporting: the Security tab of this repository, then "Report a vulnerability". Please do not open a public issue for security problems.

## How the app is meant to run

Sforza is self-hosted for one person or a small group. There is no open sign-up: the first account is created on the first visit (on a public address only with `SETUP_TOKEN`), and it invites others with one-time links. People can ask for access on the sign-in page, but a request only leaves an email address for the admin, who decides. Each account only sees its own CVs, knowledge base and board.

## What is in place

- Passwords need 15 or more characters and are stored only as salted PBKDF2-SHA256 hashes, in D1 or in the `AUTH_USERS` secret. Failed sign-ins lock the address after 5 tries and the account after 20, for 15 minutes; wrong setup tokens and invitation codes count too.
- Invitation codes are random (256 bits), work once, expire after 7 days and are stored only as hashes. They travel in the link's `#` fragment, which browsers do not send to servers.
- Requests for access take an email address, a name and a note, cut to size and cleaned of control characters. The sign-in page answers the same whether an address asked before or not. One network can send three an hour (counted apart from failed sign-ins), at most 200 wait at once, and a hidden field drops form-filling bots. Only the admin can list, answer or decline them.
- A new password or a locked account ends that account's sessions, download links and connector access at once.
- Accounts and passwords cannot be managed through the MCP connector.
- Sessions are signed, HttpOnly, Secure, SameSite=Strict cookies. Every write, sign-in included, also needs an `X-Requested-With` header.
- Every database query is scoped to the signed-in account. PDF and share links are signed for one account, one document and one language, and expire.
- Each account has its own MCP connector token, derived from `MCP_TOKEN`.
- Links read by the server (job postings, forms, logos) must be public web addresses: no IP addresses, local names, private DNS answers or odd ports, checked again on every redirect. Responses are read up to a size limit.
- The web app sends a strict Content-Security-Policy and `Cross-Origin-Opener-Policy: same-origin`, and error responses do not include internal details.
- Uploaded photos and signatures are served by link alone, so their ids carry 128 random bits. Images are served with their own sandboxing policy, so an SVG logo can never run scripts.
- Knowledge bases sent to the API are cleaned before they are stored: only lists of entries and text notes, with size limits.
- Dependencies are checked with `npm audit` (0 known vulnerabilities at release).
- The public demo (only with `DEMO_PASSWORD`) never opens a shared account: each sign-in gets its own sandbox of sample data under a random id, deleted after two hours or at sign-out. A sandbox may only use the editor, the board, letters and settings (an allow-list); AI, the AI detector, PDF rendering, link reading, uploads, the connector, passwords and accounts answer 403. New sandboxes are limited per address (3 an hour), at once (20) and per day (60), checked inside one database statement; each sandbox has a budget of 400 writes of up to 300 KB, 12 CVs and 40 cards. Wrong demo passwords lock the address like other failed sign-ins but never the demo itself.
- API keys saved under AI are checked with the provider, then stored encrypted with AES-GCM under a key derived from `SESSION_SECRET` for that account alone (the account name is bound in, so one account's key can't be opened as another's). They are never logged and never sent back: the browser sees the last four characters, and the connector never sees them. The demo cannot save keys.
- AI output is checked against your own material: numbers, tools and skills that are not in your CV or knowledge base are removed.

## Things to know as an operator

- The connector address contains its token. Treat it like a password and change `MCP_TOKEN` if it leaks.
- Changing `SESSION_SECRET` or `AUTH_USERS` signs everyone out and invalidates every link.
- `SETUP_TOKEN` only matters until the first account exists; you can delete it afterwards.
- Job postings are untrusted text that goes into AI prompts. The app never applies or sends anything on its own, but read what an agent drafts before you send it.
- The AI budget in `wrangler.jsonc` is shared by all accounts that use the site's keys. Calls on an account's own key are not counted.
- Changing `SESSION_SECRET` also makes the saved API keys unreadable: the AI page then asks for them again.
- The demo password is public on purpose; the limits above are what protect the site. Changing or removing `DEMO_PASSWORD` ends every demo session at once, and a cron trigger deletes sandboxes that ran out every 30 minutes.
