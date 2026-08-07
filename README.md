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

- **Notes** — a title and markdown content, pinning, soft archive/restore,
  and substring search across titles and content (not an indexed full-text
  engine). Active and archived notes are shown in separate views.
- **Live preview** — edit/preview/split view, with GitHub-flavored markdown
  and syntax-highlighted code fences.
- **`[[Wiki-links]]`** — `[[Note Title]]` in a note's content resolves to a
  clickable link to the matching note; a backlinks panel on each note lists
  every other note that links to it.
- **Tags** — tag notes and filter active or archived lists by an exact tag
  name.
- **Virtual folders** — every tag attached to an active note also appears
  in the sidebar as a folder-style shortcut to the notes list pre-filtered
  to it; not a separate concept from tags, just another way to reach the
  same filter.
- **Quick switcher** — `Ctrl+K` (Windows/Linux) or `Cmd+K` (macOS) opens a
  command palette from anywhere in the app. It searches active-note titles,
  unlike list search, which searches title and content in the current view.
- **Export** — download every note (including archived ones), with its tags,
  as JSON via `GET /users/export`. Scoped to Zettel's own data only, not a
  platform-wide export.
- **Regional profile** — `GET /users/me` exposes Schlüssel's read-only
  `weekStart`, `dateFormat`, and IANA `timezone` JWT claims. Zettel does not
  store or edit them; unset or missing claims are returned as `null`.

## Status

Notes, archive/restore, live preview, wiki-links/backlinks, tags, virtual
folders, `Ctrl+K` quick switching, and scoped JSON export are all done.

## Local development

```sh
git submodule update --init
pnpm install
pnpm --filter @zudar107/schloss-server-kit build
pnpm --filter @zudar107/schloss-ui build
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

`.env.example` contains Docker Compose substitutions. Direct backend runs
use the defaults shown below unless the variables are exported in the shell;
the backend does not load `.env` itself. Vite does load `.env`, but only
exposes variables prefixed with `VITE_` to frontend code.

| Variable | Purpose |
|---|---|
| `DATABASE_PATH` | SQLite file path when running the backend directly |
| `SCHLUSSEL_JWKS_URL` | Where the backend fetches Schlüssel's public key to verify tokens |
| `JWT_ISSUER` | Must match Schlüssel's own issuer, or every token gets rejected |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist when running the backend directly |
| `ZETTEL_ALLOWED_ORIGINS` | CORS allowlist passed to the backend by Docker Compose |
| `SCHLUSSEL_WEB_URL` | Schlüssel browser URL baked into the frontend by Docker Compose |
| `SCHLOSS_URL` | Schloss home URL baked into the frontend by Docker Compose |

For a direct Vite build, the corresponding build-time variables are
`VITE_SCHLUSSEL_URL` and `VITE_SCHLOSS_URL`; their local defaults are
`http://localhost:4001` and `http://localhost:3000`, respectively.

Authenticated `GET /users/me` responses also carry the regional profile
claims from the verified Schlüssel token: `weekStart` is `monday`, `sunday`,
or `null`; `dateFormat` is `dmy`, `mdy`, `ymd`, or `null`; and `timezone` is
a valid IANA identifier or `null`. Missing claims are normalized to `null`.
A malformed regional claim invalidates the token and returns `401`.

`DELETE /notes/{id}` archives rather than permanently deletes a note.
`POST /notes/{id}/restore` restores only an archived note owned by the caller;
it returns `404` for a missing id, another user's note, or an active note.

## Running with Docker

```sh
docker network create schloss-net   # one-time, shared with the other repos
cp .env.example .env
docker compose up -d
```

Neither service publishes a host port — both are reached through the
[tor](https://github.com/zudaR107/tor) gateway (`https://zettel.localhost` in local dev
- tor's Caddy auto-upgrades everything to HTTPS with its own locally-trusted CA), on the
same `schloss-net` network as `schlussel`, `schloss`, `kuvert`, and `tafel`.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
