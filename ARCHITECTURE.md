# Architecture — Micro-MMORPG persistant

Document vivant décrivant les choix techniques et l'évolution du projet.

## 1. Vision

Micro-MMORPG **persistant** jouable dans le navigateur, reposant sur :

- **Node.js + TypeScript** côté serveur ;
- **WebSockets** pour la communication temps réel ;
- une architecture **modulaire** et un **serveur autoritaire**.

> **Serveur autoritaire** : toute la logique de jeu et l'état du monde vivent et
> sont validés côté serveur. Le client n'émet que des *intentions*
> (« je veux me déplacer », « je veux attaquer »). Le serveur applique ou
> rejette, puis diffuse l'état faisant foi. Cela empêche la triche côté client.

## 2. État d'avancement

| Brique | Statut | Contenu |
| --- | --- | --- |
| **1. Modèles de données + persistance** | ✅ Fait | Modèles `Player` / `Weapon`, règle d'agrégation, persistance JSON, tests |
| **2. Loot & évolution d'arme** | ✅ Fait | `gainXp`, level up, croissance de stats par Type, génération d'affixes/sorts pondérée par rareté, tests |
| 3. Couche réseau (WebSocket) | ⏳ À venir | Connexions, protocole d'intentions, diffusion d'état |
| 4. Boucle de jeu (game loop) | ⏳ À venir | Tick serveur, résolution combat, mouvements |
| 5. Interface graphique (navigateur) | ⏳ À venir | Rendu client, prédiction/réconciliation |

Les briques 1 et 2 couvrent les modèles de données, la persistance et le moteur
d'évolution d'arme. Aucune interface graphique n'est encore fournie.

## 3. Structure des dossiers

```
.
├── ARCHITECTURE.md          # Ce document
├── package.json             # Config npm + scripts TypeScript
├── tsconfig.json            # Config compilateur (strict, NodeNext)
├── data/                    # Sauvegardes runtime (JSON, git-ignorées)
└── src/
    ├── models/              # Structure des données (Data Models)
    │   ├── ids.ts           # Identifiants typés (branded types) + génération
    │   ├── player.ts        # Player, Position, Equipment
    │   ├── weapon.ts        # Weapon, Affix, GeneratedSpell, RawStats, enums
    │   ├── stats.ts         # Règle d'agrégation des stats d'équipement
    │   ├── evolution.ts     # Weapon Evolution Engine (gainXp, loot, level up)
    │   ├── factory.ts       # Création d'entités avec valeurs par défaut
    │   ├── stats.test.ts    # Tests de la règle d'agrégation
    │   ├── evolution.test.ts# Tests du moteur d'évolution
    │   └── index.ts         # Ré-exports publics
    ├── persistence/         # Système de persistance
    │   ├── repository.ts    # Contrat générique Repository + PersistenceLayer
    │   ├── jsonStore.ts     # Implémentation fichier JSON (écriture atomique)
    │   └── index.ts         # Fabrique de la couche de persistance
    └── server/              # Serveur autoritaire (socle)
        └── index.ts         # Bootstrap + résolution des stats joueur
```

## 4. Modèles de données

### 4.1 Joueur (`Player`)

| Champ | Type | Note |
| --- | --- | --- |
| `id` | `PlayerId` | Identifiant unique (branded string) |
| `pseudo` | `string` | Nom affiché |
| `pk` | `boolean` | Statut Player-Killer (PvP) |
| `pvBase` | `number` | Socle de PV |
| `pvActuels` | `number` | PV courants (état runtime) |
| `position` | `Position` | `{ x, y, zone }` |
| `equipment` | `Equipment` | `{ slotPrincipal, slotSecondaire }` (IDs d'armes) |

### 4.2 Arme (`Weapon`)

| Champ | Type | Note |
| --- | --- | --- |
| `id` | `WeaponId` | Identifiant unique |
| `name` | `string` | Nom |
| `type` | `WeaponType` | `EPEE` \| `ARC` \| `BATON` \| `BOUCLIER` |
| `progression` | `WeaponProgression` | `{ level, currentXp, nextLevelXp }` |
| `rawStats` | `RawStats` | `{ force, agilite, pvBonus, ... }` |
| `affixes` | `Affix[]` | Effets passifs aléatoires (avec rareté/puissance) |
| `generatedSpells` | `GeneratedSpell[]` | Sorts actifs dépendant du `type` |

## 5. Règle d'agrégation (cœur métier)

Implémentée dans [`src/models/stats.ts`](src/models/stats.ts) via
`computeAggregatedStats` :

- **Statistiques brutes** : celles de l'arme du **Slot_Principal** *et* du
  **Slot_Secondaire** se **cumulent** sur le joueur.
- **Affixes** : actifs **uniquement** si l'arme est dans le **Slot_Principal**.
- **Sorts générés** : utilisables **uniquement** si l'arme est dans le
  **Slot_Principal**, *et* si le sort est débloqué par le niveau de l'arme
  (`unlockLevel`) *et* correspond au type de l'arme (`requiredType`).
- `pvMax = pvBase + pvBonus cumulé`.

Cette règle est couverte par des tests unitaires
([`stats.test.ts`](src/models/stats.test.ts)).

## 6. Weapon Evolution Engine (Brique 2)

Implémenté dans [`src/models/evolution.ts`](src/models/evolution.ts). Point
d'entrée : `gainXp(weapon, amount, rng?)`.

> **Déterminisme & testabilité** : toute l'aléatoire passe par une fonction
> `rng: () => number` injectable (par défaut `Math.random`). Les tests
> fournissent un RNG séquentiel pour piloter exactement chaque tirage.

### 6.1 Gain d'XP & montée de niveau

`gainXp` ajoute l'XP au `currentXp` de l'arme puis, **tant que**
`currentXp >= nextLevelXp`, déclenche une montée de niveau (gestion des
niveaux multiples en un seul appel). L'arme passée est **mutée** (le serveur
autoritaire persiste ensuite l'entité).

**Courbe d'XP** — XP requise pour passer de `level` à `level + 1` :

```
xpForLevel(level) = floor(100 × 1.5^(level - 1))
```

| Niveau | XP pour le niveau suivant |
| --- | --- |
| 1 → 2 | 100 |
| 2 → 3 | 150 |
| 3 → 4 | 225 |
| 4 → 5 | 337 |

`xpForLevel(1) = 100` correspond au `nextLevelXp` par défaut des armes créées
en Brique 1 (cf. `factory.ts`).

### 6.2 Croissance des statistiques brutes (par Type)

À **chaque niveau gagné**, les stats brutes croissent selon le `WeaponType`
(table `STAT_GROWTH`) :

| Type | Force | Agilité | PV_Bonus | Identité |
| --- | --- | --- | --- | --- |
| `EPEE` | +3 | — | +1 | Dégâts physiques de mêlée |
| `ARC` | +1 | +3 | — | Dégâts à distance / vitesse |
| `BATON` | — | +1 | +5 | Soutien / magie |
| `BOUCLIER` | — | — | +8 | Tank |

### 6.3 Jet de rareté de la récompense

À chaque niveau, un jet (`rollRarity`) détermine la rareté de la récompense
selon la table `RARITY_TABLE` :

| Rareté | Probabilité | Intervalle cumulé |
| --- | --- | --- |
| Commun | 60 % | `[0.00, 0.60)` |
| Rare | 25 % | `[0.60, 0.85)` |
| Épique | 12 % | `[0.85, 0.97)` |
| Légendaire | 3 % | `[0.97, 1.00)` |

> La rareté `Magique` de l'énum de la Brique 1 **n'est pas tirée** par ce
> générateur ; elle est réservée à de futurs systèmes de loot (drops de
> monstres, marchands…).

La rareté détermine la puissance d'un affixe via `RARITY_POWER` :

| Rareté | Puissance (`power`) |
| --- | --- |
| Commun | 5 |
| Rare | 12 |
| Épique | 25 |
| Légendaire | 50 |

### 6.4 Affixe passif **ou** sort actif

Selon le `WeaponType`, la récompense est tirée d'un **catalogue** dédié
(`WEAPON_CATALOG`). Chaque Type a une probabilité `spellChance` d'octroyer un
**Sort actif** plutôt qu'un **Affixe passif** :

| Type | `spellChance` | Affixes possibles | Sorts possibles |
| --- | --- | --- | --- |
| `EPEE` | 40 % | +% Critique, Pénétration d'armure, Vol de vie | Coup tranchant, Frappe tournoyante |
| `ARC` | 50 % | +% Critique, Vitesse d'attaque, Perforation | Flèche de Feu, Pluie de flèches |
| `BATON` | 60 % | Puissance des sorts, Régén. mana, -Cooldown | Boule de feu, Éclair |
| `BOUCLIER` | 50 % | +% Blocage, Épines, Régén. de PV | Coup de Bouclier, Provocation |

L'élément généré respecte les structures de la Brique 1 :
- un **Affixe** (`Affix`) est ajouté à `weapon.affixes` (`{ id, code, label,
  rarity, power }`) ;
- un **Sort** (`GeneratedSpell`) est ajouté à `weapon.generatedSpells` avec
  `requiredType = weapon.type` et `unlockLevel = niveau atteint` (donc
  immédiatement débloqué).

**Ordre des tirages `rng` par niveau** (déterminisme) :
`1.` rareté → `2.` affixe vs sort (vs `spellChance`) → `3.` index dans le pool.

### 6.5 Résultat (`EvolutionResult`)

`gainXp` renvoie : `{ weapon, leveledUp, levelsGained, newLevel, rewards[] }`,
où chaque `EvolutionReward` est soit `{ kind: "affix", level, rarity, affix }`,
soit `{ kind: "spell", level, rarity, spell }`.

Couvert par [`evolution.test.ts`](src/models/evolution.test.ts) : montée de
niveau, attribution d'affixe, génération de sort, niveaux multiples, seuils de
la table de rareté, montant négatif rejeté.

## 7. Persistance

### Choix : stockage JSON fichier, abstrait derrière un `Repository`

- Le serveur ne dépend que de l'interface `Repository<TEntity, TId>` et de la
  façade `PersistenceLayer` ([`repository.ts`](src/persistence/repository.ts)),
  **jamais** d'une implémentation concrète.
- `JsonFileRepository` ([`jsonStore.ts`](src/persistence/jsonStore.ts)) charge
  la collection en mémoire au premier accès (jeu « micro » → tient en RAM,
  lectures instantanées) et écrit de manière **atomique**
  (`write tmp` + `rename`) pour éviter la corruption en cas d'arrêt brutal.
- Les fichiers de données vivent dans `data/` et sont **git-ignorés**.

### Évolution prévue

L'abstraction `Repository` permet de remplacer le stockage JSON par un SGBD
(SQLite, PostgreSQL) ou un cache (Redis) **sans toucher** à la logique de jeu.
Le point `PersistenceLayer.flush()` est réservé à une future stratégie
d'écriture différée (batching) pour absorber un volume d'écritures élevé.

## 8. Conventions techniques

- **TypeScript strict** (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) — voir [`tsconfig.json`](tsconfig.json).
- **ESM / NodeNext** : imports avec extension `.js` (résolution Node native).
- **Branded types** pour les identifiants : empêche de confondre un `PlayerId`
  avec un `WeaponId` à la compilation, tout en restant une `string`
  sérialisable au runtime.
- Les **fabriques** (`createPlayer`, `createWeapon`) centralisent les valeurs
  par défaut pour garantir des entités cohérentes.

## 9. Scripts npm

| Script | Action |
| --- | --- |
| `npm run build` | Compile `src/` → `dist/` |
| `npm run dev` | Compilation en watch |
| `npm run typecheck` | Vérification de types sans émission |
| `npm test` | Tests (`node --test` via `tsx`) |
| `npm start` | Lance le serveur compilé |
