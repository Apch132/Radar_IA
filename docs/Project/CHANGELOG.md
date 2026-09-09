# Changelog

Toutes les modifications notables de **Radar IA** sont documentées dans ce fichier.

Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/lang/fr/).

Source officielle des décisions pour la version actuelle : [`handoff.md`](../handoff.md).

---

## [Unreleased]

### Planned

- Évolutions futures selon arbitration concepteur (aucune étape officielle ouverte).

---

## [1.0.1] — 2026-07-16

Module **010** — audit global + remédiation complète (010.0 → 010.1A).

### Fixed / Security

- Single-flight pipeline atomique (`FOR UPDATE`) ; lease d’exécution publication Discord.
- Verrou Ollama cross-process ; `forceReanalysis` sous lease.
- SSRF anti-DNS-rebinding (pin IP) ; limite taille réponses Ollama.
- TTL/heartbeat cohérents ; interruption sur perte de lock.
- Docker : Postgres loopback, worker non-root / read-only.
- Rétention snapshots bruts ; reprise publication bornée ; matching batch.
- Admin : erreurs sanitizées + rate-limit ; framing anti-injection prompt.

### Changed

- Packages versionnés `1.0.0` ; documentation sécurité / config alignée v1.0.

---

## [1.0] — 2026-07-16

Roadmap initiale **001–009** clôturée. Chaîne de veille Discord exploitable (collecte → matching → analyse → publication → admin).

### Added

- Module 009 — Administration complète (persistance, orchestration cycle, worker/scheduler, surface slash Discord).
- `/radar-admin` (status, sources, cycle, resume, reanalyse, interventions) — allowlist user IDs, réponses éphémères, audit append-only.
- `DISCORD_ADMIN_USER_IDS` dans `@radar-ia/config`.
- Façade `createAdminOpsService` dans `@radar-ia/database`.

### Changed

- Projet promu **v1.0**.
- Documentation alignée (DISCORD, CONFIGURATION, handoff, README).

---

## [0.5] — 2026-07-15

Phase de conception terminée. Fondations gelées. Développement non commencé.

### Added

- Vision du produit : bot Discord de veille sur l'intelligence artificielle.
- Philosophie produit : Discord comme interface ; dossier d'actualité comme unité métier ; backend décisionnaire ; LLM assistant uniquement.
- Stack officielle gelée : TypeScript, Node.js LTS, npm Workspaces, Fastify, discord.js, PostgreSQL, Prisma, Docker Compose, Ollama partagé, Ministral 3 3B (Modelfile dédié).
- Doctrine des sources (niveaux S à E) et exclusion des réseaux sociaux.
- Doctrine de collecte : collecte incrémentale, ETag / Last-Modified, retry progressif, ralentissement automatique des sources en erreur, stockage brut + nettoyé, protection SSRF.
- Doctrine de déduplication : distinction Source / Événement / Dossier.
- Doctrine d'analyse : le LLM résume, classe, score et produit un JSON ; le backend conserve la décision finale.
- Doctrine Discord : catégorie dédiée, salons définis, fils automatiques, archivage 24 h, réouverture automatique, lecture seule pour les membres, reprise après incident.
- Décisions majeures de périmètre : bot Discord uniquement ; pas de plateforme Web ; pas de API publique ; pas de multi-agent ; modèle unique Ministral 3 3B ; Ollama partagé ; réseaux sociaux exclus.
- Contraintes d'exploitation : PostgreSQL hors dépôt ; sauvegardes hors dépôt ; une seule inférence simultanée.
- Parking des idées hors périmètre : dashboard Web, API publique, recherche avancée, statistiques avancées.

### Changed

- Aucun — première version documentaire officielle.

### Deprecated

- Aucun.

### Removed

- Aucun.

### Fixed

- Aucun.

### Security

- Protection SSRF retenue comme règle de collecte.
- Isolation et stockage hors dépôt retenus comme contraintes d'architecture.

---

## Liens

- Documentation produit : [`README.md`](../../README.md)
- Index documentation : [`docs/README.md`](../README.md)
- Mémoire officielle : [`handoff.md`](../handoff.md)
- Roadmap : [`ROADMAP.md`](ROADMAP.md)
