# Family Hub

A self-hosted family hub: tasks, notes, calendar and money in one place. Built for a household, not a corporation: one Docker container, one SQLite file, no external services required. Runs on a home machine over the local network or on a cheap VPS with a real domain.

The core is complete and battle-tested by daily family use: accounts and sign-in (password and Google), projects and tasks with a kanban board, notes with attachments and wiki-links, a calendar with recurring events, full-text search, a dashboard, and a money section — accounts with balances, expenses, income, transfers, bank reconciliation, categories, budgets, recurring transactions, receipts.

## A quick look

![The dashboard: the day at a glance](docs/screenshots/dashboard.png)

<table>
  <tr>
    <td><img src="docs/screenshots/tasks.png" alt="Tasks: projects with a kanban board"></td>
    <td><img src="docs/screenshots/calendar.png" alt="Calendar: shared and personal, with recurring events"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/money.png" alt="Money: accounts, spending, budgets and recurring payments"></td>
    <td><img src="docs/screenshots/notes.png" alt="Notes: markdown with wiki-links and attachments"></td>
  </tr>
</table>

## Quick start

At home, with Docker:

```bash
cp .env.example .env
docker compose up -d --build
```

The hub comes up on `http://localhost:8787` and is reachable from other devices on the network by the machine's address. An empty hub offers to create the first account right in the browser — that account becomes the administrator; family members join via single-use invitation links. Data lives **outside the project folder** (`~/.family-hub` or the mounted volume), so updating the code never touches it.

Tagged releases publish a prebuilt multi-arch image (amd64 + arm64, so Raspberry Pi works) to GitHub Container Registry — point `image:` in the compose file at it to skip building:

```bash
docker pull ghcr.io/burtsdenis/family-hub:latest
```

For development:

```bash
npm install
npm run dev
```

Frontend on `http://localhost:5173`, API on `http://localhost:8787`. Vite listens on all interfaces, so tablets and phones on the same network can open `http://<machine-ip>:5173`.

## Documentation

- **[Deploying to a VPS](docs/deploy-vps.md)** — from a blank Ubuntu
  machine to `https://hub.example.com`: server hardening, launch,
  backups, Google sign-in, a public demo, auto-deploy from GitHub.
- **[Running on a home server](docs/home-server.md)** — HTTPS on the
  local network, the `.local` name and Bonjour, updating, backups,
  moving to another machine.
- **[Features](docs/features.md)** — the walkthrough: accounts and
  invitations, tasks, notes, calendar, search, and the money section
  with its semantics (reconciliation, budgets, recurring payments).
- **[Architecture](docs/architecture.md)** — the technical decisions:
  SQLite and migrations, local wall-clock time, money as integers,
  logging, how the demo sandboxes work.

## Demo mode

`DEMO_MODE=true` turns the hub into a public sandbox where every visitor
gets a private throwaway copy of a seeded sample family — one button to
enter, no password, self-cleaning. Details in
[architecture.md](docs/architecture.md); deployment next to a production
hub in [deploy-vps.md](docs/deploy-vps.md).

## Roadmap

Money: CSV bank-statement import. From the original spec: PWA offline mode with a home-screen icon, a kiosk mode for tablets, the morning brief, shared lists, an encrypted private section for documents. Housekeeping: translating code comments to English.

## License

[AGPL-3.0](LICENSE). Run it, change it, share it — but if you offer a
modified version to others as a service, its source must be open too.
