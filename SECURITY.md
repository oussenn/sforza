# Security

## Reporting a problem

Use GitHub's private reporting: the Security tab of this repository, then "Report a vulnerability". Please do not open a public issue for security problems.

## How the app is meant to run

Sforza is self-hosted for one person or a small group. There is no sign-up: the operator creates accounts with `scripts/new-logins.mjs`. Each account only sees its own CVs, knowledge base and board.

## What is in place

- Passwords are stored as PBKDF2-SHA256 hashes in a Worker secret. Failed sign-ins lock the address after 5 tries and the account after 20, for 15 minutes.
- Sessions are signed, HttpOnly, Secure, SameSite=Strict cookies. Every write, sign-in included, also needs an `X-Requested-With` header.
- Every database query is scoped to the signed-in account. PDF and share links are signed for one account, one document and one language, and expire.
- Each account has its own MCP connector token, derived from `MCP_TOKEN`.
- Links read by the server (job postings, forms, logos) must be public web addresses: no IP addresses, local names, private DNS answers or odd ports, checked again on every redirect. Responses are read up to a size limit.
- The web app sends a strict Content-Security-Policy, and error responses do not include internal details.
- AI output is checked against your own material: numbers, tools and skills that are not in your CV or knowledge base are removed.

## Things to know as an operator

- The connector address contains its token. Treat it like a password and change `MCP_TOKEN` if it leaks.
- Changing `SESSION_SECRET` or `AUTH_USERS` signs everyone out and invalidates every link.
- Job postings are untrusted text that goes into AI prompts. The app never applies or sends anything on its own, but read what an agent drafts before you send it.
- The AI budget in `wrangler.jsonc` is shared by all accounts.
