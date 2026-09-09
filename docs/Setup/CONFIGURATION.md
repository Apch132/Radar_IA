# Configuration — Radar IA

Version de référence : **1.0**  
Source officielle : [`handoff.md`](../handoff.md)

Ce document décrit **quoi** configurer selon les décisions gelées.
Les variables runtime actuellement validées par `@radar-ia/config` sont listées ci-dessous.

Documents liés : [`INSTALL.md`](INSTALL.md), [`SOURCES.md`](../Reference/SOURCES.md), [`DISCORD.md`](../Architecture/DISCORD.md), [`LLM.md`](../Architecture/LLM.md), [`SECURITY.md`](../Reference/SECURITY.md).

---

## Configuration générale

Principes :

- configuration des **sources hors code** ;
- secrets et données sensibles **hors dépôt** ;
- PostgreSQL **hors dépôt** ;
- sauvegardes **hors dépôt** ;
- Ollama **partagé** ;
- modèle unique **Ministral 3 3B** ;
- **une seule** inférence simultanée.

Aucune plateforme Web ni API publique à configurer — hors périmètre.

---

## Variables d'environnement

Le handoff impose l'existence de configurations pour Discord, PostgreSQL, Ollama / LLM et les sources.

| Domaine | Contenu attendu (conceptuel) | Stockage |
|---------|------------------------------|----------|
| Discord | Identifiants bot / cible de publication | Secret, hors dépôt |
| PostgreSQL | Connexion base | Secret, hors dépôt |
| Ollama / LLM | Accès runtime + modèle Ministral 3 3B | Config / secret selon besoin |
| Sources | Liste et paramètres des sources S–E | Hors code |
| Docker Compose | Orchestration Postgres + bot (+ worker optionnel) | `docker-compose.yml` |

Ne jamais committer de secrets.

Variables actuellement prises en charge par `@radar-ia/config` :

- `NODE_ENV`, `LOG_LEVEL`, `API_HOST`, `API_PORT`
- `DATABASE_URL`
- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`
- `DISCORD_CHANNEL_ANNONCES_MAJEURES`, `DISCORD_CHANNEL_VEILLE_PERTINENTE`, `DISCORD_CHANNEL_FLUX_IA`
- `DISCORD_ADMIN_USER_IDS` (allowlist slash admin — snowflakes utilisateur, séparés par des virgules)
- `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_MAX_CONCURRENCY`
- `SOURCES_REGISTRY_PATH`
- `WORKER_SCHEDULER_ENABLED`, `WORKER_CYCLE_INTERVAL_MS`, `WORKER_INITIAL_DELAY_MS`
- `PIPELINE_LOCK_TTL_MS`, `PIPELINE_HEARTBEAT_INTERVAL_MS`, `WORKER_HOLDER_PREFIX`
- `RAW_FEED_RETENTION_PER_SOURCE`, `RAW_FEED_RETENTION_DAYS`

Compose (hors `@radar-ia/config`) : `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DATA_PATH` (bind mount PG, défaut `./data/postgres`).

`API_HOST` défaut : `127.0.0.1` (hors conteneur). Pour Docker, définir explicitement `0.0.0.0` si besoin.
`PIPELINE_HEARTBEAT_INTERVAL_MS` doit être **strictement inférieur** à `PIPELINE_LOCK_TTL_MS / 3`.

---

## Administration Discord (009.1E)

| Variable | Défaut | Rôle |
|----------|--------|------|
| `DISCORD_ADMIN_USER_IDS` | *(vide)* | Allowlist d’IDs utilisateur Discord pour `/radar-admin` (pas de rôles) |

- liste vide → toutes les commandes admin sont refusées ;
- réponses éphémères ; audit append-only côté `@radar-ia/database` ;
- le bot reste un hôte mince (composition des orchestrateurs existants).

---

## Worker / scheduler (009.1D)

Processus dédié `@radar-ia/worker` (distinct du bot et de l’API).

| Variable | Défaut | Rôle |
|----------|--------|------|
| `SOURCES_REGISTRY_PATH` | `config/sources.json` | Chemin du registre JSON des sources (relatif = **racine monorepo**, pas le cwd npm workspace) |
| `WORKER_SCHEDULER_ENABLED` | `true` | `false` = mode **one-shot** (un cycle puis arrêt) |
| `WORKER_CYCLE_INTERVAL_MS` | `900000` (15 min) | Délai entre la fin d’un cycle et le début du suivant |
| `WORKER_INITIAL_DELAY_MS` | `5000` | Délai avant le premier cycle après « worker ready » |
| `PIPELINE_LOCK_TTL_MS` | `300000` (5 min) | TTL du verrou single-flight PostgreSQL |
| `PIPELINE_HEARTBEAT_INTERVAL_MS` | `30000` | Heartbeat ; doit être `< TTL/3` |
| `WORKER_HOLDER_PREFIX` | `worker` | Préfixe du `holderId` (`worker:<host>:<pid>:<suffix>`) |
| `RAW_FEED_RETENTION_PER_SOURCE` | `20` | Nombre max de snapshots bruts conservés par source |
| `RAW_FEED_RETENTION_DAYS` | `30` | Âge max des snapshots bruts (jours) |

Comportements :

- au plus un tick local actif ; le verrou PostgreSQL reste l’autorité finale ;
- Discord indisponible → le cycle continue sans publication (`degraded`) ;
- Ollama indisponible au démarrage → **warn** + diagnostic structuré (serveur / modèle / génération / parse) ; le worker **continue** en mode dégradé (fallback déterministe pour annonces Tier S majeures) ;
- arrêt propre sur `SIGINT` / `SIGTERM` (timers, Prisma, client Discord) ;
- scripts hôte : `npm run dev:worker` / `npm run start:worker` ;
- rattrapage borné (fenêtre temporelle + sources prioritaires) :
  - dry-run : `npm run catch-up` (ou `node --env-file=.env apps/worker/dist/catch-up.js --dry-run --since 2026-07-15`) ;
  - exécution : `npm run catch-up:execute` **après** revue dry-run (nécessite injection `reanalyze` côté ops / wiring) ;
- Compose : `docker compose up -d` → **postgres + bot** ; `docker compose --profile worker up -d worker` → worker auto ;
- worker auto : 1er cycle ≈ 5 s, puis toutes les 15 min (défauts) ; `/radar-admin cycle` = manuel optionnel ;
- Compose (Linux validé) : bot/worker en `network_mode: host` ; `OLLAMA_BASE_URL=http://127.0.0.1:11434` (pas `host.docker.internal`).

Aucun `process.env` direct dans `apps/worker/src/**` — uniquement `@radar-ia/config`.

---

## Configuration Discord

À prévoir :

- bot discord.js opérationnel ;
- catégorie et salons cibles (`#flux-rss-brut`, `#flux-ia`, `#veille-pertinente`, `#annonces-majeures`, 3 salons RSS techniques) ;
- permissions : membres en **lecture seule** ;
- comportements : fils automatiques, archivage **24 h**, réouverture automatique, reprise après incident.

Variables métier V1 :

- `DISCORD_GUILD_ID` : snowflake de la guilde unique V1 ;
- `DISCORD_CHANNEL_ANNONCES_MAJEURES` : snowflake de `#annonces-majeures` ;
- `DISCORD_CHANNEL_VEILLE_PERTINENTE` : snowflake de `#veille-pertinente` ;
- `DISCORD_CHANNEL_FLUX_IA` : snowflake de `#flux-ia`.

Règles :

- snowflakes non vides, format `17` à `20` chiffres ;
- aucune valeur par défaut ;
- en `NODE_ENV=production`, les variables Discord bot + salons métier sont obligatoires ;
- aucun secret ni token dans les logs.

Détail métier : [`DISCORD.md`](../Architecture/DISCORD.md).

---

## Configuration PostgreSQL

| Règle | Valeur |
|-------|--------|
| Emplacement | **Hors dépôt** |
| Accès applicatif | Via **Prisma** |
| Sauvegardes | **Hors dépôt** |

DSN via `DATABASE_URL` (voir `.env.example`). Schéma Prisma : `packages/database/prisma/schema.prisma`.

Compose : `POSTGRES_DATA_PATH` (défaut `./data/postgres`) — bind mount hôte des données PostgreSQL. Chemin d’exploitation spécifique uniquement dans le `.env` local (non versionné).

---

## Configuration Ollama

| Règle | Valeur |
|-------|--------|
| Déploiement | Instance **partagée** |
| Parallelisme | **Une seule inférence simultanée** |
| Rôle | Runtime du modèle retenu |

---

## Configuration du LLM

| Règle | Valeur |
|-------|--------|
| Modèle | **Ministral 3 3B** |
| Packaging | **Modelfile dédié** |
| Alternatives | Non retenues (pas de multi-agent, pas de multi-modèles) |
| Sortie | JSON d'analyse (`AnalysisProposalV1` — gel 007.1A) |
| Autorité | Décision finale **backend** uniquement |

Voir [`LLM.md`](../Architecture/LLM.md).

---

## Configuration des sources

| Règle | Valeur |
|-------|--------|
| Emplacement | **Hors code** — fichier JSON local |
| Modèle versionné | [`config/sources.example.json`](../../config/sources.example.json) |
| Fichier local | `config/sources.json` (ignoré par Git ; copier depuis l'exemple) |
| Classification | Niveaux **S → E** |
| Réseaux sociaux | **Interdits** |
| Collecte | Incrémentale, ETag / Last-Modified, retry progressif, ralentissement auto, SSRF |

Chargement applicatif (package `@radar-ia/collector`) :

- `loadSourceRegistry(filePath)` — lit et valide le fichier JSON ;
- `parseSourceRegistry(input)` — valide une chaîne ou des octets UTF-8 ;
- `getEnabledSources(registry)` — sources avec `enabled: true`.
- `createIncrementalCollector({ httpClient })` — collecte incrémentale d’une source (`ETag` / `Last-Modified`) ; l’état (`SourceFetchState`) est explicite côté collector (persistance d’état via `@radar-ia/database` / `CollectedSourceState`) ;
- `normalizeFeedArticles(source, feed)` / `normalizeArticle(source, feed, item)` — normalisation vers `NormalizedArticle` (sans déduplication) ;
- persistance articles (`@radar-ia/database`) : `createNormalizedArticleRepository(prisma).saveNormalizedArticle` / `saveNormalizedArticles` — idempotence technique par source ; chaîne complète câblée via `createPipelineOrchestrator` (009.1C) / `@radar-ia/worker` (009.1D).

Champs obligatoires par source : `id`, `name`, `url`, `tier`, `enabled`, `provider`.

Providers actifs : `rss`, `atom`, `github_releases`. Providers préparés (stubs) : `html`, `api` — uniquement avec `enabled=false`.

Voir [`SOURCES.md`](../Reference/SOURCES.md).

---

## Configuration Docker

| Règle | Valeur |
|-------|--------|
| Outil | **Docker Compose** |
| PostgreSQL | Reste hors dépôt |
| Sauvegardes | Hors dépôt |
| Objectif | Orchestration de la stack applicative retenue |

Fichier : `docker-compose.yml` (Postgres + bot permanents ; profile `worker` optionnel). Voir [`INSTALL.md`](INSTALL.md) et [`SECURITY.md`](../Reference/SECURITY.md).
