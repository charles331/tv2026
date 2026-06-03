# Composants tiers / Third-party notices

TV2026 est distribué sous licence **MIT** (voir [`LICENSE`](LICENSE)). Les
**Releases** (installeur Windows) embarquent toutefois des composants tiers sous
leurs propres licences, listés ci-dessous.

---

## mpv (lecteur vidéo) — GPLv2+/LGPL

L'installeur embarque le lecteur **mpv** (`mpv.exe` et ses DLLs) pour la lecture
vidéo. **mpv n'est PAS couvert par la licence MIT de TV2026** : il est distribué
**tel quel, comme exécutable séparé** (TV2026 ne fait que l'invoquer au runtime,
sans liaison statique), sous licence **GNU GPLv2-or-later** (avec des parties en
**LGPL**).

- Site / sources : <https://mpv.io> — code source : <https://github.com/mpv-player/mpv>
- Le binaire Windows embarqué provient des builds **zhongfly/mpv-winbuild** :
  <https://github.com/zhongfly/mpv-winbuild> (qui publient le build **et** les
  sources correspondantes). La version exacte utilisée est celle récupérée par le
  workflow de release au moment du build.
- Les textes de licence de mpv (et de ses bibliothèques, dont FFmpeg) sont
  inclus dans l'installeur, dans le dossier `resources/bin/` aux côtés du binaire.

Conformément à la GPL/LGPL, le code source de mpv correspondant au binaire
distribué est disponible aux liens ci-dessus.

> Si vous compilez TV2026 vous-même sans déposer de binaire mpv, l'application
> n'embarque alors aucun composant GPL (elle utilisera un `mpv` présent sur le
> PATH système, le cas échéant).

---

## TMDB (notes des films) — attribution requise

La fonctionnalité de note communautaire utilise l'API de **The Movie Database
(TMDB)**, avec **la clé API de l'utilisateur** (saisie dans les Réglages, stockée
chiffrée localement). TV2026 n'inclut aucune donnée TMDB ; elle est récupérée à
la demande.

> **This product uses the TMDB API but is not endorsed or certified by TMDB.**

Voir les conditions d'utilisation de TMDB : <https://www.themoviedb.org/api-terms-of-use>

---

## Dépendances applicatives (npm)

Les bibliothèques runtime principales sont distribuées sous des licences
permissives (essentiellement **MIT**) :

| Composant | Licence | Rôle |
|---|---|---|
| Electron | MIT | shell de bureau |
| React / React-DOM | MIT | interface |
| better-sqlite3 | MIT | cache local |
| undici | MIT | client HTTP |
| electron-updater | MIT | mises à jour auto |

La liste complète et exacte est dans `package.json` / `pnpm-lock.yaml`.

---

## Marques

TV2026 n'est lié, parrainé ni approuvé par aucun fournisseur IPTV, ni par les
projets Xtream Codes, mpv, Electron ou TMDB. Toutes les marques appartiennent à
leurs détenteurs respectifs.
