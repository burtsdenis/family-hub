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

## Why not Notion / Google / Nextcloud?

The most common question in the feedback, in its three variants — answered honestly.

**Why not Notion or Obsidian?** Those are builders: a blank canvas and
blocks, and the family system is yours to design, maintain — and teach
to a spouse who never asked for a database course. Family Hub is the
opposite trade: an opinionated finished product. Tasks, notes, calendar
and money work a particular way out of the box, with the decisions
already made. If you enjoy building your own system, a builder will
genuinely serve you better; this is for families who want the thing,
not the constructor kit.

**Why not Google Keep + Calendar?** For lists and dates it is honestly
fine. The reason this project exists is money: shared accounts, budgets
with limits, recurring payments and bank reconciliation are the core
here, and no combination of Keep, Calendar and a spreadsheet does that
as one coherent thing. There is also a quieter argument: the family
archive — finances, receipts, private notes — lives in a SQLite file on
your own machine, not in an advertising company's cloud.

**Why not Nextcloud?** Closest in spirit — self-hosted, your data. But
Nextcloud is a platform: an app store, plugins with separate authors and
separate bugs, and real administration overhead. Family Hub is one small
app: one container, one database file, updates that take a minute.
Privacy is structural, not a setting — "private" is enforced
server-side per owner, and there is deliberately no admin backdoor to
read someone else's notes (see [architecture.md](docs/architecture.md)).

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
- **[Family mail](docs/family-mail.md)** — connecting the shared
  household mailbox: a dedicated account or a corner of a personal
  Gmail behind a label.
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

The roadmap lives where you can see and influence it:

- **[Roadmap board](https://github.com/users/burtsdenis/projects/1)** —
  Now / Next / Later at a glance.
- **[v0.2 milestone](https://github.com/burtsdenis/family-hub/milestone/1)** —
  what is being worked on right now.
- **[Issues](https://github.com/burtsdenis/family-hub/issues)** — vote
  with a 👍 on what you want most; that is genuinely how things get
  prioritized here. Want to contribute? Start with
  [good first issue](https://github.com/burtsdenis/family-hub/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).

Coming up next: CSV bank-statement import and shared shopping lists.

## License

[AGPL-3.0](LICENSE). Run it, change it, share it — but if you offer a
modified version to others as a service, its source must be open too.
