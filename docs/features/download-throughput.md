# Proposition — Accélérer les téléchargements (téléchargement par blocs)

> Statut : **implémenté** sur la branche `analyse/download-throughput` (v0.12.0),
> en attente de mesure réelle chez le fournisseur.
> Réglage : `Réglages → Téléchargements → Téléchargement par blocs` (activé par défaut).
> Domaine : moteur de téléchargement (`src/main/downloads/DownloadManager.ts`).

## 1. Symptôme observé

Un téléchargement démarre **très vite** (plusieurs Mo/s) puis **s'effondre** et se stabilise
à un débit faible. Résultat : télécharger un film prend à peu près la durée du film.

## 2. Mécanisme actuel (ce que fait le code aujourd'hui)

`DownloadManager.transfer()` fait **une seule requête HTTP pour tout le fichier** :

| Étape | Code | Détail |
|---|---|---|
| 1. URL | `buildMovieUrl` / `buildEpisodeUrl` | URL canonique, re-résolue à chaque (re)démarrage |
| 2. Requête | `request(url, { method: 'GET' })` | **une** requête, `Range: bytes=<déjà reçu>-` → **ouverte jusqu'à la fin du fichier** |
| 3. Corps | `pipeline(body, counter, out)` | flux écrit sur disque avec contre-pression (jamais tout en mémoire) |
| 4. Fin | `renameWithRetry(.part → final)` | renommage atomique |

Autrement dit : **une connexion unique maintenue ouverte pendant toute la durée du
téléchargement**, exactement comme un lecteur vidéo qui lit un film en continu.
La reprise après coupure se fait par `Range` au redémarrage (déjà en place, à conserver).

## 3. Diagnostic : pourquoi ça ralentit

Le comportement décrit correspond au **façonnage de trafic (« pacing ») côté fournisseur**,
standard sur les panels IPTV / backends de streaming :

1. **Rafale initiale** : le serveur envoie un gros bloc à pleine vitesse pour remplir le
   tampon du lecteur (démarrage sans saccade).
2. **Puis limitation** : le débit est ramené à ~1–1,5× le débit du média, pour servir
   beaucoup de clients simultanément.

Comme notre téléchargement se présente comme **une lecture continue** (une connexion
longue), il subit exactement la même limitation qu'un lecteur → d'où « la durée du film ».

C'est bien l'hypothèse formulée : **le ralentissement n'est pas dû à notre code**, mais au
fait que nous demandons le fichier de la façon que le serveur limite.

## 4. Solution proposée : téléchargement par blocs (« comme un déplacement dans le film »)

Quand un lecteur **se déplace** dans un film, il ouvre une **nouvelle requête `Range`** à un
nouvel offset — et le serveur **redonne une rafale à pleine vitesse** (il doit re-remplir le
tampon). L'idée : rester en permanence dans cette phase de rafale.

### Principe

Remplacer la requête unique par une **boucle séquentielle de requêtes bornées** :

```
offset = déjà reçu
tant que offset < taille totale :
    GET  Range: bytes=<offset>-<offset + tailleBloc - 1>     ← borné aux deux bouts
    écrire le bloc à la suite du .part
    fermer la connexion
    offset += bloc reçu
```

### Points essentiels

- **Séquentiel, jamais parallèle.** Le fournisseur n'autorise **qu'une connexion** : on garde
  donc **un seul bloc à la fois**. Le gain ne vient *pas* du parallélisme (qui ferait bannir
  le compte) mais du **réamorçage de la rafale** à chaque nouvelle requête.
- **« Déconnexion » réelle.** `undici` mutualise les sockets par origine (keep-alive) : une
  requête suivante réutiliserait la même connexion TCP, et donc peut-être l'état de
  limitation du serveur. Il faudra pouvoir **forcer une connexion neuve** par bloc
  (en-tête `connection: close` et/ou dispatcher recréé) — c'est le « mécanisme de connexion /
  déconnexion » évoqué.
- **Taille de bloc auto-ajustée.** L'optimum ≈ **la taille de la rafale** du serveur. On mesure
  le débit à l'intérieur de chaque bloc : si le débit s'écroule avant la fin du bloc, on
  **réduit** ; s'il tient à pleine vitesse jusqu'au bout, on **augmente**. Démarrage à ~8 Mio,
  bornes ~2–64 Mio.
- **Coût par bloc.** Chaque requête refait la redirection 302 → URL signée (~100–300 ms).
  Avec des blocs de 8 Mio, un fichier de 4 Gio = ~500 blocs → ~1–2 min de surcoût total,
  négligeable face au gain espéré (heures → minutes).
- **La reprise reste inchangée** : le `.part` et le `Range` de reprise fonctionnent déjà
  ainsi, on ne casse rien.

## 5. Ce qui n'est PAS garanti (à mesurer)

Il faut être honnête : **le gain dépend de la façon dont le fournisseur limite**.

| Cas | Effet du découpage |
|---|---|
| Limitation **par connexion** (le plus courant) | ✅ Gain important — on reste en rafale |
| Limitation **par compte / fenêtre de temps** (seau à jetons) | ❌ Aucun gain — le plafond suit le compte |
| Le serveur **ignore les `Range` bornés** (répond `200` au lieu de `206`) | ❌ Découpage impossible → repli nécessaire |
| Le serveur **pénalise** les requêtes rapprochées | ⚠️ À contenir avec des blocs assez gros |

D'où une conception **prudente, mesurée et réversible** (§6).

## 6. Plan proposé

### Livré (v0.12.0)

- **Mesure** : le journal écrit une ligne de **débit toutes les 30 s**, préfixée du mode
  (`[blocs]` / `[continu]`) → comparaison chiffrée entre les deux moteurs.
- **Moteur par blocs** (`src/main/downloads/blockEngine.ts`) : boucle séquentielle de `Range`
  bornés, `connection: close` par bloc (une connexion neuve, vérifié contre undici), taille
  de bloc auto-ajustée, retentatives par bloc, délai de politesse entre blocs et plafond de
  requêtes par fichier.
- **Réglage** : interrupteur **on/off** (et non 3 modes) — plus simple, et le repli
  automatique couvre le cas « le serveur ne suit pas ».
- **Garde-fous d'intégrité** (un moteur de téléchargement qui se trompe corrompt un film) :
  - un bloc n'est ajouté que si le **début du `Content-Range` est confirmé** égal à la fin du
    `.part` — « invérifiable » est traité comme **dangereux**, pas comme acceptable ;
  - la **taille totale est verrouillée** au premier `206` ; tout désaccord ultérieur est fatal
    (le fichier a changé sur le serveur) ;
  - une fois qu'un `206` valide a prouvé que les plages fonctionnent, un `200` ultérieur est
    une **erreur serveur** (jeton expiré, page d'erreur) — jamais un signal « plages non
    supportées » ;
  - le fichier n'est **finalisé que si sa taille correspond exactement** au total annoncé ;
  - les octets déjà téléchargés ne sont **jamais supprimés** sur une réponse `200` ambiguë.
- **Tests** : le moteur est testé en intégration contre un serveur HTTP local
  (`test/main/blockEngine.test.ts`) — chemin nominal, reprise, décalage de `Content-Range`,
  `Content-Range` absent, taille qui change, `200` en cours de route, coupure en pleine
  réponse, flux non borné, limitation, interruption, plafond de blocs.

## 6bis. Résultat des mesures terrain (2026-08-21) — enquête close

Trois campagnes de mesure sur le compte réel ont tranché.

### Le débit est un plafond de compte, pas un défaut du client

| Mesure | Valeur |
|---|---|
| Ligne de l'utilisateur (speedtest) | 85,6 Mbit/s |
| Débit obtenu, mode continu | 3,7 Mbit/s (~471 Kio/s), soit **4,3 %** de la ligne |
| Reconnexion à chaque bloc | aucun effet sur le débit moyen |
| 2 ou 4 connexions en parallèle | **refusées** : le fournisseur coupe la connexion en trop |

La tentative parallèle a produit `Response body length does not match content-length header`
sur chaque vague. Une sonde locale (requêtes concurrentes avec `connection: close`, agent
partagé / un agent par requête / sans l'en-tête) a montré que le client, lui, fonctionne :
la troncature vient du panel. **Le compte n'autorise réellement qu'une connexion.**

### Mais il reste un vrai levier : le burst par connexion

Les fenêtres de 30 s du Journal sont **bimodales**, et de façon très nette :

| Fenêtres de 30 s | Débit moyen |
|---|---|
| Mode continu (n = 23) | **471,4 Kio/s** (min 471,1 / max 471,6) |
| Mode blocs, sans fin de bloc dans la fenêtre (n = 24) | **470,9 Kio/s** — *identique au continu* |
| Mode blocs, avec une fin de bloc dans la fenêtre (n = 26) | **509,8 Kio/s** |

Une connexion établie est donc bridée par un limiteur **plat** à 471 Kio/s ; le surplus
n'apparaît qu'autour d'un changement de bloc. Le surplus vaut ≈ 1,1 Mio par fenêtre
contenant une reconnexion : **chaque nouvelle connexion se voit accorder ~1 Mio hors
limitation** avant que le limiteur n'engage (comportement typique d'un seau à jetons dont
l'allocation est par connexion).

Conséquence directe : **la taille de bloc est LE paramètre de débit.** Petit bloc =
reconnexions fréquentes = bonus encaissé souvent.

| Taille de bloc | Débit projeté |
|---|---|
| 2 Mio | ~0,84 Mio/s (×1,8) |
| 4 Mio | ~0,60 Mio/s (×1,3) |
| 8 Mio | ~0,52 Mio/s (×1,1) |
| 36 Mio | ~0,47 Mio/s (×1,0 — indiscernable du mode continu) |

### Pourquoi l'ajustement automatique a été supprimé

Le contrôleur adaptatif comparait le débit de queue au pic à l'intérieur du bloc. Face à un
limiteur **plat**, ce signal est du bruit : en production il a oscillé puis dérivé vers le
haut — 8 → 5,6 → 8,4 → 12,6 → 28 → 19,8 → 29,8 → 20,8 → 31 → 21,8 → 32,7 → 22,9 → 34,4 →
36 Mio. Or c'est exactement la mauvaise direction : à 36 Mio il n'y a plus qu'une
reconnexion toutes les ~78 s et le bonus disparaît.

Il est remplacé par un **réglage explicite** (`downloadBlockBytes`, défaut 2 Mio, choix
1/2/4/8/16/32 Mio dans Réglages → Téléchargements). Plus simple, mesurable par
l'utilisateur, et incapable de dériver dans le mauvais sens.

### Autres correctifs issus des mesures

- **Refus du parallèle → on reste en mode blocs sur 1 connexion** (et le réglage revient à 1
  avec une ligne de Journal). Auparavant on retombait en mode continu, c'est-à-dire qu'on
  abandonnait le bonus de reconnexion pour tout le reste du fichier.
- **Verrou local Windows** : un `EBUSY` sur le `.part` (antivirus, indexeur — observé en
  production) a désormais son propre budget de tentatives (12, patientes), distinct des 4
  tentatives réservées aux incidents réseau. Une analyse antivirus ne peut plus faire échouer
  un téléchargement par ailleurs sain.

### Ce qui n'est PAS possible

Aucune technique côté client ne dépassera l'allocation du compte : une connexion, ~471 Kio/s
en régime établi. Le seul levier restant au-delà de la taille de bloc est **l'offre du
fournisseur** (plus de connexions simultanées, ou plus de débit). Le réglage « identité du
client » (UA navigateur ou lecteur) reste disponible au cas où le panel limiterait selon le
logiciel.

## 7. Ce qui ne change pas

- **Connexion unique** respectée (un seul bloc en vol, `ConnectionLock` inchangé).
- **Reprise** après coupure/pause (`.part` + `Range`) inchangée.
- **File d'attente séquentielle**, priorité à la lecture, renommage atomique : inchangés.
- Aucune modification du choix de la source ni de l'UI de la file.

## 8. À valider chez le fournisseur (Windows)

1. Le gain réel : comparer les lignes `[blocs]` et `[continu]` du Journal sur le même film.
2. Ce que renvoie le panel **quand le jeton expire en cours de téléchargement** (`200` +
   page d'erreur, ou `401/403`) — le moteur traite les deux sans risque pour le `.part`.
3. Si ~100–2000 requêtes séquentielles par film déclenchent une limitation (le moteur se
   replie tout seul sur `429/403/503`).
4. La taille de bloc qui donne le meilleur débit (comparer les lignes `[blocs]` du Journal
   entre 1, 2 et 4 Mio) — cf. § 6bis.
