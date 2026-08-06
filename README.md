# Zettel

[![Test](https://github.com/zudaR107/zettel/actions/workflows/test.yml/badge.svg)](https://github.com/zudaR107/zettel/actions/workflows/test.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

Part of the [Hof platform](https://github.com/zudaR107/Hof) — a suite of
self-hosted personal services:

- [`schloss`](https://github.com/zudaR107/schloss) — home page / launcher
- [`schlussel`](https://github.com/zudaR107/schlussel) — auth: accounts, login, tokens
- [`kuvert`](https://github.com/zudaR107/kuvert) — envelope budgeting
- [`tafel`](https://github.com/zudaR107/tafel) — task/project tracking
- **`zettel`** (this repo) — fast markdown note-taking
- [`tor`](https://github.com/zudaR107/tor) — reverse-proxy gateway
- [`schloss-ui`](https://github.com/zudaR107/schloss-ui) — shared frontend components
- [`schloss-server-kit`](https://github.com/zudaR107/schloss-server-kit) — shared backend auth/CORS kit

Zettel ("slip"/"note card" in German — a nod to the *Zettelkasten* method)
is a fast personal note-taking service: markdown notes with a live
preview and `[[wiki-links]]` between them, backed by a backlinks panel.

## How it fits into the platform

Zettel has no login form of its own. An unauthenticated visitor is redirected to
Schlüssel's hosted login page and back; the backend verifies the resulting token itself
against Schlüssel's public key (JWKS) rather than calling back to Schlüssel on every
request. Shared logic (JWKS verification, CORS, PKCE login redirect, the API client,
and the resizable sidebar) comes from
[`schloss-server-kit`](https://github.com/zudaR107/schloss-server-kit) and
[`schloss-ui`](https://github.com/zudaR107/schloss-ui), not duplicated here.

This repo is a pnpm workspace with two packages:

- `backend/` — the Hono + Drizzle/SQLite backend
- `frontend/` — the React frontend

## Features

- **Notes** — a title and markdown content, pin/archive, full-text search.
- **Live preview** — edit/preview/split view, with GitHub-flavored markdown
  and syntax-highlighted code fences.
- **`[[Wiki-links]]`** — `[[Note Title]]` in a note's content resolves to a
  clickable link to the matching note; a backlinks panel on each note lists
  every other note that links to it.
- **Tags** — tag notes and filter the list by tag.

## Status

Notes, live preview, wiki-links/backlinks, and tags are done. Not built
yet: a `Ctrl+K` quick switcher.

## Local development

```sh
git submodule update --init
pnpm install
pnpm --filter @zudar107/schloss-server-kit build
pnpm --filter @zudar107/schloss-ui build
cp .env.example .env
pnpm dev:backend   # backend on http://localhost:3003
pnpm dev:frontend  # frontend on http://localhost:5176
```

```sh
pnpm --filter backend test
pnpm --filter backend lint
pnpm --filter frontend test
pnpm --filter frontend lint
```

### Environment variables

See `.env.example`. The important ones:

| Variable | Purpose |
|---|---|
| `DATABASE_PATH` | SQLite file path (backend) |
| `SCHLUSSEL_JWKS_URL` | Where the backend fetches Schlüssel's public key to verify tokens |
| `JWT_ISSUER` | Must match Schlüssel's own issuer, or every token gets rejected |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist (backend) |
| `VITE_SCHLUSSEL_URL` | Where "sign in" redirects to (baked in at frontend build time) |
| `VITE_SCHLOSS_URL` | Where the header's "На главную" link points to (baked in at frontend build time) |

## Running with Docker

```sh
docker network create schloss-net   # one-time, shared with the other repos
docker compose up -d
```

Neither service publishes a host port — both are reached through the
[tor](https://github.com/zudaR107/tor) gateway (`https://zettel.localhost` in local dev
- tor's Caddy auto-upgrades everything to HTTPS with its own locally-trusted CA), on the
same `schloss-net` network as `schlussel`, `schloss`, `kuvert`, and `tafel`.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
