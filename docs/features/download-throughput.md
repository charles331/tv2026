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

### Reste à faire (après mesure réelle)
Ajustement fin de la taille de bloc selon la courbe observée, et éventuellement essai d'un
`User-Agent` neutre (certains panels limitent selon l'UA — actuellement un UA de navigateur
est envoyé).

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
4. La taille de bloc vers laquelle l'auto-ajustement converge (visible dans le Journal).
