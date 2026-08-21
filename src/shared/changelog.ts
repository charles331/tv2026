/**
 * Application changelog — SOURCE OF TRUTH for the "Nouveautés" section in
 * Réglages and the "what's new" badge after an update.
 *
 * Keep this list newest-first. When you bump `version` in package.json, add a
 * matching entry here (a unit test asserts the current version is documented).
 * Dates are ISO `YYYY-MM-DD`. `changes` are short, user-facing French bullets.
 */

export interface ChangelogEntry {
  /** Semantic version, matching a published release (e.g. "0.1.1"). */
  version: string
  /** Release date, ISO `YYYY-MM-DD`. */
  date: string
  /** Short, user-facing change bullets (French). */
  changes: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.13.1',
    date: '2026-08-21',
    changes: [
      'Correctif : si le fournisseur refuse plusieurs connexions simultanées (il coupe la connexion en trop), le téléchargement ne tombe plus en échec — il continue automatiquement avec une seule connexion, et le réglage est ramené à 1 en le signalant dans le Journal.',
      'Les morceaux déjà reçus dans la vague interrompue sont conservés, sans re-téléchargement inutile.'
    ]
  },
  {
    version: '0.13.0',
    date: '2026-08-21',
    changes: [
      'Téléchargements : possibilité d’utiliser plusieurs connexions en parallèle (Réglages → Téléchargements). Le fournisseur limitant chaque connexion (~0,5 Mio/s) très en dessous d’une ligne courante, cela peut multiplier la vitesse d’autant.',
      'Les morceaux sont récupérés en parallèle mais écrits strictement dans l’ordre : la reprise après pause ou coupure fonctionne exactement comme avant.',
      'Nouveau choix d’« identité du client » (navigateur ou lecteur vidéo) : certains fournisseurs limitent différemment selon le logiciel.',
      'Le Journal indique le nombre de connexions utilisées, pour comparer les réglages.'
    ]
  },
  {
    version: '0.12.0',
    date: '2026-08-21',
    changes: [
      'Téléchargements bien plus rapides : nouveau mode « par blocs » qui redemande le fichier morceau par morceau (comme un déplacement dans un film) pour rester dans la phase rapide du serveur, au lieu de subir le bridage d’une longue connexion continue.',
      'Réglages → Téléchargements : interrupteur « Téléchargement par blocs » pour activer/désactiver et comparer. Repli automatique en mode continu si le fournisseur ne le gère pas.',
      'Le débit est écrit dans le Journal toutes les 30 s avec le mode utilisé, pour mesurer le gain.',
      'Sécurité des fichiers renforcée : un téléchargement n’est finalisé que si sa taille correspond exactement à celle annoncée par le serveur, et les octets déjà récupérés ne sont plus jamais supprimés sur une réponse inattendue.'
    ]
  },
  {
    version: '0.11.0',
    date: '2026-07-09',
    changes: [
      'Réglages réorganisés en onglets — Connexion, Catalogues, Téléchargements, Application, Journal — fini le long défilement.',
      'Chaque onglet affiche une description de ce qu’on y trouve.'
    ]
  },
  {
    version: '0.10.0',
    date: '2026-07-02',
    changes: [
      'Réglages : nouveau « Journal de l’application » — trace les actions importantes (lecture, téléchargements, enregistrements, mises à jour, rappels) et les erreurs/crashs, avec filtres par niveau, copie et accès au fichier sur disque.',
      'Les messages d’erreur du lecteur mpv sont désormais capturés dans le journal, pour comprendre pourquoi une lecture s’arrête toute seule.',
      'Identifiants et URLs de flux sont automatiquement masqués dans le journal.'
    ]
  },
  {
    version: '0.9.3',
    date: '2026-06-22',
    changes: [
      '« Tout mettre à jour » recharge désormais les films, séries et le direct à la fin — plus besoin de redémarrer l’application pour voir les nouveautés.',
      'Mises à jour de l’application : plus rien ne se télécharge ni ne s’installe en arrière-plan. L’application vous prévient, vous lancez le téléchargement (progression visible dans les Réglages), puis l’installateur classique s’affiche à l’écran.'
    ]
  },
  {
    version: '0.9.2',
    date: '2026-06-17',
    changes: [
      'Direct : correction de la reconnexion automatique qui pouvait rester bloquée sur « Reconnexion… » — elle relance maintenant proprement la connexion (comme un « Arrêter » puis « Regarder »), ce qui récupère réellement le flux.',
      'Après la reprise, le volume, le plein écran, la pause et la langue/les sous-titres choisis sont restaurés.'
    ]
  },
  {
    version: '0.9.1',
    date: '2026-06-12',
    changes: [
      'Direct : un flux qui se coupe tout seul (coupure réseau, hoquet du fournisseur) se reconnecte désormais automatiquement, au lieu de fermer la lecture.',
      'La barre affiche « Reconnexion… » (avec le numéro de tentative) et réessaie tant que vous ne cliquez pas vous-même sur « Arrêter ».'
    ]
  },
  {
    version: '0.9.0',
    date: '2026-06-12',
    changes: [
      'Direct : le bouton « Guide » est aussi disponible sur les chaînes en favori.',
      'À l’ouverture du guide, l’affichage se place directement sur le programme en cours.',
      'La barre de lecture se ferme automatiquement quand vous fermez la fenêtre vidéo.'
    ]
  },
  {
    version: '0.8.0',
    date: '2026-06-07',
    changes: [
      'Direct : nouveau « Guide » par chaîne (bouton Guide) — la grille complète des programmes, groupée par jour, avec le programme en cours surligné.',
      'Depuis le guide, chaque programme propose « 🔔 Rappel » (notification système à l’approche) et « ⏺ Enregistrer » (enregistrement programmé).',
      'Nouvelle section « Programmés » : vos rappels et enregistrements (à venir / en cours / passés) avec leur statut, et l’annulation en un clic.',
      'Notification système quand un programme va commencer ; un clic ouvre la chaîne.',
      'Enregistrement programmé en arrière-plan (sans fenêtre vidéo) avec marges configurables avant/après.',
      'Conflit de connexion : si un enregistrement doit démarrer pendant une lecture, l’application demande s’il faut continuer la lecture ou basculer sur l’enregistrement.',
      'Réglages : délai de rappel par défaut et marges d’enregistrement (avant / après).',
      'Note : rappels et enregistrements ne fonctionnent que lorsque l’application est ouverte.'
    ]
  },
  {
    version: '0.7.2',
    date: '2026-06-03',
    changes: ['Nouvelle icône d’application (raccourci, barre des tâches et installeur).']
  },
  {
    version: '0.7.1',
    date: '2026-06-03',
    changes: [
      'Maintenance technique : mise à jour des dépendances (Electron, chaîne de build, outils de test) pour la sécurité et la stabilité.'
    ]
  },
  {
    version: '0.7.0',
    date: '2026-06-03',
    changes: [
      'Favoris : ajoutez films, séries et chaînes en favori avec l’étoile ; une catégorie « ★ Favoris » apparaît en tête de chaque section.',
      'Un favori dont la source a disparu après un rafraîchissement reste listé avec un statut « Hors ligne » (rouge).',
      'Lecture : les contrôles passent dans une barre en bas — on peut continuer à naviguer dans l’app pendant qu’un flux joue dans la fenêtre vidéo.',
      'Direct : bouton « Enregistrer » pendant la lecture d’une chaîne (le flux est enregistré sur le disque, avec un peu de tampon avant grâce au cache mpv).',
      'Séries : boutons « Télécharger la saison » et « Télécharger toutes les saisons » (les épisodes déjà récupérés ou en file sont ignorés).',
      'Téléchargements rangés automatiquement en sous-dossiers « Films », « Séries » et « Live ».',
      'L’application se souvient durablement de ce qui a déjà été téléchargé, même après redémarrage.'
    ]
  },
  {
    version: '0.6.1',
    date: '2026-06-03',
    changes: [
      'Préparation à la publication open-source : licences, attributions (mpv, TMDB) et nettoyage du dépôt.'
    ]
  },
  {
    version: '0.6.0',
    date: '2026-06-03',
    changes: [
      'Le logo en haut à gauche ramène désormais au catalogue (Accueil).',
      'Colonne des catégories : largeur ajustable (glisser le bord) et champ de filtre.',
      'Bouton « Tout mettre à jour » (films + séries + direct) dans la barre de gauche, avec confirmation et notification de fin.'
    ]
  },
  {
    version: '0.5.0',
    date: '2026-06-02',
    changes: [
      'Direct (TV) : nouvelle section pour parcourir les chaînes par catégorie, avec le programme en cours / à suivre (EPG) et la lecture en direct.'
    ]
  },
  {
    version: '0.4.0',
    date: '2026-06-02',
    changes: [
      'Séries : navigation par catégories, recherche, fiche série avec saisons et épisodes, lecture et téléchargement par épisode.',
      'Fiches films : la note du fournisseur et la note TMDB sont affichées toutes les deux, avec un lien vers IMDb.',
      'Téléchargements : bouton « Réessayer » sur un téléchargement échoué (reprend là où il s’est arrêté).'
    ]
  },
  {
    version: '0.3.0',
    date: '2026-06-02',
    changes: [
      'Note TMDB en direct sur les fiches films (clé API TMDB facultative, stockée chiffrée).',
      'Correctif : un téléchargement bloqué au renommage sous Windows (antivirus/indexeur, « EBUSY ») se termine désormais tout seul, sans tout retélécharger.'
    ]
  },
  {
    version: '0.2.1',
    date: '2026-06-02',
    changes: [
      'Releases : l’installeur et la version portable ont enfin des libellés distincts.'
    ]
  },
  {
    version: '0.2.0',
    date: '2026-06-02',
    changes: [
      'Nouvelle section « Nouveautés » dans les réglages, avec un repère après chaque mise à jour.',
      'Publication automatique des nouvelles versions (basée sur les messages de commit).'
    ]
  },
  {
    version: '0.1.1',
    date: '2026-06-01',
    changes: ['Correctif de lecture : la vidéo s’ouvre désormais dans une fenêtre mpv dédiée.']
  },
  {
    version: '0.1.0',
    date: '2026-06-01',
    changes: [
      'Première version de TV2026.',
      'Connexion à un panel Xtream Codes (identifiants chiffrés localement).',
      'Catalogue VOD : catégories, recherche, fiches détaillées.',
      'Téléchargement de films avec reprise après coupure et file séquentielle.',
      'Lecture intégrée via mpv (fichier local ou streaming direct).',
      'Mise à jour automatique via GitHub Releases.'
    ]
  }
]
