# BG3 Planner — instructions du projet

Planificateur de partie pour Baldur's Gate 3, bilingue (français, anglais), application web statique publiée sur GitHub Pages. **La conception fait foi** : `docs/superpowers/specs/2026-11-23-bg3-planner-design.md`. La lire avant tout travail, et ne pas rouvrir une décision qu'elle consigne sans accord de l'utilisateur.

Le contexte propre au poste (chemins du jeu, outils existants, règles de travail, état de la session précédente) est dans `CLAUDE.local.md`, non versionné.

## Principes qui ne se négocient pas

- **Tout est repéré par l'identifiant interne du jeu** (`Target_BurstingSinew`, `MAG_Acrobat_Shoes`…). Les noms affichés sont des traductions de cet identifiant, jamais des clés.
- **Aucun libellé de jeu écrit à la main** : noms et descriptions viennent des tables de traduction anglaise et française du jeu, produites par les scripts d'import.
- **Aucune ressource chargée depuis un autre site** une fois la page servie : polices, scripts, styles, images et données sont inclus dans le site. Un contrôle à la construction le vérifie.
- **Aucun serveur** : l'état vit dans le navigateur ; la chaîne d'export (préfixe versionné, JSON compressé, base64 URL) est la seule sauvegarde durable et doit rester relisible d'une version à l'autre.
- **Un import ne corrige jamais en silence** : tout choix refusé par le moteur de règles est listé.
- **Les sauvegardes et les fichiers du jeu se lisent, ne s'écrivent jamais.**

## Données et licences

- Code : GPL-3.0 (`LICENSE`). Du code repris d'un autre projet doit avoir une licence compatible (MIT, BSD, GPL-3.0…) et garder sa mention d'origine ; un projet sans licence se lit, ne se copie pas.
- `data/larian/` : produit par script depuis les fichiers du jeu, jamais édité à la main ; contenu propriété de Larian Studios, projet de fans non commercial.
- `data/wiki/` : produit par script depuis bg3.wiki (tables Cargo), CC BY-NC-SA 4.0, attribution obligatoire. bg3.wiki limite fortement les robots : extraction ponctuelle, lente, jamais depuis le site.
- `data/rules/` : écrit à la main, bilingue (compagnons, alertes d'histoire, bonus uniques), faits sourcés sur bg3.wiki, libellés tirés des tables de traduction.

## Conventions

- **Tout en anglais** (décision de l'utilisateur, 2026-11-23) : code (identifiants, commentaires, docstrings, tests, messages d'erreur, clés des JSON produits, noms de dossiers), documentation technique et messages de commit. La conception et le plan 1, écrits avant cette décision, restent en français. Un message de commit dit ce que le changement établit, pas les fichiers touchés.
- Aucun retour à la ligne forcé dans les fichiers texte (Markdown compris).
- Jamais d'URL de session ni d'identifiant interne d'outil dans un commit, une PR ou une issue.
- Node 24 (Node 26 casse Vitest) ; Python 3.14 pour les scripts de données.
