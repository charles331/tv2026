<!--
⚠️ Le TITRE de cette PR pilote la version publiée (semantic-release, fusion en squash).
Il DOIT suivre les Conventional Commits, p.ex. :
  feat(player): ajoute le réglage du volume
  fix(downloads): corrige la reprise après coupure
Types : feat | fix | perf | refactor | docs | style | test | build | ci | chore | revert
-->

## Résumé

<!-- Que fait cette PR et pourquoi ? -->

## Nouveautés

<!--
Ce que l'utilisateur verra, en français simple : une puce par changement.
Ces puces s'affichent telles quelles dans Réglages → Application → Nouveautés
de la version publiée (pour une PR feat / fix / perf). Sans cette section, le
titre de la PR sert de puce. Supprimer la section si rien n'est visible.
-->

-

## Type de changement

- [ ] `fix` — correctif (patch)
- [ ] `feat` — nouvelle fonctionnalité (mineure)
- [ ] Breaking change (`!` / `BREAKING CHANGE:`) (majeure)
- [ ] `docs` / `chore` / `refactor` / `test` / `ci` (patch)

## Checklist

- [ ] `pnpm typecheck`, `pnpm lint` et `pnpm test` passent
- [ ] Aucun identifiant, URL de fournisseur réel ou contenu sous droits ajouté
- [ ] (si visible pour l'utilisateur) section « Nouveautés » remplie
- [ ] Titre de PR au format Conventional Commits
