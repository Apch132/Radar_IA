# HANDOFF — Radar IA

Mémoire officielle et tableau de bord de pilotage.
**Structure stabilisée** — les évolutions futures concernent surtout le contenu, pas l’organisation.

## Tableau de bord


|                                |                                                  |
| ------------------------------ | ------------------------------------------------ |
| **Projet**                     | Radar IA                                         |
| **Version**                    | 1.0                                              |
| **Statut**                     | v1.0 — Correctif 2 fiabilisation veille / publications |
| **Module en cours**            | —                                                |
| **Prochaine étape officielle** | — (aucune ouverte ; arbitration concepteur)      |
| **Avancement global**          | 100 % roadmap 001–009 ; module 010 clôturé       |
| **Dernière sync documentaire** | 2026-09-09 — README open source ; Validation hors dépôt |


```
[████████████████████████████████] 100 %
```

---

# 1. Vision

Radar IA est un **bot Discord de veille sur l'intelligence artificielle**.

Objectifs :

1. Collecter des informations fiables.
2. Les analyser intelligemment.
3. Éliminer le bruit et les doublons.
4. Publier uniquement les informations pertinentes sur Discord.
5. Assurer le suivi de chaque annonce via les fils Discord.

Le projet reste volontairement centré sur ce périmètre.

---



# 2. Philosophie

Doctrine produit (implémentée dans le monorepo **v1.0**) :

- Discord est l'interface du produit.
- Le dossier d'actualité est l'unité métier.
- Le message principal présente l'annonce.
- Le fil raconte son évolution.
- Le backend applique les règles.
- Le LLM assiste uniquement l'analyse éditoriale.

---



# 3. Invariants

Règles immuables du projet (ne pas contourner sans arbitration explicite) :

- Le handoff (`docs/handoff.md`) est la **mémoire officielle** du projet.
- En cas de divergence entre plusieurs documents, `docs/handoff.md` **fait foi**. Les autres documents (spécifications, guides, prompts, notes, etc.) doivent être alignés sur lui.
- Toute tâche Cursor se termine par une **synchronisation du handoff** (journal + état).
- Le journal est en **ordre chronologique inversé** (plus récent en tête).
- Les modules suivent la **roadmap fonctionnelle** officielle (§7).
- Le **backend** conserve toujours la décision finale.
- Le **LLM n’est jamais décisionnaire**.
- **Discord** est le produit (pas de plateforme Web produit).
- Les **sources** sont configurées hors code.
- Le stockage brut des collectes est **append-only**.
- PostgreSQL et sauvegardes restent **hors dépôt**.
- **Une seule** inférence Ollama simultanée (`OLLAMA_MAX_CONCURRENCY = 1`).

---



# 4. Décisions irréversibles

Choix d’architecture figés (ne plus remettre en question sans nouvelle arbitration) :

- Bot Discord uniquement.
- Pas de plateforme Web.
- Pas d’API publique.
- Pas de multi-agent.
- Modèle unique : Ministral 3 3B.
- Ollama partagé.
- Réseaux sociaux exclus comme sources.
- Stack gelée : TypeScript, Node.js LTS, npm Workspaces, Fastify, discord.js, PostgreSQL, Prisma, Docker Compose.

---



# 5. État du projet

Lecture : **Gelé** = doctrine / conception stabilisée (pas « livré en code »). **Livré** = implémenté dans le dépôt. **⏳** = à développer.

### Doctrine (conception)


| Domaine                  | Statut                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vision                   | ✅ Gelé                                                                                                                                                                       |
| Architecture             | ✅ Gelé                                                                                                                                                                       |
| Stack                    | ✅ Gelé                                                                                                                                                                       |
| Sources                  | ✅ Gelé                                                                                                                                                                       |
| Collecte                 | ✅ Gelé (doctrine)                                                                                                                                                            |
| Déduplication            | ✅ Gelé (doctrine 006.0 + gel 006.1A) et ✅ livré (006.1B→006.1E)                                                                                                              |
| Analyse & scoring        | ✅ Gelé (doctrine 007.0 + gel 007.1A) et ✅ livré (007.1B→007.1F)                                                                                                              |
| Discord (cible produit)  | ✅ Gelé (doctrine produit + gel module **008.1A**) et ✅ livré (008.1B→008.1F — module 008 terminé) |
| LLM                      | ✅ Gelé (doctrine + gel 007.1A) et ✅ livré (007.1B→007.1F)                                                                                                                    |
| Administration           | ✅ Gelé (doctrine 009.0 + gel **009.1A**) et ✅ livré (009.1B→009.1E — module 009 terminé)                                                                                                                  |
| Documentation officielle | ✅ Publiée (référence sous `docs/` ; état projet **v1.0**)                                                                                                                   |




### Livré


| Domaine                                         | Statut                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structure monorepo                              | ✅ Initialisée (001.1A)                                                                                                                                                                      |
| Infrastructure Docker locale                    | ✅ Initialisée (002.1A)                                                                                                                                                                      |
| Prisma (package database)                       | ✅ Initialisé (002.1B) puis modèles collecte brute (004.1F) + articles normalisés (005.1A) + dossiers / décisions (006.1B) + tentatives d’analyse IA (007.1B) + publication Discord (008.1B) + administration (009.1B — run / lock / audit / backoff sources) |
| Configuration centralisée                       | ✅ Initialisée (002.1C — `@radar-ia/config`, Zod)                                                                                                                                            |
| API Fastify                                     | ✅ Bootstrap minimal (003.1A — `/health`, sans Prisma / métier)                                                                                                                              |
| Bot Discord                                     | ✅ Bootstrap + adaptateur publication Discord (003.1B + 008.1E — intents `Guilds` + `GuildMessages`, port discord.js, resolver salons métier, tests sans réseau réel)                      |
| Organisation runtime                            | ✅ Points d'enregistrement modulaires (003.1C — routes API + événements bot)                                                                                                                 |
| Module 004 — Socle de collecte                  | ✅ Terminé (004.1A → 004.1F)                                                                                                                                                                 |
| Client HTTP sécurisé                            | ✅ Livré (004.1A — `@radar-ia/collector`, `createSecureHttpClient`)                                                                                                                          |
| Lecteur RSS / Atom                              | ✅ Livré (004.1B — `@radar-ia/collector`, `parseFeed`)                                                                                                                                       |
| Registre des sources                            | ✅ Livré (004.1C — `@radar-ia/collector`, `parseSourceRegistry` / `loadSourceRegistry`)                                                                                                      |
| Collecte incrémentale                           | ✅ Livré (004.1D — `@radar-ia/collector`, `createIncrementalCollector`)                                                                                                                      |
| Normalisation des articles                      | ✅ Livré (004.1E — `@radar-ia/collector`, `normalizeArticle` / `normalizeFeedArticles`)                                                                                                      |
| Stockage brut (collectes)                       | ✅ Livré (004.1F — `@radar-ia/database`, `RawFeedSnapshot` + `CollectedSourceState`)                                                                                                         |
| Module 005 — Gestion des articles               | ✅ Terminé (005.1A — Persistance des articles normalisés)                                                                                                                                    |
| Persistance articles normalisés                 | ✅ Livré (005.1A — `@radar-ia/database`, `NormalizedArticle` + repository)                                                                                                                   |
| Module 006 — Déduplication                      | ✅ Terminé (006.0 → 006.1E)                                                                                                                                                                  |
| Persistance dossiers / décisions                | ✅ Livré (006.1B — modèles + repository CRUD ; 006.1C — service métier transactionnel)                                                                                                       |
| Moteur de rapprochement                         | ✅ Livré (006.1D — `@radar-ia/shared`, `createMatchingEngine`)                                                                                                                               |
| Orchestration matching                          | ✅ Livré (006.1E — `@radar-ia/database`, `createMatchingOrchestrator`)                                                                                                                       |
| Persistance résultats d’analyse IA              | ✅ Livré (007.1B — `@radar-ia/database`, `AnalysisAttempt` + repository)                                                                                                                     |
| Client Ollama + validation `AnalysisProposalV1` | ✅ Livré (007.1C — `@radar-ia/analysis`, `createOllamaAnalysisClient` + `validateAnalysisProposal`)                                                                                          |
| Service d’analyse IA                            | ✅ Livré (007.1D — `@radar-ia/analysis`, `createAnalysisService`)                                                                                                                            |
| Orchestration Analyse IA                        | ✅ Livré (007.1E — `@radar-ia/database`, `createAnalysisOrchestrator`)                                                                                                                       |
| Validation finale Analyse IA                    | ✅ Livré (007.1F — module 007 terminé)                                                                                                                                                       |
| Persistance publication Discord                 | ✅ Livré (008.1B — `@radar-ia/database`, `FolderPublication` + `PublicationAttempt` + `createPublicationRepository`)                                                                         |
| Contrats / contenu publication Discord          | ✅ Livré (008.1C — `@radar-ia/shared`, `buildMainPublicationContent` / `buildEnrichmentPublicationContent`)                                                                                  |
| Orchestration publication Discord               | ✅ Livré (008.1D — `@radar-ia/database`, `createPublicationOrchestrator` + port `DiscordPublicationPort`)                                                                                    |
| Adaptateur Discord (bot)                        | ✅ Livré (008.1E — `@radar-ia/bot`, `createDiscordPublicationAdapter` + `createPublicationChannelResolver`)                                                                                  |
| Validation finale Publication Discord           | ✅ Livré (008.1F — module 008 terminé)                                                                                                                                                       |
| Doctrine Administration                         | ✅ Livré (009.0 — documentaire uniquement ; aucun code applicatif 009)                                                                                                                       |
| Gel fonctionnel Administration                  | ✅ Livré (009.1A — normatif ; aucun code applicatif 009)                                                                                                                                     |
| Persistance Administration                      | ✅ Livré (009.1B — `@radar-ia/database`, `PipelineRun` / `PipelineLock` / `AdminOperationLog` + backoff `CollectedSourceState`)                                                              |
| Orchestration cycle d’exploitation              | ✅ Livré (009.1C — `@radar-ia/database`, `createPipelineOrchestrator` ; ports injectables)                                                          |
| Worker dédié + scheduler                        | ✅ Livré (009.1D — `@radar-ia/worker` ; héberge le pipeline ; single-flight PG)                                                          |
| Surface admin Discord (slash)                   | ✅ Livré (009.1E — `/radar-admin` allowlist ; `createAdminOpsService` ; réponses éphémères ; audit append-only)                          |
| Développement                                   | ✅ Roadmap 001–009 **terminée** (v1.0) ; module **010** audit+remédiation **terminé** (010.0 → 010.1A) |
| Audit global post-v1.0 (010.0)                  | ✅ Livré — `Validation/010.0_Global_Audit_Report.md` |
| Remédiation post-audit (010.1A)                 | ✅ Livré — `Validation/010.1A_Remediation_Report.md` ; **19/19** corrigés |
| Plateforme Ubuntu (déploiement reproductible)   | ✅ Validée — tag Git **`ubuntu-deploy-v1`** (Node 20, Docker/PG, Prisma, build, typecheck, tests, worker) |
| Correctifs runtime post-essais réels            | ✅ Livré — résolution registre indépendante du cwd ; HTTP 304 null-body |
| Bot Discord en Compose (permanent)              | ✅ Livré — service `bot` sans profile (`docker compose up -d`) ; API reste hôte |
| Runtime Compose validé (Ubuntu)                 | ✅ `network_mode: host` ; Ollama `127.0.0.1:11434` ; PG via `POSTGRES_DATA_PATH` ; cycles `completed` non dégradés |


---



# 6. État d'avancement global

Pilotage — maturité du développement (hors doctrine seule).


| Domaine                    | Statut | Avancement |
| -------------------------- | ------ | ---------- |
| Fondations dépôt (001)     | ✅      | 100 %      |
| Infrastructure (002)       | ✅      | 100 %      |
| Runtime (003)              | ✅      | 100 %      |
| Collecte (004)             | ✅      | 100 %      |
| Gestion des articles (005) | ✅      | 100 %      |
| Déduplication (006)        | ✅      | 100 %      |
| Analyse IA (007)           | ✅      | 100 %      |
| Publication Discord (008)  | ✅      | 100 %      |
| Administration (009)       | ✅      | 100 %      |


**Méthode de calcul** : moyenne simple des modules de la roadmap fonctionnelle **in-scope** (001→009). Chaque module ✅ = 100 %, ⬜ = 0 %, 🟡 = (étapes terminées / étapes officielles connues). Parking exclu du calcul.

- Modules in-scope : **9**
- Terminés : **9** (001–009)
- Module 006 : **6** / **6** étapes officielles (006.0 → 006.1E) → 100 %
- Module 007 : **7** / **7** étapes officielles **nommées** (007.0 → 007.1F) → 100 %
- Module 008 : **7** / **7** étapes officielles **nommées** (008.0 → 008.1F) → 100 %
- Module 009 : **6** / **6** étapes officielles **nommées** (009.0 → 009.1E) → 100 %
- Avancement global : **100 %**

```
[████████████████████████████████] 100 %
```

---



# 7. Roadmap fonctionnelle

Modules de développement dans l’ordre chronologique (séries réelles 001–005 + suite issue de `docs/Project/ROADMAP.md` Phase suivante).


| #   | Module                                           | Statut |
| --- | ------------------------------------------------ | ------ |
| 001 | Fondations dépôt (monorepo, Git, runtime Cursor) | ✅      |
| 002 | Infrastructure (Docker Compose, Prisma, config)  | ✅      |
| 003 | Runtime (API Fastify, bot Discord bootstrap)     | ✅      |
| 004 | Socle de collecte                                | ✅      |
| 005 | Gestion des articles                             | ✅      |
| 006 | Déduplication                                    | ✅      |
| 007 | Analyse IA                                       | ✅      |
| 008 | Publication Discord                              | ✅      |
| 009 | Administration                                   | ✅      |
| 010 | Évolutions post-v1.0 (audit / durcissement)      | ✅      |


**Légende** : ✅ terminé · 🟡 en cours / ouvert · ⬜ non démarré

**Parking** (hors roadmap active, non compté dans l’avancement) : Dashboard Web, API publique, recherche avancée, statistiques avancées.

---



# 8. Progression des modules

Étapes officielles connues uniquement (pas d’invention au-delà des étapes nommées ; 006 terminé 006.0 → 006.1E ; 007 : 007.0 → 007.1F ; 008 : 008.0 → 008.1F ; 009 : 009.0 → 009.1E **terminé** ; 010 : 010.0 → 010.1A **terminé**).


| Module | Étapes                                                      | Progression |
| ------ | ----------------------------------------------------------- | ----------- |
| 001    | 001.1A, 001.1B, 001.1C                                      | 3 / 3       |
| 002    | 002.1A, 002.1B, 002.1C                                      | 3 / 3       |
| 003    | 003.1A, 003.1B, 003.1C                                      | 3 / 3       |
| 004    | 004.1A → 004.1F                                             | 6 / 6       |
| 005    | 005.1A                                                      | 1 / 1       |
| 006    | 006.0 → 006.1E                                              | 6 / 6       |
| 007    | 007.0 → 007.1F                                              | 7 / 7       |
| 008    | 008.0 → 008.1F                                              | 7 / 7       |
| 009    | 009.0 → 009.1E                                              | 6 / 6       |
| 010    | 010.0 (audit) → 010.1A (remédiation)                | 2 / 2       |


---



# 9. Roadmap des versions


| Version | Jalon                          | Nature   |
| ------- | ------------------------------ | -------- |
| 0.1     | Vision du projet               | Livré    |
| 0.2     | Documentation officielle       | Livré    |
| 0.3     | Monorepo                       | Livré    |
| 0.4     | Infrastructure                 | Livré    |
| 0.5     | Bootstrap runtime (API / Bot)  | Livré    |
| 0.6     | Socle de collecte terminé      | Livré    |
| 0.7     | Gestion complète des articles  | Livré    |
| 0.8     | Moteur IA (analyse / scoring)  | Livré    |
| 0.9     | Publication Discord métier     | Livré    |
| 1.0     | Première version de production | **Livré** |


La **v1.0** clôture la roadmap initiale 001–009 (administration + surface Discord ops). Le module **010** (audit 010.0 + remédiation 010.1A) est **terminé** ; aucune étape officielle suivante n’est ouverte.

### Critères de passage (versions futures)

**0.7 — Gestion complète des articles**

- Module 005 terminé (toutes les étapes officielles alors ouvertes)
- Articles normalisés persistés et exploitables en aval
- Tests du périmètre validés
- Handoff synchronisé

**0.8 — Moteur IA**

- Module 007 terminé (pipeline analyse branché sur Ollama / Ministral 3 3B)
- Scoring / classification produits ; décision finale toujours côté backend
- Tests du périmètre validés
- Handoff synchronisé

**0.9 — Publication Discord métier**

- Module 008 terminé (publication messages / fils conforme à la doctrine)
- Bootstrap bot dépassé : comportement métier opérationnel
- Tests du périmètre validés
- Handoff synchronisé

**1.0 — Première version de production**

- Chaîne complète : collecte → articles → déduplication → IA → publication
- Modules in-scope 001–009 au statut ✅ (ou equivalent livré)
- Validation production / exploitation effectuée
- Documentation alignée ; handoff synchronisé

---



# 10. Jalons majeurs

Ce que le projet **sait faire** (ou saura faire) à chaque version importante.

### 0.6 — Socle de collecte

- Collecte RSS / Atom incrémentale (ETag / Last-Modified)
- Client HTTP sécurisé (SSRF)
- Registre des sources hors code
- Normalisation d’articles en mémoire
- Snapshots bruts + état incrémental en base
- Bootstrap API `/health` et bot Discord (sans publication métier)



### 0.7 — Gestion des articles

- Persistance des articles normalisés (`NormalizedArticle` + repository)
- Idempotence technique par source (`sourceId+externalId` / repli `sourceId+url`)
- Module 005 terminé (étape officielle 005.1A)



### 0.8 — Moteur IA

- Pipeline d’analyse (Ollama / Ministral 3 3B)
- Résumé, classification, scoring, JSON ; décision finale backend
- Module 007 terminé (007.0 → 007.1F)



### 0.9 — Publication Discord

- Salons, fils automatiques, archivage, reprise après incident
- Module 008 terminé (008.0 → 008.1F)



### 1.0 — Production (livré)

- Chaîne complète opérationnelle : collecte → articles → déduplication → IA → publication → admin
- Module 009 terminé (009.0 → 009.1E) — worker, scheduler, slash admin
- Roadmap initiale 001–009 clôturée ; module **010** terminé (audit + remédiation)

---



# 11. Statistiques du projet

Données connues uniquement :


| Indicateur                 | Valeur                                                                    |
| -------------------------- | ------------------------------------------------------------------------- |
| Version projet             | 1.0                                                                       |
| Modules terminés           | 9 / 9 (001–009) + module **010** (audit / remédiation)                    |
| Module en cours            | — (aucune étape officielle ouverte)                                       |
| Avancement global          | 100 % (roadmap 001–009)                                                   |
| Packages workspace         | 8 (`api`, `bot`, `worker`, `analysis`, `collector`, `config`, `database`, `shared`) |
| Packages stables           | 8                                                                         |
| Documentation de référence | sous `docs/` (projet **v1.0** ; handoff = source de vérité)               |


---



# 12. Architecture actuelle

Monorepo npm Workspaces.


| Package               | Rôle                                                                                                                                                                                                                                                    | État   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `@radar-ia/api`       | API Fastify — bootstrap `/health`, registres de routes                                                                                                                                                                                                  | Stable |
| `@radar-ia/bot`       | Bot Discord — bootstrap, adaptateur publication (008.1E), surface slash admin **009.1E** (`/radar-admin`, allowlist, éphémère)                                                     | Stable |
| `@radar-ia/worker`    | Worker dédié — scheduler + composition pipeline 004–008 via `createPipelineOrchestrator` (009.1D) ; client Discord publication-only                                                                                                                                 | Stable |
| `@radar-ia/analysis`  | Analyse IA — client Ollama, validation `AnalysisProposalV1`, service métier + **fallback déterministe** (`deterministic_fallback`) ; logs structurés échec/succès | Stable |
| `@radar-ia/collector` | Collecte — HTTP sécurisé, RSS/Atom, registre sources, incrémental, normalisation                                                                                                                                                                        | Stable |
| `@radar-ia/config`    | Configuration — validation Zod (Discord allowlist admin 009.1E + sources + worker/scheduler 009.1D)                                                                                                                                                                                            | Stable |
| `@radar-ia/database`  | Prisma — snapshots, articles, matching / analyse / publication ; admin 009.1B + cycle **009.1C** + façade ops **009.1E** (`createAdminOpsService`) | Stable |
| `@radar-ia/shared`    | Types / utilitaires communs — moteur déterministe de rapprochement (006.1D) ; contrats / rendu contenu Discord (008.1C)                                                                                                                                 | Stable |


État : modules **001–009 terminés**. Projet **v1.0**. Roadmap initiale clôturée. Module **010** (010.0 → 010.1A) **terminé**. Aucune prochaine étape officielle ouverte.

---



# 13. Stack officielle

- TypeScript
- Node.js LTS
- npm Workspaces
- Fastify
- discord.js
- PostgreSQL
- Prisma
- Docker Compose
- Ollama partagé
- Ministral 3 3B (Modelfile dédié)

Contraintes :

- PostgreSQL hors dépôt.
- Sauvegardes hors dépôt.
- Ollama partagé.
- Une seule inférence simultanée.

---



# 14. Dépendances majeures

Dépendances structurantes (sans versions — voir `package-lock.json`) :

- Fastify
- discord.js
- Prisma / `@prisma/client`
- Zod
- Vitest
- fast-xml-parser

---



# 15. Doctrine des sources

Doctrine gelée (registre livré en 004.1C ; activation progressive des sources hors code) :

Niveaux :

- S : Sources officielles
- A : Documentation / Releases
- B : Benchmarks indépendants
- C : Recherche
- D : Open Source
- E : Presse spécialisée

Décision officielle :
**Aucun réseau social n'est utilisé comme source.**

Toutes les sources sont configurables hors code.

---



# 16. Doctrine de collecte



### Livré (module 004)

- Collecte incrémentale (`createIncrementalCollector`).
- ETag / Last-Modified.
- Protection SSRF (client HTTP sécurisé).
- Stockage brut (`RawFeedSnapshot` + `CollectedSourceState`).



### Livré (module 005)

- Persistance des articles normalisés (`NormalizedArticle` + `createNormalizedArticleRepository`).
- Idempotence technique par source (pas de déduplication éditoriale).



### Livré (suite — modules 007–009)

- Analyse IA / scoring (module 007 — doctrine 007.0 + gel 007.1A + 007.1B→007.1F).
- Retry progressif et ralentissement des sources en erreur (backoff `CollectedSourceState`, 009.1B).
- Câblage complet collecte → normalisation → matching → analyse → publication (orchestrateur 009.1C + worker 009.1D).

---



# 17. Doctrine de déduplication

**Gel fonctionnel 006.1A terminé** — référence normative : `docs/Validation/006.1A_Gel_Fonctionnel_Deduplication.md`.
Conception historique : `docs/Validation/006.0_Doctrine_Deduplication.md`.
**Module 006 terminé** : données 006.1B + persistance 006.1C + moteur 006.1D + orchestration 006.1E (`createMatchingOrchestrator` : moteur → persistance → repository).

Le système distingue :

- **Source** — origine configurable (registre hors code, tiers S–E) ;
- **Article normalisé** — unité technique (005 ; identité intra-source) ;
- **Événement** — critère métier de rapprochement ;
- **Dossier d’actualité** — unité métier de suivi (publication 008 : message + fil).

Issues métier gelées pour un article candidat :

- `create_dossier` ;
- `attach_enrich` ;
- `duplicate_editorial` ;
- `ambiguous_no_action`.

États dossier (006) : `open` | `idle` | `closed`.

Règles structurantes :

- information nouvelle → enrichissement ; sinon doublon éditorial (pas de second dossier) ;
- ambiguïté → aucune fusion automatique ;
- décision **backend** uniquement ; le LLM n’est jamais décisionnaire ;
- frontière nette avec 005 : idempotence technique ≠ déduplication éditoriale.

Module 006 clos. Modules 007–010 clos. Aucune prochaine étape officielle ouverte.

---



# 18. Analyse LLM

**Référence normative** : `docs/Validation/007.1A_Gel_Fonctionnel_Analyse_IA.md`.
Conception historique : `docs/Validation/007.0_Doctrine_Analyse_IA.md`.
**Persistance** : livrée (007.1B — `AnalysisAttempt` + `createAnalysisAttemptRepository`).
**Client Ollama + validation contrat** : livrés (007.1C — `@radar-ia/analysis`).
**Service d’analyse** : livré (007.1D — `createAnalysisService`).
**Orchestration 006→007** : livrée (007.1E — `createAnalysisOrchestrator` dans `@radar-ia/database`).
**Validation finale** : livrée (007.1F — module 007 **terminé**).

Le LLM :

- résume ;
- classe ;
- score ;
- produit un JSON (`AnalysisProposalV1`).

Le backend :

- valide le JSON (`ValidatedAnalysisV1`) ;
- ancre / écarte les `proposedFacts` ;
- calcule le score composite (seuils gel 007.1A) ;
- décide de la publication (`publish` / `enrich_thread_only` / `hold` / `reject_editorial`) ;
- conserve toujours la décision finale ;
- persiste tentatives / propositions / scores / décisions (007.1B, append-only) ;
- enchaîne matching 006 → chargement agrégat → service 007.1D sans Discord / Fastify.

Contraintes gelées : Ministral 3 3B ; Ollama partagé ; **une seule** inférence simultanée ; unité d’analyse = **dossier** ; Discord = consommateur uniquement ; retries / timeouts / plafonds figés en 007.1A.

Module 007 terminé. Modules **008–010** terminés. Aucune prochaine étape officielle ouverte.

---



# 19. Discord (produit)

Fonctionnement **gelé (008.1A)** et **livré (008.1B→008.1F)** — module 008 terminé :

Catégorie dédiée prévue :

- #flux-rss-brut
- #flux-ia
- #veille-pertinente
- #annonces-majeures
- 3 salons RSS techniques (**hors chemin métier 008 V1** ; noms exacts non formalisés)

Cible (gel 008.1A ; exécution Discord réelle livrée via port bot injectable) :

- création automatique d’un fil par annonce (attaché au message principal) ;
- archivage : 24 h (`autoArchiveMinutes = 1440`) ;
- réouverture automatique ;
- lecture seule pour les membres ;
- reprise automatique après incident ;
- orchestration dans `@radar-ia/database` + port Discord dans `@radar-ia/bot` ;
- décisions 007 exécutées sans réinterprétation ;
- variables salons métier : `DISCORD_CHANNEL_ANNONCES_MAJEURES` / `VEILLE_PERTINENTE` / `FLUX_IA`.

Persistance (008.1B) :

- `FolderPublication` (état courant, unicité `folderId`) ;
- `PublicationAttempt` (historique append-only) ;
- `createPublicationRepository` (réservation, IDs, échecs, reprise) ;
- enums `PublicationStatus` / `PublicationOperationKind` / `PublicationAttemptStatus` / `PublicationErrorCode` ;
- `hasMainPublication` dérivé (pas de colonne).

Contenu (008.1C) :

- `@radar-ia/shared` : `buildMainPublicationContent` / `buildEnrichmentPublicationContent` / `buildThreadName` ;
- contrats abstraits `RenderedDiscordPayload` (sans discord.js) ;
- salons métier `ANNONCES_MAJEURES` / `VEILLE_PERTINENTE` / `FLUX_IA` (pas d’IDs Discord) ;
- sanitization (`@everyone` / `@here` / mentions / HTML / contrôles) ;
- limites Discord centralisées (`DISCORD_LIMITS`) + troncature `…` + warnings structurés.

Orchestration (008.1D) :

- `createPublicationOrchestrator` dans `@radar-ia/database` ;
- parcours `publish` / `enrich_thread_only` / `hold` / `reject_editorial` ;
- ordre figé : réserver DB → builders 008.1C → port Discord → persister IDs ;
- interface `DiscordPublicationPort` (sans discord.js) + `DiscordPublicationPortError` ;
- `resolveChannelId` injectable (mapping config) ; `resume()` pour `partial` → `create_thread` ;
- `hold` / `reject_editorial` : skip déterministe, zéro appel Discord, aucune mutation `FolderPublication`.

Adaptateur bot (008.1E) :

- `createDiscordPublicationAdapter(client)` dans `apps/bot/src/publication/discord-publication-adapter.ts` ;
- conversion minimale `RenderedDiscordPayload` / `DiscordEmbedPayload` → `discord.js` avec `allowedMentions` verrouillé ;
- `createPublicationChannelResolver(config)` sans fallback, via `DISCORD_CHANNEL_ANNONCES_MAJEURES` / `DISCORD_CHANNEL_VEILLE_PERTINENTE` / `DISCORD_CHANNEL_FLUX_IA` ;
- vérifications strictement minimales : salon/fil textuel compatible, permissions `ViewChannel`, `SendMessages`, `EmbedLinks`, `ReadMessageHistory`, `CreatePublicThreads`, `SendMessagesInThreads`, `ManageThreads` si désarchivage ;
- intents bootstrap alignés sur le gel : `Guilds` + `GuildMessages`, sans `MessageContent`.

Validation finale (008.1F) :

- tests d’intégration pipeline (mocks) : publish / enrich / hold / reject / partial / resume / idempotence / closed / erreurs / salon absent / thread archivé / verrouillé / IDs perdus / redémarrage / cohérence repo↔orch↔port / anti-duplication ;
- intégration bot : adaptateur discord.js + orchestrateur sans réseau réel ;
- audit frontières : pas de `discord.js` hors `apps/bot` ; pas de Prisma hors `@radar-ia/database` ; pas de logique métier dans le bot ;
- critères P01–P20 exercés via tests d’intégration + tests unitaires existants.

Référence **normative** : `docs/Validation/008.1A_Gel_Fonctionnel_Publication_Discord.md`.
Conception historique : `docs/Validation/008.0_Doctrine_Publication_Discord.md`.
Doctrine transverse : `[docs/Architecture/DISCORD.md](Architecture/DISCORD.md)`.

---



# 20. Conventions

Rappels opérationnels (sans recopier toute la doc) :

- **Commits** : messages conventionnels (`feat`, `fix`, `chore`, `docs`, `refactor`) ; un sujet clair ; pas de secrets.
- **Handoff** : synchroniser après chaque tâche Cursor (état + journal) ; structure figée — privilégier les mises à jour de contenu.
- **Journal** : format `YYYY-MM-DD HH:mm` ; ordre chronologique inversé ; faits vérifiables.
- **Roadmap** : modules et versions du handoff font foi pour le pilotage ; `docs/Project/ROADMAP.md` reste la synthèse publique de référence **v1.0**.
- **Versionnement** : passer une version (0.7+) uniquement si les critères de passage (§9) sont remplis.

---



# 21. Risques actuels

Risques réellement présents à ce stade (**v1.0** + module **010** clos) :

- PostgreSQL / Docker non validés sur toutes les machines de dev (`prisma:migrate:deploy` / `docker compose` parfois différés si l’environnement local est incomplet).
- Faux positifs / faux négatifs de rapprochement (mitigation gel : `ambiguous_no_action`, pas de fusion agressive ; seuils numériques = réserve corpus).
- Qualité / hallucination LLM (mitigation doctrine 007.0 : validation JSON, ancrage des faits, décision backend, pas de publication sur proposition seule).
- Opérations Discord non transactionnelles avec PostgreSQL (mitigation gel 008.1A : réserve puis appel, idempotence, réconciliation ciblée ; validé en intégration 008.1F ; lease d’exécution renforcée en 010.1A).
- Exploitation réelle Discord / Ollama encore dépendante de la configuration hors dépôt (secrets, salons, allowlist admin, registre sources).

---



# 22. Parking

Hors périmètre actuel (non planifié dans le socle en cours) :

- Dashboard Web
- API publique
- Recherche avancée
- Statistiques avancées

---



# 23. Suite

État officiel **v1.0** :

- architecture stabilisée ; documentation sous `docs/` ;
- modules **001–009 terminés** (roadmap initiale clôturée) ;
- chaîne complète : collecte → articles → matching → analyse → publication → admin Discord ;
- worker dédié + scheduler + slash `/radar-admin` allowlistés ;
- avancement global développement : **100 %** (voir §6) ;
- prochaine étape : **aucune ouverte** (module **010** terminé — audit 010.0 + remédiation 010.1A) ; suite selon arbitration concepteur.

Livré :

- monorepo npm Workspaces (`001.1A`) ;
- infrastructure Docker locale PostgreSQL (`002.1A`) ;
- Prisma dans `@radar-ia/database` (`002.1B`, modèles collecte `004.1F`, articles `005.1A`, dossiers / décisions `006.1B`, persistance métier `006.1C`, orchestration matching `006.1E`, tentatives d’analyse `007.1B`, orchestration analyse `007.1E`, publication Discord `008.1B`, orchestration publication `008.1D`, administration `009.1B`, orchestration cycle `009.1C`) ;
- configuration centralisée `@radar-ia/config` (`002.1C`, Zod) ;
- bootstrap Fastify `@radar-ia/api` (`003.1A`, route `/health` uniquement) ;
- bootstrap Discord `@radar-ia/bot` (`003.1B`) + adaptateur publication (`008.1E`, intents `Guilds` + `GuildMessages`, resolver salons métier, port discord.js concret) ;
- organisation modulaire minimale des runtimes (`003.1C`, registres routes API + événements bot) ;
- client HTTP sécurisé (`004.1A`, package `@radar-ia/collector`) ;
- lecteur RSS / Atom (`004.1B`, package `@radar-ia/collector`, `parseFeed`) ;
- registre des sources (`004.1C`, package `@radar-ia/collector`, JSON hors code + validation Zod) ;
- collecte incrémentale (`004.1D`, package `@radar-ia/collector`, `createIncrementalCollector`, ETag / Last-Modified) ;
- normalisation des articles en mémoire (`004.1E`, package `@radar-ia/collector`, `NormalizedArticle`) ;
- stockage brut des collectes (`004.1F`, package `@radar-ia/database`, `RawFeedSnapshot` append-only + `CollectedSourceState`) ;
- persistance des articles normalisés (`005.1A`, package `@radar-ia/database`, modèle `NormalizedArticle` + repository injectable) ;
- doctrine déduplication (`006.0`) + gel fonctionnel (`006.1A`) + modèle de données dossiers / décisions (`006.1B`) + service métier de persistance des décisions (`006.1C`) + moteur déterministe de rapprochement (`006.1D`, `@radar-ia/shared`) + orchestration matching (`006.1E`, `createMatchingOrchestrator`) ;
- doctrine Analyse IA (`007.0`) + gel fonctionnel (`007.1A`, `docs/Validation/007.1A_Gel_Fonctionnel_Analyse_IA.md`) + modèle de données des résultats d’analyse (`007.1B`, `AnalysisAttempt` + `createAnalysisAttemptRepository`) + client Ollama / validation `AnalysisProposalV1` (`007.1C`) + service d’analyse (`007.1D`, `createAnalysisService`) + orchestration analyse (`007.1E`, `createAnalysisOrchestrator`) + validation finale (`007.1F`) ;
- doctrine Publication Discord (`008.0`) + gel fonctionnel (`008.1A`, `docs/Validation/008.1A_Gel_Fonctionnel_Publication_Discord.md`) + modèle de données / persistance (`008.1B`, `FolderPublication` + `PublicationAttempt` + `createPublicationRepository`) + contrats / rendu contenu Discord (`008.1C`, `@radar-ia/shared`) + orchestration publication (`008.1D`, `createPublicationOrchestrator` + `DiscordPublicationPort`) + adaptateur bot (`008.1E`, `createDiscordPublicationAdapter` + `createPublicationChannelResolver`) + validation finale / intégration (`008.1F`) ;
- doctrine Administration (`009.0`, `docs/Validation/009.0_Doctrine_Administration.md`) + gel fonctionnel (`009.1A`, `docs/Validation/009.1A_Gel_Fonctionnel_Administration.md`) + modèle de données / persistance (`009.1B`, `PipelineRun` / `PipelineLock` / `AdminOperationLog` + backoff `CollectedSourceState`) + orchestration cycle (`009.1C`, `createPipelineOrchestrator`) + worker / scheduler (`009.1D`, `@radar-ia/worker`) + surface Discord admin (`009.1E`, `/radar-admin`, `createAdminOpsService`) ;
- audit global post-v1.0 (`010.0`) + remédiation (`010.1A`, 19/19 corrigés).

Modules **001–010 terminés**. Aucune prochaine étape officielle ouverte.

Point d'entrée documentation : `docs/README.md`.
Vitrine GitHub : `README.md` (racine).
Dépôt GitHub : [https://github.com/Apch132/Radar_IA](https://github.com/Apch132/Radar_IA)

---



# 24. Module 004 — Socle de collecte

Feuille de route (historique — module terminé) :

- 004.1A — Client HTTP sécurisé ✅
- 004.1B — Lecteur RSS / Atom ✅
- 004.1C — Registre des sources ✅
- 004.1D — Collecte incrémentale (ETag / Last-Modified) ✅
- 004.1E — Normalisation des articles ✅
- 004.1F — Stockage brut ✅

Module 004 terminé. Socle de collecte livré.

---



# 25. Module 005 — Gestion des articles

Module terminé. Seule étape officielle connue : persistance. La déduplication est le module **006**.

Feuille de route officielle :

- 005.1A — Persistance des articles normalisés ✅

Module 005 terminé.

---



# 26. Module 006 — Déduplication

Module terminé. Doctrine + gel + données + persistance + moteur + orchestration livrés.

Feuille de route officielle connue :

- 006.0 — Conception / doctrine fonctionnelle ✅
- 006.1A — Gel fonctionnel de la déduplication ✅
- 006.1B — Modèle de données des dossiers et décisions de rapprochement ✅
- 006.1C — Repository métier et persistance des décisions ✅
- 006.1D — Moteur déterministe de rapprochement ✅
- 006.1E — Validation finale et intégration du module Déduplication ✅

Référence normative : `docs/Validation/006.1A_Gel_Fonctionnel_Deduplication.md`.
Conception : `docs/Validation/006.0_Doctrine_Deduplication.md`.

Module 006 terminé. Modules 007–010 terminés. Aucune prochaine étape officielle ouverte.

---



# 27. Module 007 — Analyse IA

Module **terminé**. Doctrine + gel + persistance + client Ollama + service + orchestration + validation finale livrés.

Feuille de route officielle connue :

- 007.0 — Conception / doctrine fonctionnelle ✅
- 007.1A — Gel fonctionnel de l’analyse IA ✅
- 007.1B — Modèle de données des résultats d’analyse ✅
- 007.1C — Client Ollama et validation du contrat `AnalysisProposalV1` ✅
- 007.1D — Service d'analyse IA ✅
- 007.1E — Orchestration Analyse IA et intégration avec la déduplication ✅
- 007.1F — Validation finale et intégration du module Analyse IA ✅

Référence **normative** : `docs/Validation/007.1A_Gel_Fonctionnel_Analyse_IA.md`.
Conception : `docs/Validation/007.0_Doctrine_Analyse_IA.md`.
Doctrine transverse LLM : `[docs/Architecture/LLM.md](Architecture/LLM.md)`.

Décisions structurantes (007.0 + 007.1A) :

- unité d’analyse = **dossier** (agrégat 006) ;
- contrats `AnalysisProposalV1` / `ValidatedAnalysisV1` figés ;
- seuils publication / retry / timeout / ancrage / idempotence figés ;
- LLM = proposition uniquement ; backend = validation + décision ;
- Discord = consommateur (008) ;
- pas d’inférence sur `duplicate_editorial` / `ambiguous_no_action` ;
- concurrence Ollama = 1 ; modèle = Ministral 3 3B.

Persistance (007.1B) :

- modèle `AnalysisAttempt` append-only (FK `NewsFolder` Restrict) ;
- enums validation / publication / erreurs / warnings V1 ;
- proposition + scoring backend en JSON ; repository injectable sans logique d’inférence.

Client Ollama (007.1C) :

- package `@radar-ia/analysis` : `createOllamaAnalysisClient` + `parseAnalysisProposalJson` / `validateAnalysisProposal` ;
- concurrency = 1 ; timeouts 90 s / 300 s ; retry 3 (délais 5 s / 15 s) ;
- retour = proposition validée ou erreur normalisée.

Service d’analyse (007.1D) :

- `createAnalysisService` : éligibilité, fingerprint SHA-256, contexte ≤12k, prompt, ancrage, scoring, décisions publish, persistance via port 007.1B ;
- skips tracés (`not_eligible` / `enrichment_immaterial`) sans appel Ollama ;
- pas de double retry (transport 007.1C seul) ; pas de Fastify / Discord / 008 ;
- idempotence : réutilisation uniquement pour décisions terminales (`publish` / `enrich_thread_only` / `reject_editorial`) ; `hold` reste retryable (anti-blocage §9.5).

Orchestration (007.1E) :

- `createAnalysisOrchestrator` dans `@radar-ia/database` : mapping issues 006 → chargement agrégat (dossier / articles / faits / dernière analyse) → `createAnalysisService` ;
- résultats typés `analyzed` / `reused` / `skipped` / `failed` ;
- short-circuit `duplicate_editorial` / `ambiguous_no_action` (zéro Ollama) ;
- frontières transactionnelles : pas de `$transaction` autour d’Ollama ; erreur 007 ne rollback pas 006 ;
- `hasMainPublication` dérivé de l’état publication 008 ; `forceReanalysis` admin propagé ;
- helper `matchingResultToAnalysisInput` ; extension minimale `getNormalizedArticlesByIds`.

Validation finale (007.1F) :

- audit exports publics / dépendances / contrats gel 007.1A ;
- matrice d’acceptation §17 A–O (`analysis-gel-acceptance.test.ts`) + test service anti-blocage (critère O) ;
- aucune logique Discord / Fastify ; aucune nouvelle règle métier hors alignement gel (idempotence `hold`).

Réserves historiques au moment de 007.1F (levées ensuite) : publication Discord = module 008 ; scheduler / worker = module 009 ; durcissement = module 010.

Module 007 terminé. Modules **008–010** terminés. Aucune prochaine étape officielle ouverte.

---



# 28. Module 008 — Publication Discord

Module **terminé** (008.0 → 008.1F).

Feuille de route officielle connue :

- 008.0 — Conception / doctrine fonctionnelle ✅
- 008.1A — Gel fonctionnel de la Publication Discord ✅
- 008.1B — Modèle de données et persistance de la Publication Discord ✅
- 008.1C — Contrats et construction du contenu Discord ✅
- 008.1D — Orchestrateur de publication Discord ✅
- 008.1E — Implémentation du port Discord dans `@radar-ia/bot` ✅
- 008.1F — Validation finale et intégration du module Publication Discord ✅

Référence **normative** : `docs/Validation/008.1A_Gel_Fonctionnel_Publication_Discord.md`.
Conception historique : `docs/Validation/008.0_Doctrine_Publication_Discord.md`.
Doctrine transverse Discord : `[docs/Architecture/DISCORD.md](Architecture/DISCORD.md)`.

Décisions structurantes **figées** (008.1A) :

- 008 = **exécuteur** des décisions 007 ; jamais décideur éditorial ;
- Discord ≠ source de vérité métier ;
- orchestration `@radar-ia/database` + port Discord `@radar-ia/bot` ;
- états `PublicationStatus` : `none`  `pending`  `partial`  `main_published`  `failed`  `inconsistent` ;
- entités conceptuelles `FolderPublication` + `PublicationAttempt` (append-only) ;
- ordre : **réserver DB puis** appeler Discord ;
- `publish` → message + fil ; `enrich_thread_only` → fil seul ; `hold` / `reject_editorial` → no-op ;
- dossier `closed` → aucune publication auto ;
- format texte court + embed ; fil `Veille — {title}` ; archivage 1440 min ;
- env salons : `DISCORD_CHANNEL_ANNONCES_MAJEURES` / `VEILLE_PERTINENTE` / `FLUX_IA` ;
- intents : `Guilds` + `GuildMessages` ; pas Message Content ; pas Administrator ;
- retries : max 5 ; backoff 5 / 15 / 45 / 120 s ; plafond 300 s ;
- critères d’acceptation **P01–P20** normatifs ;
- 3 salons RSS techniques hors chemin métier V1 (noms non inventés).

État code : persistance 008.1B + contenu pur 008.1C + orchestrateur 008.1D + adaptateur bot 008.1E + **validation / intégration 008.1F** (tests pipeline mocks + frontières packages).

Module **008** officiellement **terminé**. Modules **009** et **010** terminés. Aucune prochaine étape officielle ouverte.

---



# 29. Module 009 — Administration

Module **terminé** (009.0 → 009.1E). Projet passé en **v1.0**.

Feuille de route officielle :

- 009.0 — Conception / doctrine fonctionnelle ✅
- 009.1A — Gel fonctionnel du module Administration ✅
- 009.1B — Modèle de données et persistance de l’Administration ✅
- 009.1C — Orchestrateur du cycle d’exploitation ✅
- 009.1D — Worker dédié + scheduler ✅
- 009.1E — Surface d’administration Discord + validation finale ✅

Référence **normative** : `docs/Validation/009.1A_Gel_Fonctionnel_Administration.md`.
Conception historique : `docs/Validation/009.0_Doctrine_Administration.md`.

Décisions structurantes **figées** (009.1A) :

- runtime d’exploitation = **worker dédié** (bot = interface Discord ; API = `/health` interne) ;
- admin = **allowlist d’IDs utilisateur Discord uniquement** (pas de rôles) ;
- Discord = unique interface produit ; **pas** de dashboard Web ; **pas** d’API publique ;
- sources : **fichier** = définition ; **base** = état runtime ;
- **single-flight** PostgreSQL ; historique **append-only** ; backend conserve toutes les décisions métier ;
- surface ops = slash Discord allowlistées + CLI ; critères **A01–A18** ;
- Discord down → skip publish (collect/match/analyse peuvent continuer) ; Ollama down au startup → warn ;
- `ambiguous_no_action` → consultation / annotation seule (pas de fusion auto V1).

Persistance **009.1B** : `PipelineRun` / `PipelineLock` / `AdminOperationLog` + backoff `CollectedSourceState`.
Orchestration cycle **009.1C** : `createPipelineOrchestrator`.
Worker **009.1D** : `@radar-ia/worker`.
Surface Discord **009.1E** : `/radar-admin` (status, sources, cycle, resume, reanalyse, interventions) ; `createAdminOpsService` ; `DISCORD_ADMIN_USER_IDS`.

Prochaine étape officielle : — (aucune ouverte ; module **010** terminé — 010.0 → 010.1A).

---



# 30. Décisions techniques

Synthèse des choix structurants retenus (complète §4) :

- Node.js `>=20`
- npm Workspaces
- TypeScript
- Fastify
- PostgreSQL 16
- Prisma 6.x
- Docker Compose
- Zod
- Vitest
- Ollama partagé
- Ministral 3 3B

---



# 31. Versions du projet

Voir **§9 Roadmap des versions** (tableau de pilotage officiel + critères de passage).

État courant : **v1.0** — roadmap 001–009 clôturée ; module **010** (010.0 + 010.1A) **terminé**. Aucune prochaine étape officielle ouverte.

---



# 32. Journal



## 2026-09-09 — docs: README public + purge Validation

- **README** : page d’accueil produit (problème, parcours événement → fil Discord, LLM vs backend, install). Section captures vide retirée.
- **`docs/README.md`** : index documentation publique (plus de sommaire Validation).
- **`docs/Validation/`** : retiré du dépôt et de l’historique Git ; copie locale hors repo + gitignore. Liens publics redirigés vers ARCHITECTURE / DISCORD / LLM / SOURCES / SECURITY.
- **Identité Git** : noreply conservée après `filter-repo`.
- **Push / visibilité** : non (force-push à la charge du propriétaire).

## 2026-09-08 — chore(security): préparation open source

- **Périmètre** : nettoyage dépôt pour une future publication GitHub (visibilité inchangée ; pas de push `--force` ; pas de passage public).
- **Dépendances** : `fast-xml-parser` 5.10.0 → 5.11.1 ; Fastify 5.10.0 → 5.12.3 ; transitives Fastify `find-my-way` 9.9.0, `fast-uri` 3.1.7. Prisma 6.19.3 / `deepmerge-ts` : advisory restante (fix = major Prisma — non appliquée).
- **Portabilité** : bind mount PG via `POSTGRES_DATA_PATH` (défaut `./data/postgres`) ; chemin d’exploitation hors dépôt (`.env` local).
- **CI** : `.github/workflows/ci.yml` (`npm ci`, `prisma:generate`, `typecheck`, `test`, `build`) sans secrets.
- **Sécurité publique** : `SECURITY.md` (Private Vulnerability Reporting). Audit secrets arbre actuel : aucun secret réel dans les fichiers suivis.
- **Identité Git** : auteur unique `Apch132` avec e-mail personnel dans l’historique ; `git filter-repo` absent ; noreply absente de la config Git locale → **pas de réécriture**. Action manuelle restante avant passage public.
- **Contrôles** : `npm ci` OK ; `prisma:generate` OK ; `typecheck` OK ; `npm test` OK (659) ; `build` OK.
- **Commit** : corrections de ce nettoyage uniquement. **Push / visibilité GitHub** : non.

## 2026-08-02 — audit(metrics): métriques publication health explicites

- **Constat** : `/radar-admin health` affichait `Publications: total=N · main=…` — lu comme « N messages Discord visibles », alors que ce sont des compteurs `FolderPublication` (DB). Messages Discord supprimés manuellement restent comptés.
- **Correctifs** : libellés explicites (`enregistrées`, `msg_principal`, `complètes`, `partielles`, …) + compteurs `withMainMessage` / `pending` / `none` / `publishSucceeded` / `enrichSucceeded` ; disclaimer `base ≠ Discord live` ; doc gel 009.1A §12.1bis + DISCORD.md + doctrine 009.0.
- **Hors scope** : pas de sync Discord live ; pipeline / éditorial / matching / analyse inchangés.
- **Contrôles** : `npm run test` OK ; `npm run typecheck` OK ; `npm run build` OK.
- **Commit/push** : non (contrainte audit).

## 2026-08-01 15:20 — fix(build): prisma generate hoist-safe + prérequis build database

- **Symptôme Ubuntu** : `npm run build` → ~71 erreurs TypeScript dans `@radar-ia/database` (`TS2305` / `TS2307` / `TS7006` sur `@prisma/client`).
- **Cause** : scripts Prisma pointaient vers `packages/database/node_modules/prisma/...` ; avec npm Workspaces le CLI est **hoisté** à la racine → `prisma:generate` casse / n’est pas exécuté → client non généré → cascade tsc. L’agent Windows avait un client déjà généré en cache → faux positif « build OK ».
- **Correctifs** :
  - `packages/database/scripts/run-prisma.mjs` — résolution CLI via `require.resolve('prisma/package.json')` ;
  - `database` `build` = `prisma:generate && tsc` ;
  - doc `INSTALL.md` (symptôme + note build).
- **Contrôle** : `npm run clean` puis `npm run build` exit 0 (generate inclus).
- **Prochaine étape** : commit/push puis revalider sur Ubuntu.

## 2026-08-01 14:45 — Correctif 2 : fiabilisation veille et publications

- **Objectif** : une annonce majeure d’éditeur officiel ne doit plus pouvoir être manquée.
- **Providers** : abstraction `Source → Provider → Normalisation → …` avec `rss` / `atom` / `github_releases` actifs ; stubs `html` / `api` (enabled=false obligatoire). Champ `provider` requis dans `sources.json`.
- **Audit sources** : HTTP probe 26 sources ; `meta-ai-blog` désactivée (404) ; `microsoft-ai-blog` URL remplacée (`microsoft.com/en-us/ai/blog/feed`).
- **Importance déterministe** : `evaluateImportance` → Critical/High/Medium/Low **avant** LLM ; Critical + signaux majeurs → `deterministic_fallback` sans attendre Ollama.
- **Whitelist officielle** : OpenAI, Anthropic, Google, DeepMind, Meta, Mistral, Cursor, Qwen, DeepSeek, AI2, Ollama, Hugging Face (`official-whitelist.ts`).
- **Health** : `/radar-admin health` — sources vivantes/cassées, articles, dossiers, analyses, publications (**état base**, pas inventaire Discord live), erreurs, temps moyen, dernière publication. Définitions : gel 009.1A §12.1bis.
- **Golden tests** : Claude Opus 5, GPT, Gemini, Mistral, Cursor, Qwen + Ollama down → publish ; pipeline collect→match→analyse→publish (mock Discord).
- **Contrôles** : tests collector/analysis/database/bot/worker OK ; build OK ; Docker Ubuntu non rejoué depuis l’agent Windows (checklist Compose inchangée).
- **Commit/push** : non (contrainte Correctif 2).
- **Prochaine étape** : valider sur Ubuntu (`docker compose` + catch-up execute + message Discord réel ou mock).

## 2026-08-01 14:30 — fix(pipeline): diffusion Discord + fallback déterministe + sources

- **Cause racine** : (1) panne / réponse invalide Ollama → `analysis_failed` générique → zéro Discord ; (2) faux `updated` (ex. `updatedAt` flux / tracking / ordre catégories) → articles re-éligibles puis `matching.skipped` ; (3) sources stratégiques manquantes (Cursor, Qwen, DeepSeek, Llama models, AI2).
- **Correctifs** :
  - observabilité `analysis.failed` / `analysis.succeeded` (stage, statusCode, errorCode réel, durée, retryable) ;
  - diagnostic Ollama démarrage (serveur + modèle + génération minimale + parse) → mode dégradé non bloquant ;
  - fallback déterministe Tier S / whitelist pour annonces majeures (`proposalOrigin=deterministic_fallback`) ;
  - hash éditorial stable (exclut `updatedAt` volatil, tracking, whitespace, ordre catégories) ;
  - logs `matching.skipped` et `publication.*` structurés ;
  - rattrapage borné `npm run catch-up` (`--dry-run` défaut / `--execute`) ;
  - sources ajoutées : `cursor-blog`, `cursor-changelog`, `qwen-blog`, `deepseek-r1-releases`, `llama-models-releases`, `ai2-blog`.
- **Sources refusées** : Windsurf (plus de RSS officiel post-acquisition Devin) ; xAI/Grok (pas de RSS/Atom officiel stable) ; Cohere blog (HTML) ; Moonshot/Kimi blog (HTML ; releases Atom vides) ; LM Studio / Open WebUI / SGLang / LiteLLM (reportés pour éviter la dilution).
- **Contrôles** : `npm run test` OK ; `npm run typecheck` OK ; `npm run build` OK ; Docker Ubuntu non rejoué depuis l’agent Windows.
- **Déploiement** : redéployer worker + recopier `config/sources.json` ; `npm run catch-up -- --since <ISO>` en dry-run puis `--execute` si candidats pertinents.
- **Prochaine étape officielle** : — (aucune ouverte ; surveillance cycles post-déploiement).



## 2026-07-17 16:05 — audit(doc): sources et diffusion Discord

- **Résumé** : audit contradictoire non destructif du chemin registre → Discord ; rapport `docs/Audits/AUDIT_SOURCES_ET_DIFFUSION.md`.
- **Constats clés** : `FLUX_IA` = salon éditorial post-matching/analyse (pas flux RSS brut) ; `#flux-rss-brut` non implémenté ; GitHub = Atom/RSS URL uniquement (pas API / ranking) ; cycles `created=0` + `matching.skipped` sur `updated` déjà décidés → `analysis=0` / `publication=0` → Discord vide en régime stationnaire.
- **Périmètre** : lecture docs/gels/code/tests ; aucune modification métier, migration, reset PG, ni appel Discord.
- **Contrôles** : tests ciblés pipeline/collector/analysis OK ; Docker/PG Ubuntu non accessibles depuis l’agent Windows.
- **Prochaine étape officielle** : — (arbitration utilisateur A/B/C/D/E du rapport).



## 2026-07-17 15:35 — sync(runtime): Compose Ubuntu validé

- **Résumé** : alignement dépôt / docs sur la configuration **réellement validée** sur Ubuntu (stack bout-en-bout OK).
- **Compose figé** : bot + worker `network_mode: host` ; `OLLAMA_BASE_URL=http://127.0.0.1:11434` (pas `host.docker.internal`) ; PG bind mount via `POSTGRES_DATA_PATH` (chemin d’exploitation hors dépôt) ; `docker compose up -d` = postgres+bot ; worker via profile.
- **Exploitation** : worker 1er cycle ≈ 5 s puis 15 min ; `/radar-admin cycle` manuel optionnel ; `concurrent_lock` normal si cycle auto actif ; publication Discord seulement si pipeline complet franchi.
- **Reprise Ollama** : articles déjà rattachés **non** re-matchés automatiquement ; reprise analyse via `/radar-admin reanalyse` ; publication partielle via reprise auto + `/radar-admin resume`. Pas de changement métier (comportement documenté, pas de refactor pipeline).
- **Warnings Discord** : `Events.ClientReady` déjà en place ; `ephemeral` → `MessageFlags.Ephemeral` (admin handlers + tests).
- **Docs** : `docker-compose.yml`, `INSTALL.md`, `CONFIGURATION.md`, `README.md`, `ARCHITECTURE.md`, `handoff.md`.
- **Contrôles** : `npm run test` OK (558) ; `typecheck` OK ; `build` OK ; `docker compose config` / `up` **non exécutés** ici (binaire `docker` absent de la machine agent Windows) — déjà validés sur Ubuntu d’exploitation.
- **Prochaine étape officielle** : — (aucune ouverte).



## 2026-07-17 15:05 — feat(compose): bot Discord permanent

- **Résumé** : service Compose `bot` au même niveau que `postgres` (sans profile) — Docker = mode d’exécution normal du bot ; `npm run dev -w @radar-ia/bot` réservé au développement.
- **Compose** : `bot` — `node:20-bookworm`, `user: node`, `read_only`, `cap_drop: ALL`, `no-new-privileges`, `tmpfs /tmp`, `env_file: .env`, `DATABASE_URL` → `postgres`, `OLLAMA_*` + `extra_hosts` → `host.docker.internal`, mount monorepo `:ro`, `npm run start -w @radar-ia/bot`, `depends_on` postgres healthy. Worker reste en profile `worker`. Volume nommé `postgres_data` conservé.
- **Prérequis** : correctifs runtime déjà sur `main` (`47c11c7` — registre sources, HTTP 304, Ollama Compose worker).
- **Docs** : `docker-compose.yml`, `INSTALL.md`, `CONFIGURATION.md`, `README.md`, `ARCHITECTURE.md`, `handoff.md`.
- **Contrôles** : tests config/collector/worker OK ; `docker` / `docker compose` **absents** de la machine agent Windows (pas de WSL) — `docker compose config` / `up` / `ps` / logs Discord **non exécutés ici** ; à valider sur Ubuntu d’exploitation. Contrôle structurel YAML (services postgres/bot/worker) OK.
- **Hors commit** : `.env`, secrets, `Radar IA.zip`.
- **Prochaine étape officielle** : — (aucune ouverte).



## 2026-07-17 14:58 — fix(runtime)

- **Résumé** : correctifs après premiers essais réels (bot + worker + PG + Discord + Ollama) — registre sources + crash HTTP 304 + Compose Ollama.
- **registry_invalid** : `SOURCES_REGISTRY_PATH` relatif résolu via `process.cwd()` ; `npm run start -w` place le cwd dans `apps/bot|worker` → fichier introuvable. Correctif : `resolveSourcesRegistryPath` / `findMonorepoRoot` dans `@radar-ia/config` (absolu contre racine monorepo).
- **Crash 304** : `pinnedNodeFetch` faisait `new Response(body, { status: 304 })` — undici interdit un corps pour 101/103/204/205/304. Correctif : `buildWebResponse` + `NULL_BODY_STATUS_CODES`.
- **Compose** : conservé `extra_hosts` + `OLLAMA_BASE_URL=http://host.docker.internal:11434` pour le worker ; YAML `worker:` réindenté ; volume nommé `postgres_data` restauré (chemin hôte Ubuntu → `docker-compose.override.yml` gitignoré).
- **Contrôles** : `npm run test` OK (558) ; `typecheck` OK ; `build` OK ; `docker compose config` **non exécuté** ici (binaire `docker` absent de la machine agent Windows — à valider sur Ubuntu).
- **Docs** : `INSTALL.md`, `CONFIGURATION.md`, `.env.example`, `handoff.md`.
- **Prochaine étape officielle** : — (aucune ouverte).



## 2026-07-17 14:04 — tag(ubuntu-deploy-v1)

- **Résumé** : première validation complète du déploiement sur machine **Ubuntu propre** ; état figé par le tag Git annoté **`ubuntu-deploy-v1`**.
- **Validé sur Ubuntu** : Node.js 20 / npm ; Docker Compose ; PostgreSQL persistant ; `.env` ; Prisma generate / validate / migrate ; `npm run build` ; typecheck ; **546/546** tests ; worker démarré ; pipeline prêt.
- **Corrélation** : reproductibilité hors machine de développement confirmée (suite au correctif build topologique `88dc404`).
- **Tag** : `git tag -a ubuntu-deploy-v1` — message : « Première validation complète du déploiement Ubuntu » ; push `origin ubuntu-deploy-v1`.
- **Docs** : `README.md`, `docs/Setup/INSTALL.md`, `docs/handoff.md`.
- **Prochaine étape officielle** : — (aucune ouverte ; arbitration concepteur).



## 2026-07-17 13:54 — fix(build)

- **Résumé** : `npm run build` échouait sur Ubuntu (TS2307 `@radar-ia/*`) malgré typecheck / tests OK ; cause = ordre de compilation non topologique + `exports` → `dist/` uniquement.
- **Cause racine** : `npm run build --workspaces` lançait api / bot / worker / database **avant** que shared / config / analysis / collector n’émettent `dist/` ; `moduleResolution: NodeNext` ne résout pas les packages internes sans ces artefacts.
- **Pourquoi typecheck / vitest semblaient OK** : après un build partiel, les `dist/` des packages feuilles existent (typecheck trouve les `.d.ts`) ; Vitest résout le TypeScript source sans dépendre de `dist/`.
- **Correctif** : script `build` racine en **ordre topologique explicite** (shared → config → analysis → collector → database → api → bot → worker). Aucune logique métier / API / test modifiée.
- **Contrôles** : `npm run clean` puis `npm run build` OK (8/8) ; `npm run typecheck` OK après build.
- **Docs** : `README.md`, `docs/Setup/INSTALL.md`, `docs/handoff.md`.
- **Prochaine étape officielle** : — (aucune ouverte).



## 2026-07-17 13:10 — sync(docs)

- **Résumé** : suppression des formulations **v0.5** / « développement non commencé » dans Setup, Architecture, Reference, Project ; alignement **v1.0** sur le handoff.
- **Fichiers** : `INSTALL.md`, `CONFIGURATION.md`, `ARCHITECTURE.md`, `LLM.md`, `DISCORD.md`, `SOURCES.md`, `CONTRIBUTING.md` (+ README / `docs/README.md` / handoff de la sync précédente).
- **Hors scope** : gels Validation historiques (006.0 / 008.0…) laissés comme snapshots ; `.cursor/*` et `Radar IA.zip` non inclus.
- **Prochaine étape officielle** : — (aucune ouverte).



## 2026-07-17 13:05 — sync(docs)

- **Résumé** : alignement documentaire — `README.md` racine, `docs/README.md` et `docs/handoff.md` ; handoff = source de vérité.
- **Corrections handoff** : suppression des états obsolètes (010 « non démarré », 008/009 « en cours », §16 « non développé », risques pré-v1.0, §23 prochaine étape 009.1D).
- **Corrélation** : vitrine GitHub et index `docs/` reflètent monorepo **v1.0**, modules **001–010** clos, aucune étape officielle ouverte.
- **Prochaine étape officielle** : — (aucune ouverte ; arbitration concepteur).



## 2026-07-16 23:55 — 010.1A

- **Résumé** : remédiation complète des constats AUD-001→AUD-019 ; module **010 terminé** ; niveau final **10/10** sur l’audit 010.0 ; projet reste **v1.0** (packages `1.0.0`).
- **Livrable** : `docs/Validation/010.1A_Remediation_Report.md`.
- **Corrections majeures** : lock pipeline `FOR UPDATE` ; lease publication Discord ; `InferenceLock` Ollama ; SSRF pin DNS ; TTL/heartbeat ; rétention snapshots ; Docker durci ; admin sanitize + rate-limit ; prompt untrusted framing.
- **Migration** : `20260716234500_remediate_010_1a_hardening`.
- **Contrôles** : `npm run test` OK ; `typecheck` OK ; `build` OK ; `prisma:generate` OK ; `npm audit` 0 vuln. ; `git diff --check` OK.
- **Réserves runtime** : `prisma:migrate:deploy` / `docker compose config` si Docker/PG absents de la machine.
- **Commit / push** : `fix(audit): remediate global quality and security findings` — `43540c70f86b6db626c3920e45c7c837fe7ab3b9`.
- **Prochaine étape officielle** : — (aucune ouverte).



## 2026-07-16 23:45 — 010.0

- **Résumé** : ouverture du module **010** (évolutions post-v1.0) ; audit global qualité / robustesse / sécurité **terminé** ; **aucune correction code** ; projet reste en **v1.0**.
- **Livrable** : `docs/Validation/010.0_Global_Audit_Report.md` — **19** constats (1 critique, 6 importants, 7 moyens, 5 améliorations).
- **Principaux risques** : lock pipeline non atomique (AUD-001) ; publication Discord sans lease d’exécution (AUD-002) ; concurrence Ollama multi-process + réanalyse hors lock (AUD-003) ; SSRF DNS rebinding (AUD-004) ; TTL/heartbeat incohérents (AUD-005).
- **Docs** : `docs/README.md` (lien Validation) ; `handoff.md` (état 010 / prochaine étape **010.1A**).
- **Interdictions respectées** : pas de modification code / Prisma / Docker / migration / dépendance ; pas de correctif de vulnérabilité.
- **Contrôles** : audit complet ; liens Markdown Validation ; `git diff --check` ; `git status --short`.
- **Commit / push** : `docs(audit): add global audit report` (voir hash dans le compte rendu Cursor).
- **Prochaine étape officielle** : **010.1A** (corrections validées à partir du rapport).



## 2026-07-16 23:30 — 009.1E

- **Résumé** : surface d’administration Discord livrée ; module **009 terminé** ; projet passé en **v1.0** ; roadmap initiale 001–009 clôturée ; module **010** ouvert uniquement comme évolution post-v1.0 (**non démarré**).
- **Commandes** : `/radar-admin` — `status` · `sources` · `cycle` · `resume` · `reanalyse` · `interventions` (éphémères ; allowlist `DISCORD_ADMIN_USER_IDS`).
- **Façade** : `createAdminOpsService` dans `@radar-ia/database` (status / interventions + appels orchestrateurs + audit `AdminOperationLog`).
- **Bot** : composition mince 004–008 pour ops ; pas de logique métier Discord ; Prisma hors bot pour décisions.
- **Config** : `DISCORD_ADMIN_USER_IDS` (snowflakes utilisateur, pas de rôles).
- **Docs** : `DISCORD.md`, `CONFIGURATION.md`, `docs/README.md`, `handoff.md`.
- **Contrôles** : `npm run test` OK ; `typecheck` OK ; `build` OK ; `git diff --check` OK.
- **Commit / push** : `411ccac` — `feat(admin): complete administration module` (push `origin/main`).
- Validations : permissions / allowlist / slash / worker+scheduler / orchestration / persistance / reprise / observabilité — conformes au gel 009.1A pour la surface livrée.



## 2026-07-16 23:15 — 009.1D

- **Résumé** : worker dédié `@radar-ia/worker` livré — héberge `createPipelineOrchestrator`, scheduler minimal, composition réelle 004–008, arrêt propre. **Aucune** surface slash admin / API admin / dashboard.
- **Architecture** : hôte mince `apps/worker` ; config centralisée ; client Discord publication-only (réutilise `@radar-ia/bot/publication`) ; single-flight PostgreSQL inchangé ; bot = UI Discord ; API = `/health`.
- **Fichiers créés** : `apps/worker/**` (`package.json`, `tsconfig`, `vitest.config`, `src/index.ts`, `worker.ts`, `scheduler.ts`, `holder-id.ts`, `logger.ts`, `discord-runtime.ts`, `ollama-probe.ts`, `pipeline-collector.ts`, `pipeline-composition.ts`, tests).
- **Fichiers modifiés** : `packages/config/src/{schema,env,index,create-config.test}.ts` ; `.env.example` ; `docker-compose.yml` (profile `worker`) ; `package.json` (`dev:worker` / `start:worker`) ; `docs/Setup/CONFIGURATION.md` ; `docs/Architecture/ARCHITECTURE.md` ; `docs/handoff.md`.
- **Configuration** : `SOURCES_REGISTRY_PATH`, `WORKER_SCHEDULER_ENABLED`, `WORKER_CYCLE_INTERVAL_MS`, `WORKER_INITIAL_DELAY_MS`, `PIPELINE_LOCK_TTL_MS`, `PIPELINE_HEARTBEAT_INTERVAL_MS`, `WORKER_HOLDER_PREFIX` (Zod, bornées, pas de fuite secret).
- **Scheduler** : délai initial + intervalle après fin de cycle ; au plus un tick local ; pas de rafale après tick manqué ; erreurs de cycle non fatales ; mode one-shot si scheduler désactivé ; timers injectables.
- **Composition pipeline** : HTTP sécurisé + collector + normalizer + matching + analysis (Ollama) + publication (Discord port) → `createPipelineOrchestrator` ; `holderId` stable `prefix:host:pid:suffix`.
- **Discord / Ollama** : login Discord optionnel — indisponible → cycle `degraded` sans arrêt ; Ollama down au démarrage → warn, worker vivant.
- **Shutdown** : `SIGINT`/`SIGTERM` → stop scheduler → attendre cycle actif → destroy Discord → `$disconnect` Prisma ; double shutdown idempotent.
- **Tests** : suite worker **24** OK ; config **14** OK ; monorepo `npm run test` OK (api 4, bot 29, worker 24, analysis 100, collector 143, config 14, database 182, shared 36).
- **Contrôles** : `prisma:validate` OK ; `prisma:generate` OK ; `typecheck` OK ; `build` OK ; `git diff --check` OK (périmètre 009.1D).
- **Docker / runtime** : Compose profile `worker` ajouté ; `docker compose config` **non exécuté** (binaire `docker` absent de l’environnement agent). Runtime live Discord / Ollama / PostgreSQL **non validé** ici.
- **Dépendances** : workspace `@radar-ia/worker` (deps existantes : analysis, bot, collector, config, database, discord.js) ; **aucune** nouvelle lib de scheduling.
- **Commit / push** : `72bb80a2fc90a972056a8dd47576cb1d4f36cb0b` — `feat(admin): add pipeline worker runtime` (push `origin/main` OK).
- Module **009** en cours (009.0→009.1D ✅ ; 009.1E ⏳ ; 83 % sur étapes nommées). Version projet **0.9**. Prochaine étape officielle : **009.1E**.



## 2026-07-16 22:55 — 009.1C

- Orchestrateur du cycle d’exploitation livré dans `@radar-ia/database` : `createPipelineOrchestrator` (couche injectable / testable ; **pas** de worker, scheduler, slash commands ni API admin).
- Fichiers créés : `packages/database/src/pipeline-orchestrator.ts`, `pipeline-orchestration-types.ts`, `pipeline-orchestrator.test.ts`.
- Fichiers modifiés : `normalized-article-repository.ts` / types (`unchanged`) ; `news-folder-repository.ts` (`listFoldersByStatuses`, `getArticleMembership`, `hasMatchingDecisionForArticle`) ; `index.ts` ; mocks tests publication ; `docs/handoff.md` ; `docs/Architecture/ARCHITECTURE.md`.
- Flux : acquire lock → create run → load registry → collect eligible → persist raw/state → normalize/persist articles → matching → analysis → publication → resume retryable → finalize run → release lock (+ heartbeat TTL).
- Parcours couverts (tests) : cycle nominal ; refus concurrent ; disabled / backoff / 304 ; erreur source locale ; rejets normalisation ; create→match→analyse→publish ; `duplicate_editorial` / `ambiguous_no_action` sans action auto ; Ollama down ; Discord down (publish différé) ; resume `partial` ; `inconsistent` non repris ; heartbeat ; release succès/échec ; statuts completed/degraded/failed ; idempotence 2e cycle ; déterminisme compteurs ; pas de fuite secret ; frontières packages.
- Comportements dégradés : source KO, Ollama KO, Discord KO, resume KO → `degraded` ; registre illisible → `failed` ; concurrent → refus non fautif (`rejectionCode: concurrent_lock`).
- Tests : `pipeline-orchestrator.test.ts` (27) ; suite `@radar-ia/database` **182** tests OK ; monorepo `npm run test` OK.
- Contrôles : `typecheck` OK ; `build` OK ; `vitest` database 182 OK ; `git diff --check` OK (fichiers 009.1C) ; `git status --short` OK (hors `.cursor` non inclus).
- Dépendances : **aucune** nouvelle dépendance npm (`@radar-ia/collector` reste hors `database` via ports injectables).
- Réserves : worker / scheduler / slash / API admin reportés à **009.1D+** ; seuils backoff sources = constantes V1 injectables (gel laisse l’exploitation) ; `migrate deploy` non requis (pas de nouveau schéma Prisma).
- Commit / push : `a10154c183811074b21ecaf7bf301ded774bdc01` — `feat(admin): orchestrate pipeline cycle` (push `main` OK ; sync hash `e5a7fad72b7475c815fa48b50908ac1cc902948f`).
- Module **009** en cours (009.0 ✅ ; 009.1A ✅ ; 009.1B ✅ ; 009.1C ✅ ; 80 % sur étapes nommées). Version projet **0.9** inchangée. Prochaine étape officielle : **009.1D**.



## 2026-07-16 22:45 — 009.1B

- Modèle de données et persistance du module **009 — Administration** livrés dans `@radar-ia/database` (aucune orchestration, aucun scheduler, aucune commande Discord).
- Schéma Prisma + migration `20260716224200_add_administration_persistence` : `PipelineRun`, `PipelineLock` (singleton `global`), `AdminOperationLog` ; extension `CollectedSourceState` (`consecutiveFailures`, `nextEligibleAt`) — arbitrage R4 = **extension** (pas de nouveau modèle).
- Repositories : `createPipelineLockRepository` (acquire / heartbeat / release / steal TTL / list runs) ; `createAdminOperationLogRepository` (append-only) ; backoff via `createRawFeedRepository` (`recordSourceBackoff`, `clearSourceBackoff`, `listSourcesInBackoff`, …).
- Exports publics mis à jour dans `packages/database/src/index.ts`.
- Tests : `administration-repository.test.ts` + extension `raw-feed-repository.test.ts` ; suite database **155** tests OK.
- Contrôles : `prisma:generate` OK ; `migrate deploy` **non exécuté runtime** (PostgreSQL injoignable / Docker absent — réserve connue) ; `vitest` 155 tests OK ; `typecheck` OK ; `build` OK ; `git diff --check` OK (fichiers 009.1B) ; `git status --short` OK.
- Commit / push : `403fae755162bf5a2ff6b3981a3fd0bfff34a892` — `feat(admin): add administration persistence layer` (push `main` OK ; sync hash `0d70ca0eea9b6e109ebcd50752808aa2d250ecec`).
- Module **009** en cours (009.0 ✅ ; 009.1A ✅ ; 009.1B ✅ ; 75 % sur étapes nommées). Version projet **0.9** inchangée. Prochaine étape officielle : **009.1C**.



## 2026-07-16 22:37 — 009.1A

- Gel fonctionnel **normatif** du module **009 — Administration** livré (documentaire uniquement).
- Créé : `docs/Validation/009.1A_Gel_Fonctionnel_Administration.md` (périmètre, permissions, worker, cycle, single-flight, sources, reprise, ops manuelles, observabilité, persistance conceptuelle, A01–A18, arbitrages R1–R8).
- Mis à jour : `009.0` (historique), `docs/README.md`, `ARCHITECTURE.md`, `DISCORD.md`, `docs/handoff.md`.
- Arbitrages figés : worker dédié ; allowlist user IDs seulement ; Discord = produit ; pas Web / API publique ; fichier = définition sources / DB = runtime ; single-flight PostgreSQL ; historique append-only ; backend décisionnaire ; API = `/health` seul ; Discord down = skip publish ; Ollama startup = warn ; `ambiguous_no_action` = consultation seule.
- Reportés à **009.1B** / étapes techniques : schéma Prisma run/lock/audit/source runtime ; noms commandes / env / colonnes.
- Contrôles : cohérence 009.0 + gels 006–008 ; `git diff --check` ; `git status --short` ; confirmation qu’aucun fichier `apps/**`, `packages/**`, Prisma, migration, dépendance ou Docker n’a été modifié.
- Aucun code applicatif ; aucun Prisma ; aucune migration ; aucune dépendance ; aucun worker Compose.
- Commit / push : `6f712f050fb138fa048971945c1e66bda57097d1` — `docs(admin): freeze administration module` (push `main` OK ; sync hash `3c963569ec5226b3eeb6c68b66f2a68f0ba4b3c6`).
- Module **009** en cours (009.0 ✅ ; 009.1A ✅ ; 67 % sur étapes nommées 009.0 / 009.1A / 009.1B). Version projet **0.9** inchangée. Prochaine étape officielle : **009.1B**.



## 2026-07-16 22:27 — 009.0

- Conception / doctrine fonctionnelle du module **009 — Administration** (étape documentaire uniquement).
- Audit préalable : briques 004–008 livrées au niveau packages (collector, orchestrateurs matching/analyse/publication, adaptateur Discord, Prisma) ; **aucun** câblage runtime apps (scheduler, cycle collect→publish, slash admin, API métier) ; API limitée à `/health` ; bot sans `InteractionCreate` ; backoff sources doctrine non implémenté ; réserves 006–008 (`ambiguous_no_action`, `analysis_exhausted`, `inconsistent`, force republish, reopen dossier) confirmées.
- Document créé : `docs/Validation/009.0_Doctrine_Administration.md`.
- Documents modifiés : `docs/README.md`, `docs/Architecture/ARCHITECTURE.md`, `docs/Architecture/DISCORD.md`, `docs/handoff.md`.
- Recommandations majeures : surface ops = slash Discord allowlistées + CLI ; runtime cycle = bot ou worker minimal (pas l’API comme chef d’orchestre) ; single-flight PostgreSQL ; registre sources fichier = définition / DB = exécution ; pas de nouveau package V1 ; pas de Web / API publique.
- Arbitrages ouverts pour **009.1A** : bot vs worker dédié ; status Fastify interne ; allowlist user vs user+role ; modèle runtime source ; comportement Discord down ; noms commandes/env/Prisma ; gravité Ollama down ; portée réévaluation `ambiguous_no_action`.
- Contrôles : relecture croisée doctrines/gels 006–008 ; vérification liens Markdown ; `git diff --check` ; `git status --short` ; confirmation qu’aucun fichier `apps/**`, `packages/**`, Prisma, migration, dépendance ou lockfile n’a été modifié.
- Aucun code applicatif, Prisma, migration, dépendance ni implémentation 009 ajoutés.
- Commit / push : `3064730ef04df529ef8fcbf7b70d19ddab49b1fb` — `docs(admin): define administration module doctrine` (push `main` OK ; sync hash `572c0d2fba3cb098056fe57dfde4455ac6ba4068`).
- Module **009** en cours (009.0 ✅ ; 50 % sur étapes nommées 009.0 / 009.1A). Version projet **0.9** inchangée. Prochaine étape officielle : **009.1A — Gel fonctionnel du module Administration**.



## 2026-07-16 22:15 — 008.1F

- Validation finale et clôture officielle du module **008 — Publication Discord**.
- Tests d’intégration pipeline (`packages/database`) : 18 scénarios E2E mocks (publish, enrich, hold, reject_editorial, partial, resume, idempotence publish/enrich, dossier closed, erreur retryable/terminale, salon unmapped, thread archivé/verrouillé, perte d’IDs / inconsistent, reprise après redémarrage, cohérence repo↔orchestrateur↔port, anti-duplication) + 4 audits d’architecture (frontières discord.js / Prisma / packages).
- Tests d’intégration bot (`apps/bot`) : chaînage adaptateur discord.js + orchestrateur sans réseau réel (publish complet, salon absent, thread archivé, thread verrouillé, port sans logique métier).
- Harness : `publication-integration-harness.ts` (Prisma double + wiring orchestrateur / repository / port).
- Validations : `npm run test` ; `typecheck` ; `build` ; `git diff --check` sur le périmètre 008.1F.
- Docs : `DISCORD.md` + handoff synchronisés (008 → 100 %, global 89 %, version **0.9**, prochaine **009.0**).
- Aucune nouvelle règle métier ; aucun Prisma / migration ; aucune nouvelle dépendance ; aucun développement 009.
- Commit / push : `c49d9e5e4aaf6a9b5fece3a2ddabc5c155c5ddc5` — `test(discord): validate publication pipeline` (push `main`).
- Module **008** officiellement **terminé**. Prochaine étape officielle : **009.0**.



## 2026-07-16 21:58 — 008.1E

- Implémentation concrète du port Discord livrée dans `@radar-ia/bot` via `createDiscordPublicationAdapter(client)` et `createPublicationChannelResolver(config)`.
- Conversion minimale `RenderedDiscordPayload` / `DiscordEmbedPayload` → `discord.js` ; `allowedMentions` verrouillé (`parse: []`, `users: []`, `roles: []`, `repliedUser: false`) pour empêcher toute mention involontaire.
- Opérations couvertes : message principal, création du fil depuis le message (`autoArchiveMinutes = 1440`), réouverture d’un fil archivé, publication d’un enrichissement dans le fil, `fetchMessage` ciblé pour la réconciliation.
- Vérifications minimales ajoutées : salon/fil accessible, type textuel compatible, permissions `ViewChannel`, `SendMessages`, `EmbedLinks`, `ReadMessageHistory`, `CreatePublicThreads`, `SendMessagesInThreads`, `ManageThreads` si désarchivage ; aucun `Administrator`, aucun `MessageContent`.
- Normalisation d’erreurs bot : `channel_unavailable`, `missing_permission`, `discord_timeout`, `discord_unavailable`, `inconsistent_state`, `unknown` sans fuite de secrets ni de token.
- `@radar-ia/config` étendu : variables `DISCORD_CHANNEL_ANNONCES_MAJEURES`, `DISCORD_CHANNEL_VEILLE_PERTINENTE`, `DISCORD_CHANNEL_FLUX_IA` validées comme snowflakes Discord ; exigées en production avec les autres variables Discord.
- Bootstrap bot aligné sur le gel 008.1A : intents `Guilds` + `GuildMessages` uniquement ; pas de `MessageContent`, `GuildMembers` ni `GuildPresences`.
- Tests Vitest ajoutés / adaptés : port bot (16 cas) + config (12 cas) + bootstrap bot (8 cas) ; couverture sur message principal, conversion embed, `allowedMentions`, création/réouverture de fil, refus fil verrouillé, erreurs normalisées, resolver salons, absence de fallback, intents, absence d’appel réseau réel, non-fuite des secrets.
- Documentation synchronisée : `.env.example`, `docs/Setup/CONFIGURATION.md`, `docs/Architecture/DISCORD.md`, `docs/handoff.md`.
- Validations ciblées en cours au moment de la sync : `npm run test --workspace @radar-ia/config` OK ; `npm run test --workspace @radar-ia/bot` OK ; validations globales / commit / push à compléter avant clôture.
- Fichiers principaux : `apps/bot/src/publication/*`, `apps/bot/src/client.ts`, `apps/bot/src/bot.test.ts`, `apps/bot/package.json`, `packages/config/src/*`, `.env.example`, docs Discord/config/handoff.
- Commit / push : en attente de validation finale.
- Prochaine étape officielle : **008.1F**.

## 2026-07-16 21:45 — 008.1D

- Orchestrateur métier de publication Discord livré dans `@radar-ia/database` (`createPublicationOrchestrator`).
- Parcours : `publish`, `enrich_thread_only`, `hold`, `reject_editorial` ; `resume()` pour reprise `partial` → `create_thread`.
- Chaîne figée : repository 008.1B → builders 008.1C → port `DiscordPublicationPort` (interface seule) → persistance des snowflakes.
- Idempotence : réserver DB avant tout appel Discord ; clés `publish:` / `create_thread:` / `enrich:` ; jamais de double message principal.
- `hold` / `reject_editorial` : skip déterministe, zéro Discord, aucune mutation `FolderPublication`.
- Types publics : `PublicationOrchestrationInput` / `Result`, `DiscordPublicationPort`, `DiscordPublicationPortError`, `PublicationChannelResolver`.
- Tests Vitest (mocks) : publish / enrich nominaux, hold, reject, erreur port, succès partiel, idempotence, reprise, transitions interdites, ordre repository / builders / port (18 cas).
- Validations : `npm run test` OK ; `typecheck` OK ; `build` OK ; `git diff --check` OK sur le périmètre 008.1D.
- Docs : `DISCORD.md` + handoff synchronisés (008 à 83 %, global 87 %, prochaine **008.1E**).
- Aucun discord.js ; aucun `apps/bot` ; aucun Prisma / migration ; aucune nouvelle dépendance ; aucune règle métier hors gel 008.1A.
- Fichiers principaux : `publication-orchestrator.ts`, `publication-orchestration-types.ts`, `publication-orchestrator.test.ts`, `packages/database/src/index.ts`.
- Commit / push : `3f5e1d7cf64db7065c8b230a2abfa66fb893ab07` — `feat(database): orchestrate Discord publication` (push `main`).
- Prochaine étape officielle : **008.1E**.

## 2026-07-16 21:25 — 008.1C

- Contrats publics et construction déterministe du contenu Discord livrés dans `@radar-ia/shared` (couche pure, sans réseau / Prisma / discord.js / Fastify / env).
- Builders : `buildMainPublicationContent`, `buildEnrichmentPublicationContent`, `buildThreadName` ; salons métier `ANNONCES_MAJEURES` / `VEILLE_PERTINENTE` / `FLUX_IA`.
- Sanitization : `@everyone` / `@here` / mentions user-role, strip HTML, caractères de contrôle ; URLs HTTP(S) uniquement ; dédup + ordre déterministe des sources / faits.
- Limites Discord centralisées (`DISCORD_LIMITS`) ; troncature `…` ; warnings structurés ; `PublicationContentError` uniquement si payload impossible.
- Payload abstrait `RenderedDiscordPayload` (texte + embed) compatible futur port `@radar-ia/bot`.
- Tests Vitest : 23 cas (nominal principal / enrichissement, déterminisme, mentions, HTML, contrôles, troncatures, champs, total embed, fil, sources / URLs, résumé minimal, contrat port) ; package shared 36 tests OK.
- Validations : `npm run test` OK ; `typecheck` OK ; `build` OK ; `git diff --check` OK sur le périmètre 008.1C.
- Docs : `DISCORD.md` + handoff synchronisés (008 à 80 %, global 87 %, prochaine **008.1D**).
- Aucun Discord réel ; aucun `discord.js` ; aucun Prisma / `apps/bot` / orchestrateur ; aucune nouvelle dépendance ; aucune nouvelle règle métier hors gel 008.1A.
- Fichiers principaux : `publication-discord-*.ts` (+ tests), `packages/shared/src/index.ts`, `DISCORD.md`, `handoff.md`.
- Commit / push : `c71de3b4c6caa8832c4668fb48b50a9981400b37` — `feat(shared): build Discord publication content` (push `main`).
- Prochaine étape officielle : **008.1D**.



## 2026-07-16 21:15 — 008.1B

- Modèle de données et persistance de la Publication Discord livrés dans `@radar-ia/database`.
- Prisma : `FolderPublication` (état courant, unicité `folderId`) + `PublicationAttempt` (historique append-only) ; enums `PublicationStatus`, `PublicationOperationKind`, `PublicationAttemptStatus`, `PublicationErrorCode`.
- `hasMainPublication` dérivé (pas de colonne) : `mainMessageId != null` ∧ status ∈ {`partial`, `main_published`, `inconsistent`}.
- Migration `20260716211000_add_folder_publication_data_model` : tables, FK `ON DELETE RESTRICT`, index reprise / chronologie / fingerprint ; unicité active partielle sur `idempotencyKey` (`reserved`|`succeeded`).
- Repository `createPublicationRepository` : getOrCreate, reservePublish / reserveOperation, recordMainPublicationSuccess / recordThreadCreated / recordEnrichmentPublished / recordFailure, lectures + listRetryableAttempts / listPublicationsNeedingResume.
- Erreur métier `PublicationPersistenceError` (codes stables : dossier absent / closed, déjà réservé, précondition enrich, transition interdite, etc.).
- Tests Vitest : 20 cas (schéma, unicité, réservation atomique / idempotente, partiel, thread, enrich, historique, closed, retryable, transitions, rollback) ; package database 104 tests OK.
- Validations : `prisma:validate` / `prisma:generate` OK ; `npm run test` OK ; `typecheck` / `build` OK ; `git diff --check` OK sur le périmètre 008.1B.
- Réserve PostgreSQL runtime : `prisma:migrate:deploy` échoue (P1001 — `localhost:5432` injoignable) ; migration SQL livrée, non appliquée ici.
- Docs : `DISCORD.md` + handoff synchronisés (008 à 75 %, global 86 %, prochaine **008.1C**).
- Aucun `discord.js` ; aucune modification `apps/bot` ; aucun orchestrateur / embed / Fastify ; aucune nouvelle dépendance.
- Fichiers principaux : `schema.prisma`, migration SQL, `publication-types.ts`, `publication-repository.ts` (+ tests), `index.ts`, `DISCORD.md`, `handoff.md`.
- Commit / push : `8b699f1891f72713e26cdc3e43a61a6ab427fe26` — `feat(database): persist Discord publications` (push `main`).
- Prochaine étape officielle : **008.1C**.



## 2026-07-16 15:55 — 008.1A

- Gel fonctionnel **normatif** du module **008 — Publication Discord** livré (documentaire uniquement).
- Créé : `docs/Validation/008.1A_Gel_Fonctionnel_Publication_Discord.md` (états, workflows, routage, idempotence, reprise, persistance conceptuelle, config, permissions, P01–P20, arbitrages §0.1).
- Mis à jour : `008.0` (historique), `docs/README.md`, `DISCORD.md`, `ARCHITECTURE.md`, `LLM.md`, `docs/handoff.md`.
- Arbitrages figés : réserve DB puis Discord ; dossier `closed` = refus ; env `DISCORD_CHANNEL_*` ; embed + texte court ; fil `Veille — {title}` ; retries 5 / backoff figé ; intents `Guilds`+`GuildMessages` ; RSS techniques hors métier V1 (noms non inventés) ; recreate manuelle → 009.
- Contrôles : relecture cohérence ; `git diff --check` ; aucun fichier applicatif / Prisma / migration / dépendance modifié.
- Aucun code applicatif ; aucun Prisma ; aucune migration ; aucune dépendance ; aucune implémentation Discord.
- Commit / push : `41d21d60f5bbf3de90e885856f1ce3f79cb4c193` — `docs(discord): freeze publication functional rules` (push `main`).
- Prochaine étape officielle : **008.1B**.



## 2026-07-16 15:45 — 008.0

- Conception / doctrine fonctionnelle du module **008 — Publication Discord** livrée (documentaire uniquement).
- Créé : `docs/Validation/008.0_Doctrine_Publication_Discord.md` (rôle, frontières, décisions 007, salons, routage, cycle de vie, idempotence, persistance conceptuelle, reprise, rate limits, permissions, sécurité, observabilité, config, frontières 009, cas limites, options d’architecture, interfaces conceptuelles, critères **P01–P20**, arbitrages).
- Mis à jour : `docs/README.md`, `docs/Architecture/DISCORD.md`, `docs/handoff.md` (état + journal).
- Audit préalable : handoff ; gels 006.1A / 007.0 / 007.1A ; `DISCORD.md` / `ARCHITECTURE.md` / `LLM.md` ; bootstrap `apps/bot` ; `@radar-ia/config` (`threadArchiveDurationHours = 24`) ; décisions / `channelHint` 007 ; absence de modèles publication Prisma.
- Recommandations structurantes : orchestration `@radar-ia/database` + port Discord bot ; format texte court + embed ; fil attaché au message principal ; pas de recreate auto si suppression manuelle.
- Arbitrages ouverts pour 008.1A : noms 3 salons RSS techniques ; variables d’env IDs salons ; politique dossier `closed` ; budgets retry ; design embed exact.
- Contrôles : relecture cohérence docs ; `git diff --check` ; aucun fichier applicatif / Prisma / migration / dépendance / lockfile modifié.
- Aucun code applicatif ; aucun Prisma ; aucune migration ; aucune dépendance ; aucune implémentation Discord.
- Commit / push : `d249b260b95fd6e803ab981f169a811730043874` — `docs(discord): define publication module doctrine` (push `main`).
- Prochaine étape officielle : **008.1A — Gel fonctionnel de la Publication Discord**.



## 2026-07-16 15:25 — 007.1F

- Validation finale et clôture officielle du module **007 — Analyse IA**.
- Audit : exports publics `@radar-ia/analysis` / `@radar-ia/database` complets vs gel 007.1A ; constantes timeouts / retries / budgets / seuils alignées ; aucune dépendance Discord / Fastify dans le périmètre 007.
- Alignement gel : idempotence ne réutilise plus une analyse `hold` (décisions terminales seules : `publish` / `enrich_thread_only` / `reject_editorial`) — permet l’anti-blocage §9.5 / critère O.
- Tests : matrice gel §17 A–O (`analysis-gel-acceptance.test.ts`, 15 cas) ; test service « 2 hold → reject_editorial » ; analysis 100 ; database 84.
- Validations : `npm run test` ; `typecheck` ; `build` ; `git diff --check` sur le périmètre 007.1F.
- Docs : `LLM.md` + handoff synchronisés (007 → 100 %, global 78 %, version **0.8**, prochaine **008.0**) ; docs Validation 007.0 / 007.1A versionnés.
- Réserves : PostgreSQL migrate deploy non validé runtime ; pas de câblage scheduler / apps ; `hasMainPublication` défaut `false` ; publication Discord 008 absente.
- Aucune nouvelle règle métier hors alignement gel ; pas de Fastify / Discord / migration / modèle IA.
- Commit / push : `10d3e623880c10080c78bb27bd91d5d5b9ed1aea` — `feat(analysis): finalize AI analysis module` (push `main`).
- Module **007** officiellement **terminé**. Prochaine étape officielle : **008.0 — Conception du module Publication Discord**.



## 2026-07-16 15:20 — 007.1E

- Orchestrateur Analyse IA livré dans `@radar-ia/database` : `createAnalysisOrchestrator(prisma, options).process(input)`.
- Mapping 006 → 007 : `create_dossier` / `attach_enrich` chargent l’agrégat et appellent 007.1D ; `duplicate_editorial` / `ambiguous_no_action` short-circuit `skipped` / `not_eligible` (zéro Ollama).
- Chargement agrégat : dossier, memberships ordonnées, articles normalisés (`getNormalizedArticlesByIds`), faits 006, primary, dernière analyse acceptée, `previousEnrichmentFactKeys`.
- Frontières transactionnelles : pas de `$transaction` autour d’Ollama ; persistance 006 et 007 découplées ; erreur 007 ne rollback pas 006 ; écritures 007 append-only via 007.1B.
- Idempotence / reprise : déléguées à 007.1D (`reused`, retries, `analysis_exhausted`, `model_mismatch`) ; `forceReanalysis` admin propagé.
- Résultats typés : `analyzed` / `reused` / `skipped` / `failed` (+ `matchingResultToAnalysisInput`).
- `hasMainPublication` défaut documenté `false` (008 absent).
- Tests Vitest orchestrateur : 21 cas (4 issues 006, agrégat, primary, tiers, faits, reused, failed, transactions, déterminisme).
- Validations : tests database / analysis ; `npm run test` ; `typecheck` ; `build` ; `git diff --check`.
- Docs : `LLM.md` + handoff synchronisés (007 à 86 %, prochaine 007.1F).
- Fichiers principaux : `packages/database/src/{analysis-orchestrator,analysis-orchestration-types,normalized-article-repository,index}.ts` (+ tests).
- Dépendance workspace : `@radar-ia/analysis` ajoutée à `@radar-ia/database` ; pas de Fastify / Discord / module 008.
- Commit / push : `712534d634e3c974b632958b7503d8fff647e475` — `feat(analysis): orchestrate AI analysis pipeline` (push `main`).
- Prochaine étape officielle : **007.1F — Validation finale et intégration du module Analyse IA**.



## 2026-07-16 15:05 — 007.1D

- Service d’analyse IA livré dans `@radar-ia/analysis` : `createAnalysisService(dependencies).analyze(input)`.
- Règles pures : éligibilité / réanalyse matérielle, fingerprint SHA-256, contexte borné (12k / 3k / 2k), prompt V1 FR, ancrage faits, dédup entités, scoring backend, décisions publish / enrich_thread_only / hold / reject_editorial, hint salon.
- Fingerprint : canonicalisation déterministe UTF-8 (`folderId` + articles triés + faits `key=value` triés + status) → hex lowercase 64.
- Persistance : port injectable compatible `createAnalysisAttemptRepository` (007.1B) ; skips tracés `rejected` + `not_eligible` / `enrichment_immaterial` ; échecs pré-parse → `hold` ; append-only.
- Client 007.1C non dupliqué (un seul `infer` ; retries transport uniquement) ; `analysis_exhausted` si tentatives client ≥ 3.
- Tests Vitest : 84 au total package (fingerprint, éligibilité, contexte, prompt, faits, scoring, décisions, service) ; sans réseau / Ollama / Discord.
- Validations : `npm run test` / `typecheck` / `build` / `git diff --check` sur le périmètre 007.1D.
- Docs : `LLM.md` + handoff synchronisés (007 à 83 %, prochaine 007.1E).
- Fichiers principaux : `packages/analysis/src/{analysis-service,analysis-service-types,aggregate-fingerprint,analysis-context-builder,analysis-prompt,analysis-fact-validation,analysis-scoring,analysis-decision,analysis-eligibility,index}.ts` (+ tests).
- Aucune dépendance npm ajoutée ; pas de Fastify / Discord / module 008.
- Commit / push : `993f33c92727087031ce44065f9759321fa3c65c` — `feat(analysis): add AI analysis service` (push `main`).
- Prochaine étape officielle : **007.1E — Orchestration Analyse IA et intégration avec la déduplication**.



## 2026-07-16 14:50 — 007.1C

- Client Ollama et validation stricte du contrat `AnalysisProposalV1` livrés dans `@radar-ia/analysis`.
- Nouveau package workspace : `createOllamaAnalysisClient` (POST `/api/generate`, `format: json`, modèle injecté via config).
- Concurrence = 1 (mutex FIFO) ; timeout inférence 90 s ; timeout file 300 s ; retry max 3 (délais 5 s / 15 s).
- Validation Zod stricte : enums, bornes, `schemaVersion: "1"`, `empty_summary` / `schema_violation` / `invalid_json` ; pas d’extracteur Markdown.
- API publique : proposition validée ou erreur normalisée ; aucune décision métier, scoring, fingerprint, Fastify, Discord ni 008.
- Dépendance : `zod` ^3.25.76 (alignée monorepo).
- Tests Vitest : 27 (17 validation + 10 client : succès, timeout, retry, JSON/schéma/enums/summary, queue, sérialisation).
- Validations : `npm run test` OK ; `typecheck` / `build` OK ; `git diff --check` OK sur le périmètre 007.1C.
- Docs : `LLM.md` mis à jour ; handoff synchronisé.
- Fichiers principaux : `packages/analysis/src/{ollama-client,validate-analysis-proposal,analysis-proposal-types,analysis-constants,analysis-errors,index}.ts` (+ tests).
- Commit / push : `10501f42d1fc95f72b27e3eb9181292b8550095c` — `feat(analysis): add Ollama client and AnalysisProposalV1 validation` (push `main`).
- Prochaine étape officielle : **007.1D — Service d'analyse IA**.



## 2026-07-16 14:37 — 007.1B

- Modèle de données des résultats d’analyse IA livré dans `@radar-ia/database`.
- Prisma : modèle `AnalysisAttempt` (append-only) + enums `AnalysisValidationStatus`, `PublicationDecision`, `AnalysisErrorCode`, `AnalysisWarningCode` ; relation `NewsFolder` FK `ON DELETE RESTRICT`.
- Stratégie : une seule table historique ; proposition / `backendScoring` / `droppedFacts` en JSON ; codes erreur / warning en enums Prisma.
- Repository `createAnalysisAttemptRepository` : `recordAnalysisAttempt`, lectures par id / dossier / empreinte, comptages tentatives et `hold` ; pas de delete / update publics.
- Invariants : fingerprint SHA-256 hex ; attemptNumber > 0 ; unicité `(folderId, aggregateFingerprint, attemptNumber)` ; accepted ⇒ proposal + scoring ; rejected ⇒ pas de scoring ; pré-parse ⇒ errorCodes ; `publish` / `enrich_thread_only` ⇒ analyse acceptée.
- Migration `20260716143500_add_analysis_attempt_data_model` + index `(folderId)`, `(folderId, aggregateFingerprint)`, chronologique, validation, hold.
- Tests : 19 cas schema/repository (Vitest + PrismaClient doublé) ; package database 63 tests OK.
- Validations : `prisma:validate` OK ; `prisma:generate` OK ; `npm run test` OK ; `typecheck` / `build` OK ; `git diff --check` OK sur le périmètre 007.1B.
- Réserve PostgreSQL runtime : `prisma:migrate:deploy` échoue (P1001 — `localhost:5432` injoignable) ; migration SQL livrée, non appliquée ici.
- Aucune dépendance ajoutée ; aucun client Ollama, prompt, Fastify, Discord ni module 008.
- Fichiers principaux : `schema.prisma`, migration SQL, `analysis-types.ts`, `analysis-attempt-repository.ts` (+ tests), `index.ts`, `LLM.md`, `handoff.md`.
- Commit : `de8f8f0f749124a68eca1c387df0df241b89cf11` — `feat(database): persist AI analysis results` (push `main`).
- Prochaine étape officielle : **007.1C — Client Ollama et validation du contrat** `AnalysisProposalV1`.



## 2026-07-16 14:30 — 007.1A

- Gel fonctionnel du module **007 — Analyse IA** créé : `docs/Validation/007.1A_Gel_Fonctionnel_Analyse_IA.md` (référence **normative**).
- Contrats figés : `AnalysisProposalV1` / `ValidatedAnalysisV1` (champs, enums, `schemaVersion`, évolution).
- Plafonds : summary 40–500 ; rationale ≤1000 ; proposedFacts.key ≤256 ; value ≤512 ; contexte 12 000 ; entities ≤12 ; facts ≤8 ; etc.
- Scoring backend : multiplicateurs S–E ; `composite` ; critères `publish` / `enrich_thread_only` / `hold` / `reject_editorial`.
- Retry : 3 tentatives ; timeouts 90 s / 300 s ; ancrage strict (`inferred` écarté) ; idempotence SHA-256 ; réanalyse `attach_enrich` matériel.
- `007.0` marqué historique ; `docs/README.md` + `LLM.md` mis à jour.
- Aucun code applicatif, Prisma, migration, Ollama, Fastify, Discord, Docker ni dépendance.
- Validations : cohérence 007.0 / 006.1A / handoff / décisions gelées ; liens Markdown ; aucun fichier `apps/` / `packages/` modifié.
- Handoff synchronisé (007 à ≈67 %, global 74 %, §18/§27, journal).
- Prochaine étape officielle : **007.1B — Modèle de données des résultats d’analyse**.



## 2026-07-16 14:20 — 007.0

- Conception du module **007 — Analyse IA** livrée (documentaire uniquement).
- Document créé : `docs/Validation/007.0_Doctrine_Analyse_IA.md` (responsabilités, pipeline, rôle LLM, validations backend, contrat JSON `AnalysisProposalV1` / `ValidatedAnalysisV1`, entrées 006, sorties vers décision publication / 008, erreurs, limites, interfaces, performances, concurrence, évolutions, anti-règles, critères d’acceptation).
- Décisions structurantes figées : dossier = unité d’analyse ; LLM non décisionnaire ; backend valide et tranche (`publish` / `enrich_thread_only` / `hold` / `reject_editorial`) ; Discord consommateur uniquement ; pas d’inférence sur `duplicate_editorial` / `ambiguous_no_action` ; Ministral 3 3B ; Ollama concurrency = 1.
- `docs/README.md` : entrée Validation 007.0 + arborescence mise à jour.
- Aucun code TypeScript, Prisma, migration, endpoint, Ollama, Fastify, Discord, Docker ni dépendance.
- Validations : relecture cohérence handoff / 006.1A / `LLM.md` / `ARCHITECTURE.md` / `DISCORD.md` / interfaces packages ; liens Markdown ; aucun fichier `apps/` / `packages/` modifié.
- Handoff synchronisé (module 007 🟡, §18 enrichi, §27 Module 007, avancement 72 %, journal).
- Prochaine étape officielle : **007.1A — Gel fonctionnel de l’analyse IA**.



## 2026-07-16 14:07 — 006.1E

- Validation finale et intégration du module Déduplication livrées dans `@radar-ia/database`.
- Couche d’orchestration minimale : `createMatchingOrchestrator(prisma, options?)` → `process({ articleId, article, candidateFolders })`.
- Flux : Matching Engine (006.1D) → mapping proposition → Matching Persistence Service (006.1C) → Repository (006.1B).
- Le moteur reste seul décisionnaire par règles ; le service reste responsable de la transaction ; pas de nouvelle règle métier.
- API publique ajoutée : `proposalToPersistInput`, `MatchingOrchestrationError`, types `MatchingOrchestrationInput` / `MatchingOrchestrationResult`.
- Dépendance workspace : `@radar-ia/database` → `@radar-ia/shared`.
- Tests d’intégration Vitest : 8 (4 parcours complets, rollback transactionnel, cohérence moteur↔persistance, conservation justifications / faits, déterminisme global, refus mapping incomplet) ; total database 44.
- Validations : `npm install` OK ; `npm run prisma:validate` OK ; `npm run prisma:generate` OK ; `npm run test` OK ; `npm run typecheck` OK ; `npm run build` OK ; `git diff --check` OK sur le périmètre 006.1E (trailing whitespace préexistant `.cursor/` hors commit).
- Validation runtime PostgreSQL : **non exécutée** (Docker / Compose absents — `migrate deploy` à faire dès que la base est disponible).
- Module **006 — Déduplication** officiellement **terminé** (006.0 → 006.1E).
- Fichiers principaux : `packages/database/src/{matching-orchestrator,matching-orchestration-types,matching-orchestrator.test,index}.ts` ; `packages/database/package.json`.
- Commit / push : `feat(matching): finalize deduplication module` (`409315bedadb92fed6d630c0fb75b07090226c64`) sur `origin/main`.
- Prochaine étape officielle : **007.0 — Conception du module Analyse IA**.



## 2026-07-16 14:05 — 006.1D

- Moteur déterministe de rapprochement livré dans `@radar-ia/shared` (`packages/shared`).
- API publique : `createMatchingEngine(options?)` → `evaluate(article, candidateFolders)` ; seuils centralisés `MATCHING_THRESHOLDS` ; extraction `extractEventFingerprint`.
- Proposition structurée : issue (`create_dossier` / `attach_enrich` / `duplicate_editorial` / `ambiguous_no_action`), `folderId`, confiance, motifs, signaux favorables/défavorables, faits d’enrichissement, justification, `proposalOrigin: "rule"`.
- Signaux déterministes uniquement : entités, produit/org, nature d’annonce, proximité temporelle, version, faits nouveaux, catégories, tier de source ; pas d’embeddings / similarité IA / réseau.
- Doctrine respectée : pur, sans Prisma / Fastify / Discord / LLM ; ne persiste pas (006.1C reste l’écriture) ; candidats fournis par l’appelant.
- Tests Vitest : 13 (multi-sources, jalon distinct, reprise sans fait, thème proche, ambiguïté, conflit, multi-dossiers, closed, explicabilité, déterminisme).
- Validations : `npm install` OK ; `npm run test` OK ; `npm run typecheck` OK ; `npm run build` OK ; `git diff --check` OK sur le périmètre 006.1D (trailing whitespace préexistant `.cursor/` hors commit).
- Fichiers principaux : `packages/shared/src/{matching-types,matching-thresholds,matching-signals,matching-engine,matching-engine.test,index}.ts` ; `package.json` / `vitest.config.ts` / `tsconfig.json`.
- Commit / push : `feat(matching): add deterministic matching engine` (`3a5e389f199b8994cfbeca90f177061d8312919a`) sur `origin/main`.
- Prochaine étape officielle : **006.1E — Validation finale et intégration du module Déduplication**.



## 2026-07-16 13:55 — 006.1C

- Service métier de persistance des décisions livré dans `@radar-ia/database` (`packages/database`).
- API publique : `createMatchingPersistenceService(prisma)` → `persistDecision(input)` ; issue toujours fournie par l’appelant (aucune sélection automatique).
- Transactions couvertes : `create_dossier` (dossier + primary + décision) ; `attach_enrich` (membership enrichment + `lastActivityAt` + `idle`→`open` + décision) ; `duplicate_editorial` (décision seule, pas de rattachement) ; `ambiguous_no_action` (décision seule, pas de création de dossier).
- Extension minimale repository 006.1B : `updateFolder` (status / `lastActivityAt` / title) pour l’évolution d’état métier.
- Erreur métier : `MatchingPersistenceError` (dossier absent, attach sur dossier `closed`).
- Doctrine respectée : pas de matching, pas de score IA, pas de Fastify / Discord / LLM ; déterministe ; injectable.
- Tests Vitest : 7 ajoutés (4 issues, rollback transactionnel, historique décisions, refus closed) ; total database 36.
- Validations : `npm install` OK ; `npm run prisma:validate` OK ; `npm run prisma:generate` OK ; `npm run test` OK ; `npm run typecheck` OK ; `npm run build` OK ; `git diff --check` OK sur le périmètre 006.1C.
- Validation runtime PostgreSQL : **non exécutée** (Docker / Compose absents — `migrate deploy` à faire dès que la base est disponible).
- Fichiers principaux : `src/{matching-persistence-types,matching-persistence-service,matching-persistence-service.test,news-folder-repository,news-folder-types,index}.ts`.
- Commit / push : `feat(database): add matching persistence service` (`5d18241316763b46ea6f5f73b1a3382f481e3948`) sur `origin/main`.
- Prochaine étape officielle : **006.1D — Moteur déterministe de rapprochement**.



## 2026-07-16 13:47 — 006.1B

- Modèle de données des dossiers et décisions de rapprochement livré dans `@radar-ia/database` (`packages/database`).
- Modèles Prisma : `NewsFolder` (état `open`/`idle`/`closed`, titre, `lastActivityAt`, `closedAt`) ; `NewsFolderArticle` (appartenance article↔dossier, rôles `primary`/`enrichment`, faits JSON) ; `MatchingDecision` (historique append-only des 4 issues, confiance, motifs, signaux, `reevaluable`).
- Enums : `NewsFolderStatus`, `NewsFolderArticleRole`, `MatchingDecisionIssue`, `MatchingConfidence`.
- Migration : `prisma/migrations/20260716134400_add_news_folder_data_model` — tables + index + FK `ON DELETE RESTRICT` ; unicité d’appartenance active (`NewsFolderArticle.articleId` unique).
- API publique : `createNewsFolderRepository(prisma)` → `createFolder` / `attachArticle` / `recordDecision` / `getFolder` / `listFolderArticles` / `deleteFolder` (refus si relations) ; erreur `NewsFolderIntegrityError`.
- Doctrine respectée : article sans dossier possible ; décisions historisées sans écrasement ; pas de score IA / embeddings / Discord / 007.
- Hors périmètre : moteur de matching, comparaison, scoring, LLM, Fastify, Discord, scheduler, publication.
- Tests Vitest : 10 ajoutés (migration, création dossier, rattachement, historique décisions, intégrité relations, suppression interdite) ; total database 29.
- Validations : `npm install` OK ; `npm run prisma:validate` OK ; `npm run prisma:generate` OK ; `npm run test` OK ; `npm run typecheck` OK ; `npm run build` OK ; `git diff --check` OK sur le périmètre 006.1B.
- Validation runtime PostgreSQL : **non exécutée** (Docker / Compose absents — `migrate deploy` à faire dès que la base est disponible).
- Fichiers principaux : `prisma/schema.prisma` ; `prisma/migrations/20260716134400_add_news_folder_data_model/migration.sql` ; `src/{news-folder-types,news-folder-repository,news-folder-repository.test,index}.ts`.
- Commit / push : `feat(database): add news folder data model` (`9091af9341f1d10a48fcaacc7ea332a3ea43dfec`) sur `origin/main`.
- Prochaine étape officielle : **006.1C — Repository métier et persistance des décisions**.



## 2026-07-16 13:37 — 006.1A

- Gel fonctionnel de la déduplication créé : `docs/Validation/006.1A_Gel_Fonctionnel_Deduplication.md` (référence **normative** du module 006).
- Terminologie figée : source, article normalisé, événement, dossier, information nouvelle, enrichissement, doublon éditorial, rattachement, absence de valeur, confiance de rapprochement, décision backend.
- Décisions opérationnelles gelées : 4 issues (`create_dossier`, `attach_enrich`, `duplicate_editorial`, `ambiguous_no_action`) ; états dossier `open` / `idle` / `closed` ; invariants ; critères de rapprochement ; valeur nouvelle ; anti-règles.
- Cas limites obligatoires arbitrés (reprises, versions distinctes, ambiguïté, LLM vs règles, etc.).
- Rôle backend = seul décisionnaire ; LLM (007) = propositions consultatives uniquement.
- Interfaces 005 / 007 / 008 et besoins de traçabilité définis ; pas de schéma Prisma final.
- Réserves : seuils numériques, fenêtres temporelles, délai `open`→`idle`, barème S–E chiffré, événements multi-jalons.
- Ambiguïtés 006.0 corrigées : « ignorer » → `duplicate_editorial` ; rejet technique hors 006 ; `Candidate`/`Published` retirés du cycle 006.
- `006.0` marqué historique ; `docs/README.md` + `SOURCES.md` mis à jour.
- Aucun code applicatif, Prisma, migration, test, Fastify, Discord, LLM ni dépendance.
- Validations : relecture cohérence handoff / gel / doctrine ; liens Markdown ; `git diff --check` ; aucun fichier `apps/` / `packages/` modifié.
- Commit / push : `docs(deduplication): freeze functional rules` (`b0c80a227b103956bc79ba124ad6da281acc4f3a`) sur `origin/main`.
- Prochaine étape officielle : **006.1B — Modèle de données des dossiers et décisions de rapprochement**.



## 2026-07-16 13:31 — 006.0

- Ouverture officielle du module **006 — Déduplication**.
- Conception uniquement : aucun code applicatif, modèle Prisma, migration, endpoint, Fastify, Discord ni LLM.
- Document de référence créé : `docs/Validation/006.0_Doctrine_Deduplication.md` (objectifs, définitions Source / Article / Événement / Dossier, cycle de vie, critères création / rattachement, sources de vérité, algorithme de rapprochement conceptuel, cas particuliers / refusés, données à persister, interfaces 005 / 007 / 008, avantages / limites / risques).
- Audit préalable : handoff §17, `SOURCES.md`, `ARCHITECTURE.md`, `DISCORD.md`, `LLM.md`, schéma Prisma (`NormalizedArticle` + collecte brute), persistance 005.1A (identité technique intra-source uniquement).
- Décisions structurantes figées : dossier = unité métier ; article = entrée technique ; enrichissement si réelle valeur sinon ignore ; backend décisionnaire ; frontière nette avec idempotence 005.
- `docs/README.md` : section Validation ajoutée + arborescence mise à jour.
- Handoff synchronisé (module 006 🟡, §17 enrichi, §26 Module 006, journal).
- Validations : documentaires uniquement (relecture cohérence handoff / Validation / README).
- Commit recommandé : `docs(deduplication): define functional doctrine` ; push `origin/main`.
- Prochaine étape officielle : **006.1A — Gel fonctionnel de la déduplication**.



## 2026-07-16 13:25 — 005.1A

- Persistance des articles normalisés livrée dans `@radar-ia/database` (`packages/database`).
- Modèle Prisma : `NormalizedArticle` (`id`, `sourceId`, `sourceTier`, `externalId?`, `title`, `url`, `publishedAt?`, `updatedAt?` métier, `author?`, `summary?`, `content?`, `categories`, `feedFormat`, `createdAt`, `persistedUpdatedAt`).
- Migration : `prisma/migrations/20260716132200_add_normalized_article_persistence` — table + index `(sourceId)`, `(sourceId, publishedAt)` + index uniques partiels PostgreSQL `sourceId+externalId` (si `externalId IS NOT NULL`) et `sourceId+url` (si `externalId IS NULL`).
- Identité technique : priorité `sourceId + externalId` ; repli `sourceId + url` ; pas d’unicité globale URL / externalId ; pas de fusion inter-sources.
- API publique : `createNormalizedArticleRepository(prisma)` → `saveNormalizedArticle` / `saveNormalizedArticles` ; types `SaveNormalizedArticleInput`, résultats création/mise à jour + compteurs de lot.
- Comportement : create si absent, sinon update des champs normalisés ; conservation de `id` / `createdAt` ; `persistedUpdatedAt` rafraîchi ; lot en transaction atomique.
- Type d’entrée structurel (compatible `NormalizedArticle` collector) — pas de dépendance `@radar-ia/collector` → `@radar-ia/database`.
- Tests Vitest : 11 ajoutés (schéma/migration, create avec/sans externalId, réapparitions, inter-sources, update déterministe, catégories/dates, lot, absence de dédup éditoriale) ; total database 19 ; Prisma doublé.
- Validations : `npm install` OK ; `npm run prisma:validate` OK ; `npm run prisma:generate` OK ; `npm run test` OK ; `npm run typecheck` OK ; `npm run build` OK ; `git diff --check` OK sur le périmètre 005.1A (échecs trailing whitespace limités aux `.cursor/` préexistants hors commit).
- Validation runtime PostgreSQL : **non exécutée** (Docker / Compose absents — `migrate deploy` à faire dès que la base est disponible).
- Fichiers principaux : `prisma/schema.prisma` ; `prisma/migrations/20260716132200_add_normalized_article_persistence/migration.sql` ; `src/{normalized-article-types,normalized-article-repository,normalized-article-repository.test,index}.ts`.
- Non développé : déduplication 006, câblage collecte→persistance, API métier, Discord, LLM, scheduler, retry, admin articles ; `RawFeedSnapshot` / `CollectedSourceState` inchangés fonctionnellement.
- Commit / push : `feat(database): persist normalized articles` (`f649c68573ca52b5af9080f7a546b4d8b7299d29`) sur `origin/main`.
- Handoff synchronisé (versionné dans le commit).
- Module 005 terminé. Version projet : **0.7**. Prochaine étape officielle : **à cadrer par le concepteur** (006 non détaillé).



## 2026-07-16 02:35 — sync(docs) finalisation gouvernance

- Synchronisation documentaire finale de la **structure** du handoff (aucun code, package, test, migration ni dépendance).
- Structure désormais **stabilisée** : évolutions futures = contenu, pas réorganisation.
- Ajouts : tableau de bord ; §3 Invariants ; §4 Décisions irréversibles ; §8 Progression des modules ; critères de passage 0.7–1.0 ; §11 Statistiques ; §14 Dépendances majeures ; §20 Conventions ; §21 Risques actuels.
- Doublon « Décisions majeures » retiré (fusionné dans §4).
- Commit / push : `docs(handoff): finalize project governance structure` (`960f028bd989625a07f4751451016fa2bb864492`) sur `origin/main`.
- Prochaine étape officielle : **005.1A — Persistance des articles normalisés**.



## 2026-07-16 02:30 — sync(docs) pilotage roadmap

- Synchronisation documentaire uniquement (aucun code, package, test, migration, Docker ni dépendance).
- Ajout du **pilotage projet** : §4 avancement global (44 %, méthode modules 001–009), barre ASCII ; §5 roadmap fonctionnelle ; §6 roadmap des versions ; §7 jalons majeurs.
- Tableau packages (§8) : colonnes Rôle + État.
- Cohérence : v0.6 = collecte terminée ; 005 ouvert à 0 % ; 006–009 non démarrés ; Parking exclu du %.
- Commit / push : `docs(handoff): add project roadmap and progress tracking` (`e3b68ad7e2b3ce669942ef22de9a0d81d862b745`) sur `origin/main`.
- Prochaine étape officielle : **005.1A — Persistance des articles normalisés**.



## 2026-07-16 02:25 — sync(docs) v0.6 alignement 10/10

- Synchronisation documentaire uniquement (aucun code, package, test, migration, Docker ni dépendance).
- Objectif : distinguer clairement **état livré**, **doctrine**, et **feuille de route**.
- §3 renommé « État du projet » (tableaux Doctrine vs Livré / en cours).
- §7 Doctrine de collecte : sous-sections Livré vs Prévu / cible (retry, ralentissement, stockage nettoyé).
- §8–10 reformulés en doctrine / cible (déduplication, LLM, Discord métier non présentés comme livrés).
- §4 : tableau « État des packages » ; §15 renommé « Module 005 — Gestion des articles ».
- Commit / push : `docs(handoff): clarify delivered state versus project doctrine` (`de44ed3f2225305c6e26df672ff7ce57829c8e8a`) sur `origin/main`.
- Prochaine étape officielle : **005.1A — Persistance des articles normalisés**.



## 2026-07-16 02:20 — sync(docs) v0.6

- Synchronisation documentaire du handoff (aucune modification de code, package, migration, test ni dépendance).
- Version officielle corrigée : **0.5 → 0.6** (correction d’état, non un événement daté du jour).
- Statut : développement actif — architecture stabilisée, socle technique terminé, développement fonctionnel en cours (fin de la formulation « pré-développement »).
- Chronologie des versions alignée : 0.5 = bootstrap runtime (API / Bot) ; 0.6 = développement actif (module 004).
- Architecture actuelle : rôles succincts de `api`, `bot`, `collector`, `config`, `database`.
- Feuille de route : module 004 marqué terminé ; ouverture informative du module 005 (005.1A).
- Commit / push : `docs(handoff): synchronize project state for v0.6` (`2598ebe88fa07665485c307b796c668ac119b129`) sur `origin/main`.
- Prochaine étape officielle : **005.1A — Persistance des articles normalisés**.



## 2026-07-16 02:13 — 004.1F

- Stockage brut des collectes livré dans le package `@radar-ia/database` (`packages/database`).
- Modèles Prisma : `CollectedSourceState` (1 ligne / source : `sourceId`, `etag`, `lastModified`, `lastCollectedAt`, `lastSuccessfulAt`, `lastHttpStatus`, `createdAt`, `updatedAt`) ; `RawFeedSnapshot` append-only (`id`, `sourceId`, `collectedAt`, `httpStatus`, `etag`, `lastModified`, `finalUrl`, `feedFormat`, `rawBody`, `parseSucceeded`, `errorMessage`).
- Migration : `prisma/migrations/20260716001300_add_raw_feed_persistence` (+ `migration_lock.toml` PostgreSQL).
- API publique : `createPrismaClient(options?)` ; `createRawFeedRepository(prisma)` → `saveRawFeedSnapshot(...)` / `saveCollectedSourceState(...)` ; types d'entrée exportés.
- Architecture : dépôt injectable (PrismaClient en dépendance) ; aucune transformation métier ; pas d'`RawArticle` / `NormalizedArticle` en base.
- Non câblé : collector, Fastify, Discord, scheduler, retry, cache, recherche, déduplication, scoring, LLM.
- Tests Vitest : 8 (migration SQL, insert snapshot, append-only, upsert état, ETag, Last-Modified, erreur collecte, `parseSucceeded` true/false) ; Prisma client doublé (pas de PostgreSQL runtime sur cette machine).
- Validations : `npm run prisma:validate` OK ; `npm run prisma:generate` OK ; `npm run test` OK ; `npm run typecheck` OK ; `npm run build` OK ; `git diff --check` OK sur le périmètre 004.1F.
- Validation runtime PostgreSQL : non exécutée (Docker / Compose absents — `migrate deploy` à faire dès que la base est disponible).
- Fichiers principaux : `packages/database/prisma/schema.prisma` ; `prisma/migrations/...` ; `src/{client,raw-feed-types,raw-feed-repository,raw-feed-repository.test,index}.ts` ; `package.json` / `vitest.config.ts` ; script racine `prisma:migrate:deploy`.
- Non modifié : `@radar-ia/collector`, API, bot ; modifications `.cursor/` préexistantes exclues du commit.
- Commit / push : `chore(collector): add raw feed persistence` (`bff49df86512570ef4dc17fad07dbad649a49caa`) sur `origin/main`.
- Module 004 terminé. Prochaine étape officielle : **005.1A — Persistance des articles normalisés**.



## 2026-07-16 02:07 — 004.1E

- Normalisation des articles livrée dans le package `@radar-ia/collector` (`packages/collector`).
- API publique : `normalizeArticle(source, feed, item)` → `NormalizedArticle` ; `normalizeFeedArticles(source, feed)` → `NormalizeFeedResult` ; `canonicalizeArticleUrl(raw)` ; types `NormalizedArticle`, `RejectedArticle`, `NormalizeFeedResult`, `ArticleRejectionCategory`.
- Modèle `NormalizedArticle` : `sourceId`, `sourceTier`, `title`, `url`, `categories`, `feedFormat` obligatoires ; optionnels `externalId`, `publishedAt`, `updatedAt`, `author`, `summary`, `content`.
- Titre : trim + espaces normalisés ; absents/vides rejetés (`MissingArticleTitleError`) — aucun titre fabriqué depuis résumé/contenu.
- URL : absolue HTTP(S) uniquement ; credentials refusés ; fragment retiré ; hostname minuscule ; ports par défaut normalisés ; query conservée (y compris `utm_*`) ; relative / protocole interdit → `MissingArticleUrlError` / `InvalidArticleUrlError`.
- Identité externe : RSS `guid` / Atom `id` après trim ; omis si absent ; jamais URL ni ETag.
- Dates : `Date` valide → ISO 8601 UTC ; absente ou invalide omise (jamais inventée) ; n’échoue pas le lot.
- Texte : trim minimal sur `author` / `summary` / `content` ; HTML brut conservé ; pas de sanitization.
- Catégories : trim, vides exclus, déduplication insensible à la casse (première orthographe), ordre déterministe.
- Rejets : item invalide → entrée `rejected` (index, externalId?, category, message, cause?) ; le lot continue ; `normalizeArticle` lève.
- Architecture : Option A — normalisation séparée ; `createIncrementalCollector` inchangé.
- Dépendances : **aucune nouvelle** dépendance runtime.
- Tests Vitest : 49 ajoutés ; total collector 143 ; sans Internet ni persistance.
- Validations : `npm run test` OK ; `npm run typecheck` OK ; `npm run build` OK ; `git diff --check` OK sur le périmètre 004.1E.
- Fichiers principaux : `packages/collector/src/{article-types,article-errors,article-normalize,article-normalize.test}.ts` ; `index.ts` ; docs `SOURCES.md` / `CONFIGURATION.md`.
- Non modifié : Fastify, Discord, Prisma, collecte incrémentale (hors exports) ; modifications `.cursor/` préexistantes exclues du commit.
- Commit / push : `feat(collector): add article normalization` (`f4eb2999ed88cfa08bfacdbeba9d60c613c531dc`) sur `origin/main`.
- Prochaine étape officielle : **004.1F — Stockage brut**.



## 2026-07-16 02:05 — 004.1D

- Collecte incrémentale livrée dans le package `@radar-ia/collector` (`packages/collector`).
- API publique : `createIncrementalCollector({ httpClient, parseFeed? }).collect(source, state?)` → `CollectSourceResult` (`updated` | `not-modified`).
- État incrémental : `SourceFetchState` sérialisable (`etag?`, `lastModified?`) fourni et renvoyé par l’appelant ; **aucune persistance** fichier, Redis ni base.
- En-têtes conditionnels : `If-None-Match` / `If-Modified-Since` si validateurs présents ; pas d’en-tête vide ; envoi simultané possible ; User-Agent inchangé (client HTTP).
- Traitement 304 : pas d’appel à `parseFeed` ; résultat `not-modified` ; fusion des validateurs réponse + état précédent.
- Traitement 2xx : lecture validateurs, `parseFeed` sur le corps, résultat `updated` + nouvel état.
- Non-2xx hors 304 : `SourceHttpStatusError` (statut, id, URL) ; corps non exposé.
- Erreurs ajoutées : `SourceCollectError`, `SourceHttpStatusError`, `SourceEmptyBodyError`, `SourceFeedParseError` (cause de parsing préservée).
- Dépendances : **aucune nouvelle** dépendance runtime.
- Tests Vitest : 29 ajoutés (état initial, ETag / Last-Modified / les deux, 304, RSS/Atom, validateurs faibles, corps vide, XML invalide, 404/429/500, propagation réseau/timeout/SSRF, non-mutation, typage) ; total collector 94 ; sans Internet.
- Validations : `npm run test` OK ; `npm run typecheck` OK ; `npm run build` OK ; `git diff --check` OK sur le périmètre 004.1D.
- Fichiers principaux : `packages/collector/src/{collect-types,collect-errors,collect-source,collect-source.test}.ts` ; `index.ts` ; docs `SOURCES.md` / `CONFIGURATION.md`.
- Non modifié : Fastify, Discord, Prisma, registre / client HTTP / parseur (hors exports) ; modifications `.cursor/` préexistantes exclues du commit.
- Commit / push : `feat(collector): add incremental feed collection` (`957feb20a8fd39e06cf1e7830324a2e17b4a422b`) sur `origin/main`.
- Prochaine étape officielle : **004.1E — Normalisation des articles**.



## 2026-07-16 01:52 — 004.1C

- Registre des sources livré dans le package `@radar-ia/collector` (`packages/collector`).
- API publique : `parseSourceRegistry(input: string | Uint8Array): SourceRegistry` ; `loadSourceRegistry(filePath: string | URL): Promise<SourceRegistry>` ; `getEnabledSources(registry)` ; types `SourceDefinition`, `SourceRegistry`, `SourceTier` ; constante `SOURCE_TIERS`.
- Modèle minimal d’une source : `id` (slug), `name`, `url`, `tier` (`S`|`A`|`B`|`C`|`D`|`E`), `enabled` (booléen obligatoire).
- Format JSON racine strict : `{ "sources": [ ... ] }` ; propriétés inconnues refusées ; registre vide (`sources: []`) accepté pour bootstrap / activation progressive.
- Emplacement : exemple versionné `config/sources.example.json` ; fichier local `config/sources.json` ignoré par Git.
- Unicité : `id` unique ; URL unique après normalisation (hostname minuscule, ports par défaut et slash final hors racine retirés) ; pas de résolution DNS.
- URL : `http:` / `https:` absolues uniquement ; credentials et fragments refusés ; SSRF complet reste au client HTTP (004.1A).
- Erreurs publiques : `SourceRegistryError`, `InvalidSourceRegistryError`, `DuplicateSourceIdError`, `DuplicateSourceUrlError` ; messages actionnables sans fuite de secret.
- Dépendance de validation : `zod` ^3.25.76 déclarée directement dans `@radar-ia/collector` (cohérence monorepo, `.strict()`, enums).
- Périmètre strict : aucun réseau, HTTP, parse RSS, ETag, retry, Prisma, Discord ni scoring.
- Tests Vitest : 26 ajoutés (registre valide string/bytes, fichier temporaire, fichier absent, JSON/racine/sources, id/url/tier/enabled, doublons, filtrage actifs, strict unknown) ; total collector 65 ; sans Internet.
- Validations : `npm install` ; `npm run test` OK ; `npm run typecheck` OK ; `npm run build` OK ; `git diff --check` OK sur le périmètre 004.1C.
- Fichiers principaux : `packages/collector/src/{source-types,source-errors,source-registry,source-registry.test}.ts` ; `index.ts` ; `package.json` / `package-lock.json` ; `config/sources.example.json` ; `.gitignore` ; docs `SOURCES.md` / `CONFIGURATION.md`.
- Non modifié : Fastify, Discord, Prisma, client HTTP, parseur RSS (hors exports) ; modifications `.cursor/` préexistantes exclues du commit.
- Commit / push : `feat(collector): add source registry` (`e2ec7ebfacc6bab1ba2d88e5198e419a63f6f547`) sur `origin/main`.
- Prochaine étape officielle : **004.1D — Collecte incrémentale (ETag / Last-Modified)**.



## 2026-07-16 01:46 — 004.1B

- Lecteur RSS / Atom livré dans le package `@radar-ia/collector` (`packages/collector`).
- API publique : `parseFeed(input: Uint8Array | string): ParsedFeed` ; types `ParsedFeed`, `ParsedFeedItem`, `FeedFormat` ; erreurs `FeedParseError`, `InvalidXmlError`, `UnrecognizedFeedFormatError`.
- Formats supportés : **RSS 2.0** et **Atom 1.0** uniquement ; structure normalisée commune (titre, description/sous-titre, lien, langue, date de mise à jour, articles).
- Articles : titre, lien canonique, id (guid/id), résumé, auteur, date de publication, catégories, contenu brut ; champs optionnels absents → `null` / `[]`.
- Stratégie XML : dépendance runtime `fast-xml-parser` ^5.10.0 ; validation `XMLValidator` + parsing ; `removeNSPrefix` pour Atom ; entités caractères décodées ; **pas de résolution d’entités externes (XXE)** ; champs inconnus ignorés.
- Périmètre strict : aucun téléchargement HTTP, registre, ETag, cache, retry, stockage, Prisma, déduplication, scoring, LLM ni Discord.
- Tests Vitest : 14 ajoutés (RSS/Atom valides, flux vides, XML invalide, format inconnu, optionnels absents, catégories multiples, guid/auteur/dates absents, UTF-8 bytes, champs inconnus, XXE) ; total collector 39 ; sans réseau.
- Validations : `npm install` ; `npm run test` OK ; `npm run typecheck` OK ; `npm run build` OK ; `git diff --check` OK.
- Fichiers principaux : `packages/collector/src/{feed-types,feed-errors,feed-parser,feed-parser.test}.ts` ; `index.ts` mis à jour ; `package.json` / `package-lock.json` (dépendance `fast-xml-parser`).
- Non modifié : Fastify, Discord, Prisma, config runtime, package `shared` ; le client HTTP 004.1A reste inchangé fonctionnellement.
- Commit / push : `feat(collector): add RSS and Atom parser` (`43f99939311004ce3bfaec40caad8856a384e980`) sur `origin/main`.
- Prochaine étape officielle : **004.1C — Registre des sources**.



## 2026-07-16 01:39 — 004.1A

- Client HTTP sécurisé livré dans le package `@radar-ia/collector` (`packages/collector`).
- API publique : `createSecureHttpClient()` → `client.get(url, options?)` retournant `{ status, statusText, headers, body: Uint8Array, url }` ; constantes `DEFAULT_*` et hiérarchie d’erreurs exportées.
- Transport : `fetch` natif Node.js (Undici) ; **aucune dépendance runtime ajoutée** (dev : `vitest` ^3.2.7, aligné sur les autres packages).
- Timeout : `AbortSignal.timeout`, défaut `DEFAULT_TIMEOUT_MS = 15000` ; erreur `TimeoutError`.
- User-Agent centralisé : `RadarIA/0.5 (+https://github.com/Apch132/Radar_IA)` ; toujours forcé (non supprimable par le consommateur).
- SSRF : protocoles `http:` / `https:` seuls ; refus localhost / `.localhost` / `.local` ; IPv4 privées/réservées ; IPv6 loopback/ULA/link-local/mapped ; résolution DNS avant requête ; une seule adresse interdite ⇒ rejet ; DNS injectable (`lookup`).
- Redirections : `redirect: "manual"` ; suivi manuel 301/302/303/307/308 ; max `DEFAULT_MAX_REDIRECTS = 5` ; revalidation SSRF à chaque hop ; `RedirectError` si boucle / limite / Location absente.
- Taille corps : `DEFAULT_MAX_BODY_BYTES = 5 MiB` ; arrêt propre + `ResponseTooLargeError`.
- Erreurs : `HttpClientError`, `InvalidUrlError`, `SsrfBlockedError`, `TimeoutError`, `NetworkError`, `RedirectError`, `ResponseTooLargeError` ; statuts HTTP non 2xx retournés tels quels (pas transformés en erreur réseau).
- Tests Vitest : 25, sans réseau Internet réel ; `npm run test` / `typecheck` / `build` OK ; `git diff --check` OK sur les fichiers du périmètre.
- Fichiers principaux : `packages/collector/src/{index,constants,errors,ssrf,http-client,http-client.test}.ts` + `package.json` / `tsconfig.json` / `vitest.config.ts` ; `package-lock.json` mis à jour.
- Non modifié : Fastify, Discord, Prisma, config runtime, package `shared` ; aucune variable d’environnement inventée.
- Commit / push : `feat(collector): add secure HTTP client` (`8c515ffd7b8d30530a074d4bed03ef9e1f4115e5`) sur `origin/main`.
- Prochaine étape officielle : **004.1B — Lecteur RSS / Atom**.



## 2026-07-16 01:27 — 004.0

- Clôture officielle de la série 003 (003.1A, 003.1B, 003.1C).
- Ouverture officielle du module 004 — Socle de collecte.
- Feuille de route 004 ajoutée au handoff (004.1A à 004.1F).
- Prochaine étape officielle : **004.1A — Client HTTP sécurisé**.
- Synchronisation documentaire uniquement ; aucune modification du code.



## 2026-07-16 01:13 — 003.1C

- Organisation modulaire minimale créée pour `@radar-ia/api` et `@radar-ia/bot` (points de branchement uniquement, sans framework interne).
- Point central d’enregistrement des routes API : `apps/api/src/routes/index.ts` (`registerRoutes`) appelé par `buildApp()` ; `/health` y est enregistré via `routes/health.ts`.
- Point central d’enregistrement des événements Discord : `apps/bot/src/events/index.ts` (`registerEvents`) appelé par `createClient()` ; uniquement `ClientReady` et `error`.
- Comportement `/health` conservé : `GET /health` → HTTP 200 `{ "status": "ok" }` ; aucune donnée sensible ; aucun test PostgreSQL / Discord / Ollama.
- Événements Discord conservés : `ClientReady` (log tag/id) + `error` (log technique) ; intent `Guilds` seul ; login / shutdown inchangés.
- Stratégie d’erreurs de démarrage : échec visible dans `index.ts` (API + bot) via `console.error` + `process.exit(1)` ; aucun retry ; aucun secret exposé ; pas d’extraction shared (duplication trop courte).
- Dépendances : **aucune ajoutée** ; `packages/shared/`** inchangé.
- Tests : API 4 (registre central + `/health` + non-fuite + close) ; bot 8 (registre `ClientReady`/`error` seulement + intents + login + shutdown + non-fuite) ; sans réseau.
- Validations : `npm install` non nécessaire (aucune dépendance) ; `npm run test` OK ; `npm run typecheck` OK ; `npm run build` OK ; `git diff --check` OK.
- Aucun Prisma, modèle, migration, route métier, commande Discord, collecte, publication, LLM, Docker, ni framework de plugins / conteneur de dépendances.
- Commit / push : `refactor(runtime): add modular registration points` (`c83c9f27e54f9f189f144030ff809ef929aec846`) sur `origin/main`.
- Prochaine étape officielle : **suite série 003** (prompt concepteur).



## 2026-07-16 01:03 — 003.1B

- Bootstrap Discord créé dans `@radar-ia/bot`.
- Version `discord.js` : 14.27.0 (`discord.js` ^14.27.0). Dev : `tsx` ^4.20.3 ; `vitest` ^3.2.7 (alignés sur `@radar-ia/api`).
- Structure : `src/client.ts` (construction + événements techniques), `src/bot.ts` (login + shutdown SIGINT/SIGTERM), `src/index.ts` (entrée), `src/bot.test.ts`.
- Intent activé : uniquement `GatewayIntentBits.Guilds` ; aucun intent privilégié / messages / members / presences.
- Configuration exclusivement via `@radar-ia/config` (`config.discord.token`) ; échec explicite `ConfigurationError` si token absent ; aucun `process.env` dans `apps/bot/src/**`.
- Connexion : `client.login(token)` sans retry personnalisé ; reconnexion native discord.js uniquement ; client injectable pour tests.
- Événements techniques : `ClientReady` (log tag/id public), `error` (log erreur technique sans secret).
- Signaux : `SIGINT` / `SIGTERM` → `client.destroy()` avec garde anti double fermeture ; testable via `BotHandle.shutdown()`.
- Logs : `console` strictement limité au bootstrap (pas d’abstraction de logging, pas de Pino séparé).
- Tests Vitest (6) : intent Guilds seul, login avec token de config, pas de réseau Discord réel, destroy + double fermeture, non-fuite token.
- Validations : `npm install` ; `npm run test` OK ; `npm run typecheck` OK ; `npm run build` OK ; `git diff --check` OK.
- Aucune commande slash, salon, embed, bouton, fil, publication, collecte, LLM, Prisma, Fastify, Docker bot, ni logique métier.
- Commit / push : `feat(bot): bootstrap discord client` (`fc227b4928f67718450844cf7e5357f73a45edbd`) sur `origin/main`.
- Prochaine étape officielle : **suite série 003** (prompt concepteur).



## 2026-07-16 00:58 — 003.1A

- Bootstrap Fastify créé dans `@radar-ia/api`.
- Version Fastify : 5.10.0 (`fastify` ^5.4.0). Dev : `tsx` 4.23.1 (exécution TypeScript + `--watch` Node) ; `vitest` ^3.2.7.
- Structure : `src/app.ts` (construction), `src/server.ts` (listen + SIGINT/SIGTERM), `src/routes/health.ts`, `src/index.ts` (entrée).
- Route interne `GET /health` → HTTP 200 `{ "status": "ok" }` ; aucune donnée sensible, aucun test PostgreSQL / Prisma / Discord / Ollama.
- Configuration exclusivement via `@radar-ia/config` (`config.app.host` / `port` / `logLevel`) ; aucun `process.env` dans `apps/api/src/**`.
- Logger natif Fastify (niveau depuis la config) ; pas de Pino installé séparément.
- Tests Vitest (3) via `app.inject()` : construction, `/health`, non-fuite de secrets, fermeture propre ; aucun port réseau réel.
- Validations : `npm install` ; `npm run test` OK ; `npm run typecheck` OK ; `npm run build` OK ; `git diff --check` OK.
- Aucun Prisma, endpoint métier, plugin sécurité/CORS/rate-limit/OpenAPI, Docker API, ni bot Discord.
- Commit / push : `feat(api): bootstrap fastify application` (`b14272ece3d98ae6357ecdf0c10b3133739da09a`) sur `origin/main`.
- Prochaine étape officielle : **suite série 003** (prompt concepteur — typiquement bootstrap bot Discord).



## 2026-07-16 00:43 — 002.1C

- Package `@radar-ia/config` initialisé (validation centralisée des variables d'environnement).
- Dépendances : `zod` ^3.25.76 (dependency) ; `vitest` ^3.2.7 (devDependency, package uniquement). Orchestration racine : `npm run test`.
- Domaines exportés : `app`, `database`, `discord`, `ollama`, `publication`. Domaine `collector` volontairement omis (pas de variables tant que le moteur de collecte n'existe pas — arbitrage concepteur).
- `.env.example` enrichi : `NODE_ENV`, `LOG_LEVEL`, `API_HOST`, `API_PORT`, Discord (`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`), Ollama (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_MAX_CONCURRENCY`) ; `POSTGRES_*` / `DATABASE_URL` conservés pour Compose.
- Validation : schéma Zod + `createConfig` ; `OLLAMA_MAX_CONCURRENCY` forcé à `1` ; Discord obligatoire si `NODE_ENV=production`, optionnel sinon ; `OLLAMA_MODEL` obligatoire sans défaut (tag exact à fixer à l'install Ollama / Modelfile ; cible fonctionnelle Ministral 3 3B).
- Secrets : `ConfigurationError` n'expose que les noms de variables / raisons sûres ; jamais la valeur de `DISCORD_TOKEN` ni le mot de passe de `DATABASE_URL`.
- Publication : `threadArchiveDurationHours = 24` (constante doctrine, pas de variable d'env inventée).
- Tests Vitest (11) : config minimale, port, rejet URL non PG, concurrence Ollama, non-fuite secrets, Discord dev/prod.
- Validations : `npm install` ; `npm run test` OK ; `npm run typecheck` OK ; `npm run build` OK ; `git diff --check` OK.
- Aucune consommation par `apps/api` / `apps/bot` ; aucun service démarré ; aucune logique métier.
- Commit / push : `feat(config): add centralized environment validation` (`2f94b0e64872b0bd5f58d06a3852e820fb6ae4a2`) sur `origin/main`.
- Prochaine étape officielle : **003.1A — Bootstrap Fastify**.



## 2026-07-16 00:34 — 002.1B

- Prisma initialisé dans le package `@radar-ia/database`.
- Versions : `prisma` 6.19.3 (devDependency) ; `@prisma/client` 6.19.3 (dependency). Pin 6.x volontaire : Prisma 7 exige `prisma.config.ts` et retire `url` du schéma, hors format attendu pour cette étape.
- Fichier créé : `packages/database/prisma/schema.prisma` (generator `prisma-client-js` + datasource PostgreSQL via `env("DATABASE_URL")`).
- Aucun modèle, enum, migration, seed, SQL ni code métier ; pas de `src/` client (non nécessaire à la compilation).
- Scripts package : `prisma:generate`, `prisma:validate` (chargent `DATABASE_URL` depuis `.env` racine via `node --env-file`). Scripts racine : orchestration `prisma:generate`, `prisma:validate`.
- Validations : `npm install` ; `npm run prisma:validate` OK ; `npm run prisma:generate` OK ; `npm run typecheck` OK ; `npm run build` OK ; `git diff --check` OK.
- Validation runtime PostgreSQL : non exécutée (Docker / Docker Compose toujours absents sur cette machine).
- Commit / push : `chore(database): initialize prisma package` (`801e8d69b687f6433e9f1cebbec135d7cb249b00`) sur `origin/main`.
- Prochaine étape officielle : **003.1A — Bootstrap Fastify** (les modèles Prisma restent après/avec la spec métier).



## 2026-07-16 00:30 — 002.1A

- Infrastructure locale de développement initialisée (Docker Compose uniquement).
- Fichiers créés : `docker-compose.yml`, `.env.example`.
- Service : PostgreSQL 16 Alpine ; volume nommé `radar-ia-postgres-data` ; réseau `radar-ia`.
- Aucun service API ni Bot ; aucun schéma Prisma ni migration ; aucune logique métier.
- Variables d'exemple : `POSTGRES_*` + `DATABASE_URL` (convention standard ; nomenclature officielle v0.5 encore ouverte).
- `.env` local dérivé de `.env.example` (ignoré par Git) ; secrets hors dépôt.
- Validation runtime : Docker / Docker Compose absents de la machine au moment de l'étape — `docker compose config` et démarrage PostgreSQL non exécutés ici.
- Commit / push : `chore(infra): initialize docker development environment` (`f9e626d2d4ee69429d916ae9088963d6026db3b5`) sur `origin/main`.
- Prochaine étape officielle : **003.1A — Bootstrap Fastify** (valider Compose dès que Docker est disponible).



## 2026-07-16 00:23 — 001.1C

- Runtime Cursor audité (5 fichiers `.cursor/*.md` attendus, aucun fichier inattendu).
- Fichiers versionnés : `rules.md`, `AI_Doctrine.md`, `Engineering_Reasoning.md`, `prompt_engineering.md`, `handbook_writer.md`.
- Audit de sécurité : aucun secret, token, mot de passe, chemin local personnel ou contenu temporaire détecté.
- Correction minimale : suppression des espaces de fin de ligne (exigence `git diff --check`).
- Commit / push : `chore(cursor): version project runtime instructions` (`10044e6c7452fef64b1c34d1a01ea2a3b3b208ab`) sur `origin/main`.
- Prochaine étape officielle : **003.1A — Bootstrap Fastify**.



## 2026-07-16 00:16 — 001.1B

- `.gitignore` validé et versionné.
- Exclusion de `docs/handoff.md` effective (fichier local non suivi).
- Règle globale `.cursor/` retirée : le runtime Cursor peut être versionné.
- `docs/Reference.zip` supprimé localement (archive temporaire ; contenus déjà présents sous `docs/Reference/`).
- Commit / push : `chore(git): finalize repository ignore rules` (`a85bd48f9aa4d7c86551b7f9c12fd52ac7f1f222`) sur `origin/main`.
- Réserve : fichiers `.cursor/*.md` devenus visibles comme non suivis ; leur versionnement est hors périmètre de `001.1B`.
- Prochaine étape officielle : **003.1A — Bootstrap Fastify**.



## 2026-07-16 00:13 — 001.1A

- Monorepo npm Workspaces initialisé.
- Workspaces créés : `apps/api`, `apps/bot`, `packages/shared`, `packages/config`, `packages/database` (`@radar-ia/*`).
- Configuration TypeScript commune créée (`tsconfig.base.json`, `tsconfig.json` racine, configs locales par workspace).
- Validation : `npm install`, `npm run typecheck`, `npm run build`, `git diff --check`.
- Aucun code métier ajouté (pas de Fastify, discord.js, Prisma, Docker, `.env`).
- Commit / push : `chore(repo): initialize npm workspaces monorepo` (`553c652deadeb64e0691eb5ba27072b47cd23680`) sur `origin/main`.
- Prochaine étape officielle : **003.1A — Bootstrap Fastify**.



## 2026-07-16 00:07 — chore(git): stop tracking handoff

- `docs/handoff.md` retiré du suivi Git (mémoire locale non versionnée).
- Commit : `chore(git): stop tracking handoff` (`245f013be4e017bcfabc957b2adbb898a317d79d`) sur `origin/main`.



## 2026-07-16 00:00 — Documentation v0.5

- Conception terminée.
- Architecture gelée.
- Stack gelée.
- Sources gelées.
- Collecte gelée.
- Déduplication gelée.
- Analyse gelée.
- Discord gelé.
- Ministral 3 3B retenu.
- Documentation officielle créée (README, Architecture, Setup, Reference, Project, LICENSE).
- Documentation réorganisée sous `docs/` (`Architecture/`, `Setup/`, `Reference/`, `Project/`).
- `README.md` et `LICENSE` conservés à la racine.
- Vérification documentaire : arborescence conforme, liens internes valides, aucune référence à un chemin erroné.
- Commit / push : `docs: publish official v0.5 documentation` (`c379d64789f747acd6a8315980bd71a58a3789e3`) sur `origin/main`.
