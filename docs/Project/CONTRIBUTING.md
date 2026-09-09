# Contribuer à Radar IA

Version de référence : **1.0**  
Source officielle : [`handoff.md`](../handoff.md)

Merci de contribuer. Radar IA est un monorepo **v1.0** (roadmap 001–009 + module 010 livrés). Les contributions doivent **respecter les décisions gelées**, pas les réouvrir sans arbitration.

---

## Philosophie du projet

Nous ne codons pas une idée : nous codons une **décision**.

Principes produit à respecter :

- Discord est l'interface du produit.
- Le dossier d'actualité est l'unité métier.
- Le backend applique les règles.
- Le LLM assiste uniquement l'analyse éditoriale.
- Aucun réseau social n'est une source.
- Pas de plateforme Web, pas d'API publique, pas de multi-agent.

En cas de doute, le handoff prime : [`handoff.md`](../handoff.md).

---

## Avant de proposer un changement

1. Lire le handoff et la documentation liée au sujet.
2. Vérifier que la proposition ne contredit pas une décision gelée.
3. Distinguer clairement faits, hypothèses et recommendations.
4. Si une règle métier manque : **ne pas inventer** — poser la question et attendre l'arbitrage.
5. Les idées hors périmètre appartiennent au Parking (`ROADMAP.md`), pas à une PR furtive.

---

## Workflow Git

1. Partir d'une base à jour (`main`).
2. Travailler sur une branche dédiée au changement.
3. Garder le périmètre de la branche aligné sur une décision / ticket / gel.
4. Ouvrir une revue avant intégration.
5. Ne pas intégrer de secret, de dump PostgreSQL, ni de sauvegarde.
6. Synchroniser le handoff (état + journal) après une tâche Cursor structurante.

---

## Conventions de commit

Messages conventionnels (`feat`, `fix`, `chore`, `docs`, `refactor`) :

- messages **clairs et ciblés** ;
- un commit = une intention compréhensible ;
- indiquer le **pourquoi** lorsque ce n'est pas évident ;
- ne pas mélanger refactors massifs et changements métier sans nécessité.

Référence d'historique des versions produit : [`CHANGELOG.md`](CHANGELOG.md).

---

## Conventions de code

Stack gelée à respecter :

- TypeScript
- Node.js LTS (≥ 20)
- npm Workspaces
- Fastify
- discord.js
- PostgreSQL + Prisma
- Docker Compose
- Ollama partagé · Ministral 3 3B

Règles de contribution technique :

- ne pas introduire de stack ou de modèle alternatif ;
- ne pas exposer d'API publique ;
- ne pas brancher de réseaux sociaux comme sources ;
- laisser la **décision finale** au backend ;
- respecter collecte incrémentale, SSRF, et contrainte d'une seule inférence simultanée ;
- frontières packages : pas de `discord.js` hors `apps/bot` ; pas de Prisma hors `@radar-ia/database`.

Tests : Vitest (`npm test`). Typecheck : `npm run typecheck`.

---

## Revue de code

Une revue doit vérifier a minima :

| Contrôle | Question |
|----------|----------|
| Alignement handoff | Le changement respecte-t-il une décision gelée ? |
| Périmètre | Hors Parking / hors invention ? |
| Sécurité | Secrets, SSRF, privilèges Discord ? |
| LLM | Aucune décision autonome du modèle ? |
| Données | PostgreSQL / sauvegardes restent hors dépôt ? |
| Discord | Fils, archivage, lecture seule préservés si impactés ? |

Un « ça compile » ne constitue pas une validation métier.

---

## Bonnes pratiques

- Lire [`ARCHITECTURE.md`](../Architecture/ARCHITECTURE.md), [`SOURCES.md`](../Reference/SOURCES.md), [`LLM.md`](../Architecture/LLM.md), [`DISCORD.md`](../Architecture/DISCORD.md), [`SECURITY.md`](../Reference/SECURITY.md) avant de toucher aux pipelines.
- Documenter l'impact visible (README / changelog) lorsque le comportement produit change.
- Préférer une évolution documentée à une réinvention locale.
- Isoler les expérimentations hors du chemin critique tant qu'elles ne sont pas arbitrées.

---

## Qualité attendue

| Attente | Critère |
|---------|---------|
| Traçabilité | Le changement se rattache à une décision ou un gel |
| Vérifiabilité | Comportement testable / observable |
| Sobriété | Pas de fonctionnalité hors périmètre |
| Sûreté | Pas de secret, pas de contournement SSRF, pas d'élargissement d'attaque (API publique, etc.) |
| Cohérence doc | Code et documentation restent alignés après coup |

---

## Ce qui n'est pas acceptable

- Inventer une règle métier absente du handoff.
- Réintroduire une idée du Parking sans arbitration (dashboard Web, API publique, recherche avancée, statistiques avancées).
- Confier la décision finale au LLM.
- Utiliser un réseau social comme source.
- Modifier silencieusement une décision documentée pour coller au code.

---

## Aide

- Mémoire officielle : [`handoff.md`](../handoff.md)
- Feuille de route : [`ROADMAP.md`](ROADMAP.md)
- Installation / config : [`INSTALL.md`](../Setup/INSTALL.md), [`CONFIGURATION.md`](../Setup/CONFIGURATION.md)
- Vulnérabilités : [`../../SECURITY.md`](../../SECURITY.md)
