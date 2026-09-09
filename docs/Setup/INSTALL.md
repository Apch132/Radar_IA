# Installation — Radar IA

Version de référence : **1.0**  
Source officielle : [`handoff.md`](../handoff.md)  
Tag déploiement validé : **`ubuntu-deploy-v1`** (première plateforme Ubuntu)  
Runtime d’exploitation validé : Compose Linux (`network_mode: host`, Ollama `127.0.0.1`, bind mount PG via `POSTGRES_DATA_PATH`)

Procédure d’installation et de lancement du monorepo **v1.0** (modules 001–010 livrés).

Documents liés : [`CONFIGURATION.md`](CONFIGURATION.md), [`SECURITY.md`](../Reference/SECURITY.md), [`ROADMAP.md`](../Project/ROADMAP.md), [`../README.md`](../../README.md).

---

## Prérequis

| Composant | Exigence |
|-----------|----------|
| Node.js | **LTS** (≥ 20) |
| Gestion monorepo | **npm Workspaces** |
| Conteneurs | **Docker Compose** (Linux / Ubuntu pour le compose d’exploitation) |
| Base de données | **PostgreSQL** (Compose ou hors dépôt) |
| LLM | **Ollama partagé** sur l’hôte (`127.0.0.1:11434`) |
| Modèle | **Ministral 3 3B** (Modelfile dédié) |
| Runtime | **TypeScript** · **Fastify** · **discord.js** · **Prisma** |

Également requis pour l’exploitation Discord : un bot Discord configuré (voir [`DISCORD.md`](../Architecture/DISCORD.md) et [`CONFIGURATION.md`](CONFIGURATION.md)).

---

## Docker

Fichier : `docker-compose.yml` à la racine (configuration **validée sur Ubuntu**).

| Service | Rôle |
|---------|------|
| `postgres` | PostgreSQL 16 — bind `127.0.0.1` ; données via `POSTGRES_DATA_PATH` (défaut `./data/postgres`) |
| `bot` | Bot Discord **permanent** (sans profile) — mode d’exécution normal |
| `worker` (profile `worker`) | Worker pipeline **optionnel** — cycles automatiques |

Réseau et Ollama :

- **bot** et **worker** : `network_mode: host` (Linux) ;
- `DATABASE_URL` / Ollama via **`127.0.0.1`** (pas `host.docker.internal`) ;
- Compose force `OLLAMA_BASE_URL=http://127.0.0.1:11434` pour bot et worker ;
- PostgreSQL reste sur le réseau Compose `radar-ia` + ports loopback.

Autres points :

- PostgreSQL **hors dépôt** (`POSTGRES_DATA_PATH`, défaut `./data/postgres`) ; sauvegardes hors dépôt ;
- Ollama **partagé** (pas de service Compose dédié) ;
- **API** : processus hôte uniquement (`npm run dev -w @radar-ia/api`) ;
- Prérequis Node : `npm install` + `npm run build` (mount `:ro` — `dist/` requis) ;
- `SOURCES_REGISTRY_PATH` relatif résolu depuis la **racine monorepo**.

---

## Variables nécessaires

```bash
cp .env.example .env
cp config/sources.example.json config/sources.json
```

Domaines obligatoires : PostgreSQL (`DATABASE_URL`, `POSTGRES_*`) ; Discord ; Ollama (`OLLAMA_MODEL`, `OLLAMA_MAX_CONCURRENCY=1`) ; sources.

Liste nominative : [`CONFIGURATION.md`](CONFIGURATION.md).

---

## Lancement (exploitation)

1. Prérequis (Node 20, Docker Compose, Ollama + Ministral 3 3B).
2. `.env` + `config/sources.json` (secrets hors dépôt).
3. Une seule inférence Ollama simultanée.
4. Migrer, builder, démarrer Compose.

```bash
npm install
npm run prisma:generate
npm run prisma:migrate:deploy
npm run build
docker compose up -d                              # postgres + bot
docker compose --profile worker up -d worker      # optionnel — cycles auto
```

### Automatisation (worker)

- Premier cycle ≈ **5 s** après ready (`WORKER_INITIAL_DELAY_MS`, défaut 5000).
- Puis un cycle toutes les **15 min** par défaut (`WORKER_CYCLE_INTERVAL_MS=900000`), après la fin du cycle précédent.
- `/radar-admin cycle` = déclenchement **manuel** de contrôle — **non requis** pour l’exploitation normale.
- Un refus `concurrent_lock` est **normal** si un cycle auto est déjà en cours.
- Une publication Discord n’apparaît que si un nouvel article franchit collecte → déduplication → matching → analyse → décision de publication.

### Reprise après incident Ollama

- Les articles déjà rattachés à un dossier ne sont **pas** re-matchés aux cycles suivants.
- Analyse échouée (ex. Ollama indisponible) : reprendre via `/radar-admin reanalyse` (confirm requis).
- Publication partielle : reprise auto en fin de cycle + `/radar-admin resume`.

Développement bot (hors Compose) : `npm run dev -w @radar-ia/bot`.  
Worker one-shot / debug hôte : `npm run dev:worker`.

Arrêt : `docker compose down` (données PG persistent sur le bind mount `POSTGRES_DATA_PATH`).

---

## Commandes principales

| Domaine | Commande |
|---------|----------|
| Dépendances | `npm install` |
| Générer Prisma Client | `npm run prisma:generate` |
| Migrations | `npm run prisma:migrate:deploy` |
| Build monorepo | `npm run build` (ordre topologique) |
| Tests | `npm test` |
| Postgres + bot | `docker compose up -d` |
| Worker Compose | `docker compose --profile worker up -d worker` |
| Logs bot | `docker compose logs -f bot` |
| Logs worker | `docker compose --profile worker logs -f worker` |
| Bot (dev hôte) | `npm run dev -w @radar-ia/bot` |
| Worker (dev hôte) | `npm run dev:worker` |
| API (dev) | `npm run dev -w @radar-ia/api` |

---

## Build monorepo

Les packages `@radar-ia/*` exposent uniquement `dist/` via `package.json#exports` (`moduleResolution: NodeNext`).  
`npm run build` compile en **ordre topologique** :

`shared` → `config` → `analysis` → `collector` → `database` → `api` → `bot` → `worker`

Le build de `@radar-ia/database` exécute d’abord `prisma generate` (résolution CLI compatible hoist npm Workspaces). Sans client Prisma généré, `tsc` échoue avec des dizaines d’erreurs `TS2305` / `TS2307` sur `@prisma/client`.

Après `npm run clean`, lancer `npm run build` **avant** `npm run typecheck`.

---

## Résolution des problèmes courants

| Symptôme | Pistes |
|----------|--------|
| `registry_invalid` / `sources.total: 0` | `config/sources.json` à la racine ; rebuild `@radar-ia/config` |
| Crash HTTP 304 | rebuild `@radar-ia/collector` (null-body statuses) |
| Bot / worker n’atteint pas Ollama | `OLLAMA_BASE_URL=http://127.0.0.1:11434` ; Ollama écoute sur l’hôte ; `network_mode: host` |
| `concurrent_lock` | Normal si un cycle auto tourne déjà — attendre la fin |
| Dossier sans analyse après panne Ollama | `/radar-admin reanalyse` (pas un re-cycle silencieux) |
| Pas de message Discord | Pas forcément une erreur : seuils matching / analyse / décision publication |
| Slash admin refusées | `DISCORD_ADMIN_USER_IDS` |
| Tentative d’ajout de réseaux sociaux | Refuser — exclusion gelée |
| ~70 erreurs `TS2305`/`TS2307` dans `@radar-ia/database` sur `@prisma/client` | Client Prisma non généré ou CLI introuvable après hoist — `npm run build` (génère Prisma) ou `npm run prisma:generate` |

---

## Suite

Roadmap **001–009** et module **010** terminés. Suite selon arbitration concepteur. Voir [`ROADMAP.md`](../Project/ROADMAP.md) et [`handoff.md`](../handoff.md).
