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
| **3. Couche réseau (WebSocket)** | ✅ Fait | Protocole d'intentions/états, hub autoritaire, serveur `ws`, parsing sécurisé, tests |
| **4. Boucle de jeu (game loop)** | ✅ Fait | Tick serveur fixe (20/s), régénération PV passive, entités mobiles (monstres), start/stop, tests |
| **5. Interface graphique (navigateur)** | ✅ Fait | Client Vite/TS : login, HUD (PV, équipement, affixes/sorts), zone canvas, déplacement (clic/clavier), debug XP |
| **6. Bestiaire & Portails (Solo Leveling)** | ✅ Fait | Portails (rangs C/B/A/S), monstres, IA de poursuite, combat joueur↔mob, gain d'XP au kill, rendu client, tests |
| **7. Persistance SQL (SQLite)** | ✅ Fait | `SqlitePersistence` (better-sqlite3), schéma relationnel, jointures affixes/sorts, transactions, défaut serveur, tests round-trip |
| **8. Déplacements fluides (prédiction réseau)** | ✅ Fait | MOVE par direction + Δt + séquence, validation autoritaire à la vitesse max, prédiction client 60 FPS, `pendingInputs`, réconciliation/rejeu, tests |
| **9. Matériaux & Infusion (Artisanat)** | ✅ Fait | Loots lâchés par les mobs, ramassage (portée), inventaire joueur, infusion d'arme (50 griffes → affixe, 20 cailloux → sort), persistance, tests |

Les 5 briques de base sont en place : modèles de données, persistance, évolution
d'arme, couche réseau, boucle de simulation **et** client navigateur. Le
prototype jouable de bout en bout est fonctionnel.

## 3. Structure des dossiers

```
.
├── ARCHITECTURE.md          # Ce document
├── package.json             # Config npm + scripts TypeScript
├── tsconfig.json            # Config compilateur (strict, NodeNext)
├── data/                    # Runtime : database.db (SQLite) / JSON, git-ignorés
└── src/
    ├── models/              # Structure des données (Data Models)
    │   ├── ids.ts           # Identifiants typés (branded types) + génération
    │   ├── player.ts        # Player, Position, Equipment
    │   ├── weapon.ts        # Weapon, Affix, GeneratedSpell, RawStats, enums
    │   ├── stats.ts         # Règle d'agrégation des stats d'équipement
    │   ├── evolution.ts     # Weapon Evolution Engine (gainXp, loot, level up)
    │   ├── portals.ts       # Portal, PortalRank (Brique 6)
    │   ├── monsters.ts      # Monster (Brique 6)
    │   ├── materials.ts     # MaterialType, LootDrop (Brique 9)
    │   ├── factory.ts       # Création d'entités avec valeurs par défaut
    │   ├── stats.test.ts    # Tests de la règle d'agrégation
    │   ├── evolution.test.ts# Tests du moteur d'évolution
    │   └── index.ts         # Ré-exports publics
    ├── persistence/         # Système de persistance
    │   ├── repository.ts    # Contrat générique Repository + PersistenceLayer
    │   ├── jsonStore.ts     # Implémentation fichier JSON (écriture atomique)
    │   ├── memoryStore.ts   # Implémentation en mémoire (tests / dev)
    │   ├── sqliteStore.ts   # Implémentation SQLite relationnelle (Brique 7)
    │   ├── sqlite.test.ts   # Tests round-trip SQLite
    │   └── index.ts         # Fabrique de la couche de persistance
    ├── network/             # Couche réseau (Brique 3)
    │   ├── protocol.ts      # ClientMessage / ServerMessage + parsing sécurisé
    │   ├── gameHub.ts       # Hub autoritaire (dispatch des intentions)
    │   ├── server.ts        # Serveur WebSocket (ws) + cycle de vie
    │   ├── *.test.ts        # Tests protocole / hub / intégration WebSocket
    │   └── index.ts         # Ré-exports publics
    ├── server/              # Serveur autoritaire (bootstrap + simulation)
    │   ├── gameloop.ts      # Boucle de tick (IA mobs, dégâts, régénération)
    │   ├── combat.ts        # Logique pure combat & IA (Brique 6)
    │   ├── mobs.ts          # MobManager : portails, spawn, IA, loots (B6/B9)
    │   ├── movement.ts      # Déplacement autoritaire (prédiction, Brique 8)
    │   ├── materials.ts     # Loot & infusion : règles pures (Brique 9)
    │   ├── gameloop.test.ts # Tests de la boucle de jeu
    │   ├── combat.test.ts   # Tests IA de suivi + calcul des dégâts
    │   ├── movement.test.ts # Tests validation de vitesse / anti-triche
    │   ├── materials.test.ts# Tests ramassage + infusion
    │   └── index.ts         # Démarrage persistance + WebSocket + game loop
    └── client/              # Frontend navigateur (Brique 5, build Vite)
        ├── index.html       # Écran d'accueil + structure du HUD/jeu
        ├── style.css        # Thème et mise en page
        ├── protocol.ts      # Miroir client du contrat réseau (wire format)
        ├── movement.ts      # Prédiction client (copie de server/movement)
        ├── main.ts          # Connexion WS, HUD, rendu canvas, prédiction
        └── tsconfig.json    # Config TS du client (lib DOM, bundler)
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

### Le pattern `Repository`

Le serveur ne dépend que de l'interface `Repository<TEntity, TId>` et de la
façade `PersistenceLayer` ([`repository.ts`](src/persistence/repository.ts)),
**jamais** d'une implémentation concrète. Trois implémentations interchangeables
coexistent :

| Implémentation | Fichier | Usage |
| --- | --- | --- |
| **SQLite** (`SqlitePersistence`) | [`sqliteStore.ts`](src/persistence/sqliteStore.ts) | **Défaut serveur** (Brique 7) — relationnel, durable |
| JSON fichier (`JsonFileRepository`) | [`jsonStore.ts`](src/persistence/jsonStore.ts) | Écriture atomique (`tmp` + `rename`), simple |
| Mémoire (`MemoryRepository`) | [`memoryStore.ts`](src/persistence/memoryStore.ts) | Tests & dev, volatile |

Grâce à l'identité des interfaces, le `GameHub` et la `GameLoop` ne voient
aucune différence : `createServer()` utilise désormais
`createSqlitePersistence()` par défaut.

### 7.1 Persistance SQLite (Brique 7)

Driver : **`better-sqlite3`** (synchrone, rapide, binaires précompilés). La base
vit dans `data/database.db` (git-ignorée) ; `initDatabase()` active les
contraintes (`PRAGMA foreign_keys = ON`), le mode WAL, et applique le schéma.

**Schéma relationnel** (clés primaires + étrangères) :

```
weapons(id PK, name, type, level, current_xp, next_level_xp, raw_stats[JSON])
   │
   ├─< weapon_affixes(id PK, weapon_id FK→weapons ON DELETE CASCADE,
   │                  code, label, rarity, power)
   └─< weapon_spells (id PK, weapon_id FK→weapons ON DELETE CASCADE,
                      name, required_type, unlock_level, cost, cooldown_ms)

players(id PK, pseudo, pk, pv_base, pv_actuels, pos_x, pos_y, zone,
        materials[JSON],                  -- inventaire de matériaux (Brique 9)
        slot_principal  FK→weapons ON DELETE SET NULL,
        slot_secondaire FK→weapons ON DELETE SET NULL)
```

**Choix techniques :**
- **Reconstruction de l'objet métier (Brique 1)** : charger une `Weapon` fait
  une jointure logique — la ligne `weapons` plus ses lignes `weapon_affixes` et
  `weapon_spells` — pour rebâtir l'`Affix[]` et le `GeneratedSpell[]`. Un
  `Player` porte les IDs d'armes (`slot_principal/secondaire`) ; les armes
  complètes sont résolues via le `WeaponRepository` (comme le fait déjà la règle
  d'agrégation).
- **`raw_stats` en colonne JSON** : `RawStats` est volontairement extensible
  (`[key: string]: number`) ; le stocker en JSON garantit un round-trip fidèle
  sans figer le schéma à chaque nouvelle stat.
- **Sauvegardes atomiques** : `save(weapon)` s'exécute dans une **transaction
  SQL** (`db.transaction`) — upsert de l'arme (`INSERT … ON CONFLICT DO UPDATE`)
  puis remplacement complet des affixes/sorts (delete + insert) → pas de
  doublon, tout ou rien. `ON DELETE CASCADE` nettoie les enfants quand une arme
  est supprimée.
- **`booléen` `pk`** stocké en `INTEGER` 0/1 ; `position` éclatée en
  `pos_x/pos_y/zone`.

Round-trip validé par [`sqlite.test.ts`](src/persistence/sqlite.test.ts) :
un joueur PK équipé d'une arme à 2 affixes + 1 sort est sauvegardé puis
**rechargé à l'identique** (`deepEqual`), plus tests de non-duplication,
`getAll`/`delete`, et cascade.

### Évolution prévue

`PersistenceLayer.flush()` reste un point d'extension (écriture différée /
batching). Le contrat `Repository` permettrait de passer à PostgreSQL ou un
cache Redis **sans toucher** à la logique de jeu.

## 8. Couche réseau (Brique 3)

Transforme le socle en **serveur autoritaire** : les clients envoient des
*intentions*, le serveur valide, applique sur les modèles (via la persistance)
et **diffuse l'état faisant foi**. Tout transite en **JSON sur WebSocket**.

### 8.1 Architecture

```
WebSocket (ws)  ──raw JSON──▶  parseClientMessage  ──ClientMessage──▶  GameHub
   server.ts                      protocol.ts                          gameHub.ts
        ▲                                                                  │
        └────────────── ServerMessage (JSON) ◀───── send()/broadcast ──────┘
```

- [`protocol.ts`](src/network/protocol.ts) : types `ClientMessage` /
  `ServerMessage` (unions discriminées par `type`) + `parseClientMessage`,
  un parseur **défensif qui ne lève jamais** (retourne un `ParseResult`).
- [`gameHub.ts`](src/network/gameHub.ts) : `GameHub`, cœur autoritaire
  **découplé du transport** (les sessions exposent une simple fonction `send`),
  donc entièrement testable sans socket réelle.
- [`server.ts`](src/network/server.ts) : serveur `ws` sur un **port
  configurable** (env `PORT`, défaut **8080**) ; gère connexion, réception
  (parsing sécurisé, robuste au JSON malformé), déconnexion et erreurs socket.

### 8.2 Intentions — Client → Serveur (`ClientMessage`)

| `type` | Charge utile | Action serveur | Validation |
| --- | --- | --- | --- |
| `CONNECT` | `{ pseudo: string }` | Charge le `Player` par pseudo ou le **crée** (avec une arme de départ équipée), lie la session, renvoie `PLAYER_STATE` + diffuse `WORLD_UPDATE` | `pseudo` non vide |
| `MOVE` | `{ sequenceNumber, dirX, dirY, deltaMs }` | Déplacement fluide : `applyMove` recalcule la position autoritaire (direction normalisée, Δt borné), persiste, renvoie `PLAYER_STATE` + `WORLD_UPDATE` (Brique 8) | vitesse ≤ `PLAYER_SPEED` par construction (triche neutralisée) |
| `GAIN_XP_DEBUG` | `{ amount: number }` | **(debug)** Applique `gainXp` à l'arme du Slot_Principal, persiste, renvoie `PLAYER_STATE` | session connectée + arme équipée ; `amount ≥ 0` |
| `ATTACK_MOB` | `{ mobId: string }` | Attaque un monstre : valide la portée selon l'arme, inflige les dégâts, accorde l'XP **et lâche un loot** si kill, renvoie `PLAYER_STATE` + `WORLD_UPDATE` (Brique 6) | session connectée + arme + mob existant + distance ≤ portée |
| `PICKUP_LOOT` | `{ lootId: string }` | Ramasse un matériau au sol : ajoute à l'inventaire, retire le loot (Brique 9) | session connectée + loot existant + distance ≤ `LOOT_PICKUP_RANGE` |
| `INFUSE_WEAPON` | `{ materialType: string }` | Infuse l'arme principale : consomme les matériaux, applique un jet d'affixe/sort (Brique 9) | session connectée + arme + matériaux suffisants |

### 8.3 États / réponses — Serveur → Client (`ServerMessage`)

| `type` | Charge utile | Quand |
| --- | --- | --- |
| `PLAYER_STATE` | `{ player, stats, weapons, lastProcessedSequence }` | Après CONNECT / MOVE / GAIN_XP_DEBUG / ATTACK_MOB / PICKUP_LOOT / INFUSE_WEAPON (le `player` porte aussi `materials`) |
| `WORLD_UPDATE` | `{ players, portals, monsters, loots }` | Diffusion à tous : joueurs, portails, monstres **et loots au sol** (CONNECT, MOVE, ATTACK_MOB, PICKUP_LOOT, chaque tick d'IA, déconnexion) |
| `ERROR` | `{ code: ErrorCode, message: string }` | Intention invalide / JSON malformé / état incohérent |

**Codes d'erreur** (`ErrorCode`) : `MALFORMED_JSON`, `UNKNOWN_TYPE`,
`INVALID_PAYLOAD`, `NOT_CONNECTED`, `INVALID_MOVE`, `NO_WEAPON_EQUIPPED`,
`MOB_NOT_FOUND`, `OUT_OF_RANGE`, `LOOT_NOT_FOUND`, `NOT_ENOUGH_MATERIALS`,
`UNKNOWN_MATERIAL`.

### 8.4 Tests

- [`protocol.test.ts`](src/network/protocol.test.ts) : parsing sécurisé
  (CONNECT/MOVE/GAIN_XP_DEBUG valides & invalides, JSON malformé, type inconnu).
- [`gameHub.test.ts`](src/network/gameHub.test.ts) : CONNECT crée/recharge un
  joueur, MOVE valide vs aberrant, NOT_CONNECTED, GAIN_XP_DEBUG → level up,
  robustesse au JSON malformé, déconnexion.
- [`server.test.ts`](src/network/server.test.ts) : test **d'intégration**
  bout-en-bout sur un vrai serveur `ws` (port éphémère) + client réel.

## 9. Boucle de jeu / Server Ticks (Brique 4)

Implémentée dans [`gameloop.ts`](src/server/gameloop.ts). Moteur de simulation
temps réel du serveur autoritaire, à **pas de temps fixe**.

### 9.1 Tick rate

| Constante | Valeur | Sens |
| --- | --- | --- |
| `TICK_RATE` | **20** | ticks par seconde |
| `TICK_INTERVAL_MS` | **50 ms** | durée d'un tick (`1000 / TICK_RATE`) |

À chaque tick, le serveur fait avancer l'état du monde. Le pas de temps fixe
garantit une simulation **déterministe et indépendante du débit réseau** —
fondement d'un serveur autoritaire.

### 9.2 Gestion de la boucle

- `start()` arme un `setInterval(tickIntervalMs)` (idempotent ; le timer est
  `unref()` pour ne pas bloquer l'arrêt du process). `stop()` l'annule
  proprement. `isRunning` / `tickCount` exposent l'état.
- `tick(deltaMs?)` est **public** : on peut avancer la simulation manuellement,
  ce qui rend la boucle **déterministe et testable** sans dépendre du timer.
- Un garde-fou **anti-réentrance** saute un tick si le précédent (asynchrone,
  car il lit/écrit la persistance) n'est pas terminé.

### 9.3 Simulation de ce jalon

- **Régénération passive des PV** : pour chaque joueur connecté (fourni par le
  `GameHub` via `WorldParticipants.connectedPlayerIds()`), si
  `pvActuels < pvMax`, on régénère
  `pvMax × regenPerSecond × (deltaMs / 1000)` PV, **borné à `pvMax`**.
  `pvMax` provient des **stats agrégées** (règle de la Brique 1).
  Défaut : `regenPerSecond = 5 %/s` (`DEFAULT_REGEN_PER_SECOND`).
- **Entités mobiles (`MobileEntity` / `Monster`)** : structure minimale
  (`id`, `name`, `pvActuels`, `pvMax`, `position`) gérée via
  `spawnMonster` / `removeMonster` / `getMonsters`. Inertes pour l'instant
  (présence simulée) — socle pour l'IA et le combat (briques suivantes).
- Hook `onTick(info)` pour brancher une future diffusion d'état périodique.

Le bootstrap ([`server/index.ts`](src/server/index.ts)) démarre la boucle après
le serveur WebSocket, en lui passant le `GameHub` comme source de participants.

Couvert par [`gameloop.test.ts`](src/server/gameloop.test.ts) : tick rate,
régénération après plusieurs ticks, saturation à `pvMax`, aucun gain au max,
écoulement réel du temps via `start`/`stop`, idempotence, exposition du
bestiaire via la boucle.

## 10. Bestiaire & Portails — Solo Leveling System (Brique 6)

Système de portails, de monstres et de combat. Le `MobManager`
([`mobs.ts`](src/server/mobs.ts)) détient l'état volatile du monde (portails +
monstres) et est **partagé** entre le `GameHub` (attaques, diffusion) et la
`GameLoop` (IA). La logique fine est isolée dans des fonctions pures
([`combat.ts`](src/server/combat.ts)).

### 10.1 Modèles

`Portal` ([`portals.ts`](src/models/portals.ts)) : `{ id, rank, position, open }`
avec `PortalRank ∈ { C, B, A, S }`.

`Monster` ([`monsters.ts`](src/models/monsters.ts)) :
`{ id, portalId, rank, pvMax, pvActuels, position{x,y}, force, xpDonnee, cible }`.

### 10.2 Apparition des portails

Probabilités de rang (table `PORTAL_RANK_TABLE`) :

| Rang | Probabilité | PV mob | Force mob | XP donnée |
| --- | --- | --- | --- | --- |
| C | 60 % | 30 | 3 | 25 |
| B | 25 % | 60 | 6 | 60 |
| A | 12 % | 120 | 12 | 150 |
| S | 3 % | 250 | 25 | 400 |

Chaque portail fait apparaître **3 monstres** (`MONSTERS_PER_PORTAL`) répartis
autour de lui. En production, le bootstrap ouvre un portail au démarrage puis
en ajoute régulièrement (max 5).

### 10.3 IA (à chaque tick de 50 ms)

Dans `MobManager.tick(deltaMs, players)` :
- chaque monstre cherche le **joueur le plus proche** dans un rayon de
  `DETECTION_RADIUS` = 5 cases (`findNearestPlayer`) et le mémorise (`cible`) ;
- s'il est à `ATTACK_RANGE` = 1 case, il **attaque** (cooldown
  `MONSTER_ATTACK_COOLDOWN_MS` = 1000 ms) et inflige sa `force` en PV ;
- sinon il **se rapproche** de `MONSTER_SPEED` = 0.5 case (`stepToward`).

Les dégâts subis sont appliqués par la `GameLoop` (réduction de `pvActuels`,
puis régénération des survivants).

### 10.4 Combat joueur → monstre (`ATTACK_MOB`)

Validé côté serveur dans le `GameHub` :
- **Portée** selon l'arme principale (`weaponRange`) : Épée/Bouclier = 1,
  Arc/Bâton = 5 cases. Hors de portée → `OUT_OF_RANGE`.
- **Dégâts** (`computePlayerDamage`) = `ATTACK_BASE_DAMAGE` (5) + stat agrégée :
  **Force** pour les armes de mêlée, **Agilité** pour les armes à distance.
- Si le monstre meurt, l'arme principale gagne `mob.xpDonnee` via `gainXp`
  (Brique 2) — elle peut monter de niveau en plein combat.

### 10.5 Rendu client

Le canvas dessine les **portails** (cercles colorés : C vert, B bleu, A violet,
S rouge) et les **monstres** (carrés rouges + barre de PV). Cliquer sur un
monstre proche envoie `ATTACK_MOB` (le serveur valide la portée).

### 10.6 Tests

[`combat.test.ts`](src/server/combat.test.ts) : portée d'arme, calcul des
dégâts (Force/Agilité), `stepToward`, `findNearestPlayer`, seuils de rang,
apparition portail+3 mobs, **IA de poursuite**, attaque + cooldown, mort du mob.

## 11. Client navigateur (Brique 5)

Frontend **Vite + TypeScript** dans [`src/client/`](src/client/). Aucun
framework : DOM + Canvas 2D, pour rester lisible et léger.

### 11.1 Connexion & contrat partagé

- Le client ouvre une WebSocket vers `ws://<host>:8080` et envoie l'intention
  `CONNECT { pseudo }` dès l'ouverture.
- [`client/protocol.ts`](src/client/protocol.ts) est un **miroir autonome** du
  contrat réseau (formes JSON échangées). Il évite de compiler le code serveur
  (Node) dans le bundle navigateur. *Toute évolution du protocole doit être
  répercutée des deux côtés* (un futur paquet partagé pourra fusionner les
  deux).
- Le `PLAYER_STATE` a été enrichi d'un champ `weapons` (armes équipées
  résolues) afin que le HUD affiche nom/niveau/XP/affixes/sorts par slot.

### 11.2 Interface

- **Écran d'accueil** : champ pseudo + bouton « Rejoindre le Multivers ».
- **HUD** : pseudo, statut **PK/Pacifiste**, barre de **PV actuels / PV max**,
  détail des **Slot Principal / Secondaire** (nom, niveau, barre d'XP, affixes
  et sorts). Les affixes/sorts du slot **secondaire** sont affichés *grisés*
  (inactifs) — visualisation directe de la règle d'agrégation de la Brique 1.
- **Stats agrégées** (Force, Agilité, Bonus PV, PV max).

### 11.3 Zone de jeu & commandes

- **Canvas 2D** : grille du biome, joueur (carré liseré) à sa position `(x, y)`,
  autres joueurs en gris, **portails** (cercles colorés par rang) et **monstres**
  (carrés rouges + barre de PV) via `WORLD_UPDATE`.
- **Combat** : cliquer sur un monstre proche envoie `ATTACK_MOB` (le serveur
  valide la portée selon l'arme principale).
- **Déplacement fluide** : flèches / ZQSD / WASD → boucle 60 FPS avec
  **prédiction locale** + réconciliation (cf. §12). L'autorité reste serveur.
- **Bouton debug « Gagner de l'XP »** : envoie `GAIN_XP_DEBUG` et l'on voit
  l'arme évoluer en direct (niveau, XP, nouveaux affixes/sorts).

### 11.4 Lancer le client

```bash
npm start          # serveur autoritaire (WebSocket :8080 + game loop)
npm run dev:client # client Vite en dev (http://localhost:5173)
```

Build de production : `npm run build:client` (sortie dans `dist/client/`).
Validé bout-en-bout via un test navigateur headless (Chromium) : connexion →
HUD rempli → `GAIN_XP_DEBUG` → montée de l'arme au niveau 2 rendue à l'écran.

## 12. Déplacements fluides — Prédiction & Réconciliation (Brique 8)

Élimine le déplacement « case par case » au profit d'un mouvement fluide basé
sur le temps, tout en restant **autoritaire serveur**. La même logique pure est
appliquée des deux côtés : [`server/movement.ts`](src/server/movement.ts) et sa
copie identique [`client/movement.ts`](src/client/movement.ts).

### 12.1 Modèle de déplacement

Un input de MOVE porte `{ sequenceNumber, dirX, dirY, deltaMs }`. La position
résultante est :

```
applyMove(pos, input) :
  Δt   = clamp(deltaMs, 0..MAX_INPUT_DELTA_MS) / 1000   # borne anti-téléport
  dir  = normalize(dirX, dirY)                          # borne anti-vitesse
  pos' = clampToWorld(pos + dir × PLAYER_SPEED × Δt)
```

Constantes : `PLAYER_SPEED = 120` cases/s, `MAX_INPUT_DELTA_MS = 250`,
`WORLD_SIZE = 500`. **La règle d'or** : `MaxDistance = PLAYER_SPEED × Δt`.
Comme le serveur **normalise la direction** et **borne le Δt**, un client ne
peut jamais dépasser cette vitesse, quel que soit le vecteur ou le Δt envoyé →
téléportation et speed-hack neutralisés *par construction*. La fonction
`isMoveWithinLimit(from, to, Δt)` exprime la même règle sous forme de prédicat
(utile pour valider un déplacement déjà calculé).

### 12.2 Client prédictif (60 FPS)

À chaque frame (`requestAnimationFrame`) :
1. lecture des touches tenues → vecteur de direction ;
2. si mouvement : création d'un input (`++sequenceNumber`, `deltaMs` = durée de
   la frame), **prédiction locale immédiate** via `applyMove` (le carré bouge
   sans attendre le serveur), ajout à `pendingInputs`, envoi du `MOVE` ;
3. rendu du joueur à la position **prédite**.

### 12.3 Réconciliation

À réception d'un `PLAYER_STATE` (`{ player.position, lastProcessedSequence }`) :
1. on écarte de `pendingInputs` tous les inputs `≤ lastProcessedSequence`
   (confirmés) ;
2. on repart de la position **autoritaire** du serveur et l'on **rejoue** les
   inputs encore en attente (`applyMove` successifs) → position réconciliée ;
3. si l'écart avec la prédiction courante dépasse un seuil (serveur ayant
   corrigé la trajectoire), on applique le **correctif** (snap). Sinon le rendu
   reste fluide.

Comme client et serveur exécutent exactement le même `applyMove`, en régime
normal le rejeu reproduit la prédiction (drift ≈ 0) : aucun à-coup visible.

### 12.4 Tests

[`movement.test.ts`](src/server/movement.test.ts) : `maxDistanceFor`, input
conforme, normalisation diagonale, **rejet de la triche** par vecteur géant et
par Δt géant, direction nulle, bornage monde, et le prédicat
`isMoveWithinLimit` (accepte conforme, rejette téléport/excès). Côté hub,
[`gameHub.test.ts`](src/network/gameHub.test.ts) vérifie le renvoi de
`lastProcessedSequence` et le bornage d'un MOVE triché.

## 13. Artisanat & Catalyseurs — Matériaux & Infusion (Brique 9)

Boucle de jeu « tuer → récolter → infuser » : les monstres lâchent des
matériaux, le joueur les ramasse dans son inventaire, puis les consomme pour
**infuser** son arme (jets d'affixes/sorts de la Brique 2).

### 13.1 Modèles

- `MaterialType` ([`materials.ts`](src/models/materials.ts)) :
  `GRIFFE_CHAUVE_SOURIS`, `CAILLOU_BRILLANT`.
- `LootDrop` : `{ id, materialType, amount, position }` — matériau au sol.
- `Player.materials: Record<string, number>` — inventaire (persisté en JSON).

### 13.2 Drop & ramassage

- À la **mort d'un monstre** (`ATTACK_MOB` → kill), le `MobManager`
  (`dropLoot`) crée un `LootDrop` à sa position : type 50/50, quantité aléatoire
  **1 à 5** (`rollLootAmount` / `rollLootMaterial`). Les loots actifs sont
  diffusés dans `WORLD_UPDATE`.
- `PICKUP_LOOT { lootId }` : le serveur valide la **portée mêlée**
  (`LOOT_PICKUP_RANGE = 2` cases, `isWithinPickupRange`), ajoute le matériau à
  l'inventaire (`addMaterials`), retire le loot du sol et persiste.

### 13.3 Infusion (recettes)

`INFUSE_WEAPON { materialType }` consomme des matériaux et applique un jet sur
l'arme du Slot_Principal (`INFUSION_RECIPES`) :

| Matériau | Coût | Effet |
| --- | --- | --- |
| `GRIFFE_CHAUVE_SOURIS` | **50** | un **affixe** aléatoire (`rollAffix`) |
| `CAILLOU_BRILLANT` | **20** | un **sort** aléatoire (`rollSpell`) |

`infuseWeapon` ([`server/materials.ts`](src/server/materials.ts)) échoue **sans
rien consommer** si les ressources sont insuffisantes (`NOT_ENOUGH_MATERIALS`).
Les jets réutilisent le catalogue par type d'arme de la Brique 2 (`rollAffix` /
`rollSpell` exportés depuis `evolution.ts`).

### 13.4 Client

Le canvas dessine les loots (petits losanges colorés : griffe doré, caillou
cyan, avec la quantité). Un clic ramasse le loot proche (après priorité au
combat). Le HUD affiche l'**inventaire** et deux boutons
« Infuser (50 Griffes) » / « Infuser (20 Cailloux) » (désactivés tant que le
coût n'est pas atteint) qui émettent `INFUSE_WEAPON`.

### 13.5 Tests

[`materials.test.ts`](src/server/materials.test.ts) : tirage du loot, portée de
ramassage, incrément d'inventaire, gestion du `MobManager` (drop/get/remove),
et infusion (consommation correcte, ajout d'affixe/sort, **échec si ressources
insuffisantes**). Côté hub, [`gameHub.test.ts`](src/network/gameHub.test.ts)
couvre les chemins `PICKUP_LOOT` (à portée / hors portée) et `INFUSE_WEAPON`
(succès / matériaux insuffisants).

## 14. Conventions techniques

- **TypeScript strict** (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) — voir [`tsconfig.json`](tsconfig.json).
- **ESM / NodeNext** : imports avec extension `.js` (résolution Node native).
- **Branded types** pour les identifiants : empêche de confondre un `PlayerId`
  avec un `WeaponId` à la compilation, tout en restant une `string`
  sérialisable au runtime.
- Les **fabriques** (`createPlayer`, `createWeapon`) centralisent les valeurs
  par défaut pour garantir des entités cohérentes.

## 15. Scripts npm

| Script | Action |
| --- | --- |
| `npm run build` | Compile le serveur `src/` → `dist/` |
| `npm run dev` | Compilation serveur en watch |
| `npm run typecheck` | Vérification de types serveur (sans émission) |
| `npm run typecheck:client` | Vérification de types client (lib DOM) |
| `npm test` | Tests (`node --test` via `tsx`) |
| `npm start` | Lance le serveur compilé (WebSocket :8080 + game loop) |
| `npm run dev:client` | Client Vite en dev (http://localhost:5173) |
| `npm run build:client` | Build de production du client → `dist/client/` |
| `npm run preview:client` | Sert le build client (Vite preview) |
