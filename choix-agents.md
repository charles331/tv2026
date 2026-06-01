# Choix des modèles pour les agents — explications

> Document pédagogique : pourquoi chaque agent du projet utilise Opus ou Sonnet,
> et ce que veulent dire concrètement « profondeur de raisonnement », « vitesse » et « coût ».

---

## 1. Les 3 critères, expliqués simplement

Quand on choisit un modèle d'IA pour une tâche, on arbitre entre trois choses.

### 🧠 La profondeur de raisonnement
C'est la **capacité du modèle à réfléchir en plusieurs étapes, à anticiper les conséquences,
et à repérer ce qui n'est pas évident.**

- Un modèle « profond » va, face à un problème, explorer plusieurs pistes, voir les pièges,
  tenir compte de contraintes qui interagissent entre elles, et détecter ce qui *manque*.
- Un modèle « moins profond » répond très bien quand le problème est **clair et cadré**,
  mais peut rater un effet de bord subtil ou une conséquence lointaine.

**Analogie** : un architecte expérimenté voit tout de suite qu'un mur porteur ne peut pas
bouger sans toucher l'étage du dessus. Un bon maçon, lui, monte parfaitement le mur **qu'on
lui a dessiné**. Les deux sont excellents — mais pas au même moment du chantier.

**Où ça compte** : décisions d'architecture, sécurité, revue de code, problèmes où plusieurs
contraintes se croisent (ex. notre limite « 1 seule connexion » qui touche à la fois le
téléchargement ET la lecture).

### ⚡ La vitesse
C'est **le temps que met le modèle à produire sa réponse.**

- Un modèle rapide rend la main vite → on peut **itérer souvent** (essayer, corriger, recommencer).
- Un modèle plus lent prend plus de temps par réponse, mais réfléchit davantage.

**Où ça compte** : les tâches répétitives où on enchaîne beaucoup d'allers-retours
(écrire un composant d'interface, ajuster du code). La vitesse améliore le confort et la
productivité.

### 💰 Le coût
Les modèles se facturent au **token** (≈ un morceau de mot ; ~750 mots ≈ 1000 tokens).
On paie les tokens **lus** (le contexte qu'on envoie) et les tokens **écrits** (la réponse).

- Un modèle puissant comme **Opus** coûte **plusieurs fois plus cher** par token qu'un modèle
  comme **Sonnet**.
- Sur un projet où des agents tournent beaucoup, ça change vraiment l'addition.

**Où ça compte** : dès qu'on automatise du travail répétitif, utiliser le bon modèle au bon
endroit évite de « payer Opus » pour des tâches que Sonnet fait très bien.

### Le compromis en une image

```
        profondeur de raisonnement ↑
                    │
         OPUS  ●    │   (cher, plus lent, mais voit loin)
                    │
                    │
         SONNET ●   │   (rapide, économique, excellent en exécution cadrée)
                    │
         HAIKU  ●   │   (ultra rapide/économique, tâches triviales)
                    │
                    └─────────────────────────→ vitesse / économie ↑
```

**Règle d'or** : *payer le raisonnement là où une erreur coûte cher ; payer la vitesse là où
le travail est clair et répétitif.*

---

## 2. Les modèles disponibles (famille Claude 4.x)

| Modèle | Profil | Idéal pour |
|---|---|---|
| **Opus** | Le plus puissant en raisonnement. Plus lent, plus cher. | Architecture, décisions transverses, revue critique, problèmes complexes |
| **Sonnet** | Très bon en code, rapide, ~5× moins cher qu'Opus. | Implémentation de modules bien définis, itérations fréquentes |
| **Haiku** | Le plus rapide et économique, raisonnement plus limité. | Tâches simples, classification, reformatage (non utilisé dans ce projet) |

> Si on ne précise pas de modèle pour un agent, il **hérite** du modèle de la session en cours.
> J'ai préféré être **explicite** pour garder le contrôle du budget et des performances.

---

## 3. La règle que j'ai appliquée

> **Opus conçoit et juge** (là où l'erreur se propage à tout le projet),
> **Sonnet construit** (là où la cible est nette et bien spécifiée).

Pourquoi ça marche : une fois que l'architecte (Opus) a posé des **contrats clairs**
(les interfaces entre modules, le schéma de base de données, les règles de sécurité),
les autres agents n'ont plus à *décider* — ils ont à *exécuter*. Et l'exécution cadrée,
c'est le point fort de Sonnet, en plus rapide et moins cher.

---

## 4. Le choix, agent par agent

### 🔵 Opus

**electron-architect** — *Pourquoi Opus ?*
Il définit les fondations dont **tous les autres agents dépendent** : le pont de communication
typé entre les parties de l'app (IPC), le schéma de la base de données SQLite, le « verrou »
qui garantit qu'on n'utilise jamais plus d'une connexion, et la sécurité d'Electron.
Une mauvaise décision ici se **propage partout** et coûte très cher à rattraper plus tard.
C'est de l'architecture transverse, multi-contraintes → on veut la plus grande profondeur de
raisonnement.

**qa-reviewer** — *Pourquoi Opus ?*
Son travail est **adversarial** : ne pas vérifier que « ça a l'air bon », mais *chercher ce qui
cloche* — une fuite d'identifiants, une connexion parallèle cachée, une reprise de
téléchargement mal gérée. C'est précisément le type de tâche où la profondeur paie le plus.
Un relecteur trop faible qui **valide un bug** est pire que pas de relecteur du tout.
Le coût d'Opus est justifié par le coût d'un bug qui passe.

### 🟢 Sonnet

**xtream-api-specialist** — *Pourquoi Sonnet ?*
Les endpoints de l'API du fournisseur sont **déjà vérifiés et documentés** dans le plan.
Le « quoi faire » est clair ; il reste à écrire un client propre et typé. Travail cadré →
Sonnet, rapide et économique.

**download-engineer** — *Pourquoi Sonnet ?*
La logique (reprise via `Range`, file séquentielle, progression) est exigeante mais
**bien spécifiée** par les contraintes connues. Sonnet la code très bien.
⚠️ *Nuance* : la reprise de téléchargement est délicate ; si Sonnet patine dessus,
on peut le passer en Opus **temporairement** pour ce point précis.

**mpv-player-integrator** — *Pourquoi Sonnet ?*
Intégrer le lecteur mpv et brancher les contrôles sur le contrat IPC est un travail
technique mais **borné**. Pas besoin de raisonnement transverse → Sonnet.

**frontend-builder** — *Pourquoi Sonnet ?*
L'interface (catalogue, fiches, panneau de téléchargements) demande **beaucoup d'itérations**
visuelles. C'est exactement là où la **vitesse** et le **faible coût** de Sonnet sont les plus
utiles : on peut essayer/ajuster/recommencer sans exploser le budget.

---

## 5. Tableau récapitulatif

| Agent | Modèle | Raison principale |
|---|---|---|
| electron-architect | **Opus** | Décisions transverses ; l'erreur se propage partout |
| qa-reviewer | **Opus** | Revue adversariale ; valider un bug coûte cher |
| xtream-api-specialist | Sonnet | API déjà spécifiée → exécution cadrée |
| download-engineer | Sonnet | Logique exigeante mais bien définie (Opus si blocage) |
| mpv-player-integrator | Sonnet | Intégration technique bornée |
| frontend-builder | Sonnet | Beaucoup d'itérations UI → vitesse + coût |

---

## 6. Ce n'est pas figé

On peut ajuster à tout moment selon la priorité :

- **Minimiser le coût** → passer l'architecte en Sonnet (on perd un peu de finesse sur les
  décisions transverses, mais il s'en sort).
- **Maximiser la fiabilité** → passer le download-engineer en Opus par prudence sur la reprise.
- **Aller plus vite / moins cher encore** → réserver Opus aux seuls moments critiques
  (conception initiale + revue avant un jalon) et tout exécuter en Sonnet entre les deux.

Le bon réflexe : **commencer raisonnable, puis monter en puissance uniquement là où on
constate un vrai besoin.**
