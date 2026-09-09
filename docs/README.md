# Documentation — Radar IA

Ici se trouve la documentation de Radar IA : un bot Discord de veille sur l’intelligence artificielle.

Le [README racine](../README.md) présente le produit. Les pages ci-dessous détaillent l’installation, le fonctionnement et les règles à respecter si vous contribuez.

Licence : [`../LICENSE`](../LICENSE) · signaler une vulnérabilité : [`../SECURITY.md`](../SECURITY.md)

---

## Par où commencer

1. [Installer](Setup/INSTALL.md) et [configurer](Setup/CONFIGURATION.md)
2. Comprendre l’[architecture](Architecture/ARCHITECTURE.md)
3. Voir comment [Discord](Architecture/DISCORD.md) et le [LLM](Architecture/LLM.md) s’articulent
4. Déclarer des [sources](Reference/SOURCES.md)

Pour contribuer : [`Project/CONTRIBUTING.md`](Project/CONTRIBUTING.md).
Les décisions déjà tranchées sont dans [`handoff.md`](handoff.md).

---

## Installation et configuration

| Document | Contenu |
|----------|---------|
| [`Setup/INSTALL.md`](Setup/INSTALL.md) | Prérequis, Docker Compose, lancement |
| [`Setup/CONFIGURATION.md`](Setup/CONFIGURATION.md) | Variables d’environnement et réglages |

---

## Fonctionnement

| Document | Contenu |
|----------|---------|
| [`Architecture/ARCHITECTURE.md`](Architecture/ARCHITECTURE.md) | Vue d’ensemble et pipelines |
| [`Architecture/DISCORD.md`](Architecture/DISCORD.md) | Publication, fils, permissions, admin |
| [`Architecture/LLM.md`](Architecture/LLM.md) | Rôle et limites du modèle |
| [`Reference/SOURCES.md`](Reference/SOURCES.md) | Sources, collecte, protection SSRF |

---

## Sécurité

| Document | Contenu |
|----------|---------|
| [`Reference/SECURITY.md`](Reference/SECURITY.md) | Exigences techniques |
| [`../SECURITY.md`](../SECURITY.md) | Comment signaler une vulnérabilité |

---

## Projet

| Document | Contenu |
|----------|---------|
| [`handoff.md`](handoff.md) | Décisions, invariants, état |
| [`Project/CONTRIBUTING.md`](Project/CONTRIBUTING.md) | Guide de contribution |
| [`Project/ROADMAP.md`](Project/ROADMAP.md) | Feuille de route |
| [`Project/CHANGELOG.md`](Project/CHANGELOG.md) | Historique des versions |

---

## Arborescence

```text
docs/
├── README.md                 ← ce fichier
├── handoff.md
├── Architecture/
│   ├── ARCHITECTURE.md
│   ├── LLM.md
│   └── DISCORD.md
├── Setup/
│   ├── INSTALL.md
│   └── CONFIGURATION.md
├── Reference/
│   ├── SOURCES.md
│   └── SECURITY.md
└── Project/
    ├── ROADMAP.md
    ├── CHANGELOG.md
    └── CONTRIBUTING.md
```
