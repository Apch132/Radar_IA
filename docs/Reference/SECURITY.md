# Sécurité — Radar IA

Version de référence : **1.0**  
Source officielle : [`handoff.md`](../handoff.md)

Ce document formalise les exigences de sécurité **déjà retenues** et les contrôles livrés.

Signalement d’une vulnérabilité : [`../../SECURITY.md`](../../SECURITY.md) (GitHub Private Vulnerability Reporting — ne pas ouvrir d’issue publique).

Documents liés : [`SOURCES.md`](SOURCES.md), [`CONFIGURATION.md`](../Setup/CONFIGURATION.md), [`INSTALL.md`](../Setup/INSTALL.md), [`LLM.md`](../Architecture/LLM.md).

---

## Sécurité générale

Radar IA traite des contenus externes puis publie sur Discord. Les axes gelés :

- réduire la surface d'attaque (pas d'API publique, pas de plateforme Web) ;
- isoler l'exécution (Docker Compose) ;
- garder données et sauvegardes **hors dépôt** ;
- protéger la collecte (**SSRF**, y compris anti-rebinding DNS — 010.1A) ;
- conserver la décision métier côté **backend** (le LLM n'est pas autorité).

---

## Isolation Docker

- Orchestration via **Docker Compose**.
- PostgreSQL publié uniquement sur `127.0.0.1` en développement.
- Worker optionnel : utilisateur non-root, filesystem en lecture seule, capabilities minimales.
- PostgreSQL reste **hors dépôt** (séparation données / code).

---

## Stockage

| Élément | Exigence |
|---------|----------|
| PostgreSQL | Hors dépôt |
| Sauvegardes | Hors dépôt |
| Collecte | Stockage **brut** + **nettoyé** ; rétention bornée des snapshots bruts (`RAW_FEED_RETENTION_*`) |
| Secrets | Hors dépôt, jamais commités |

---

## Secrets

- Tokens Discord, identifiants PostgreSQL et tout secret d'exploitation : **hors dépôt**.
- Configuration via environnement (voir [`CONFIGURATION.md`](../Setup/CONFIGURATION.md)).
- Les messages d’erreur admin Discord n’exposent pas les détails techniques bruts.

---

## Protection SSRF

Obligation gelée sur le pipeline de collecte :

- protocoles `http` / `https` seuls ;
- refus localhost / IP privées / metadata ;
- résolution DNS validée puis **connexion pinnée** à l’adresse validée (anti-rebinding) ;
- revalidation à chaque redirection.

Détail doctrine : [`SOURCES.md`](SOURCES.md).

---

## Validation des entrées

- sources limitées aux niveaux **S → E** ;
- **réseaux sociaux exclus** ;
- sortie LLM = proposition JSON validée ; faits ancrés ; décision backend ;
- contexte LLM encadré comme données non fiables (délimiteurs 010.1A).

---

## Limitation des privilèges

| Surface | Limitation retenue |
|---------|--------------------|
| Discord membres | **Lecture seule** |
| Admin Discord | Allowlist user IDs + rate-limit + ephemeral |
| LLM | Assistance uniquement ; une inférence globale (lease PG) |
| API publique | **Absente** (seul `/health` interne) |
| Multi-agent | **Non** |

---

## Recommandations de production

1. Ne pas exposer d’API publique.
2. Remplacer tous les placeholders de secrets.
3. Ne pas publier PostgreSQL hors loopback / réseau privé contrôlé.
4. Surveiller rétention snapshots et taille DB.
5. Garder `OLLAMA_MAX_CONCURRENCY=1` et le lease d’inférence.
