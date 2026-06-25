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
| 2. Couche réseau (WebSocket) | ⏳ À venir | Connexions, protocole d'intentions, diffusion d'état |
| 3. Boucle de jeu (game loop) | ⏳ À venir | Tick serveur, résolution combat, mouvements |
| 4. Génération d'affixes/sorts | ⏳ À venir | Aléatoire pondéré par rareté, sorts selon type d'arme |
| 5. Interface graphique (navigateur) | ⏳ À venir | Rendu client, prédiction/réconciliation |

Cette première livraison se concentre **uniquement** sur les modèles de données
et la persistance de base. Aucune interface graphique n'est fournie.

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
    │   ├── factory.ts       # Création d'entités avec valeurs par défaut
    │   ├── stats.test.ts    # Tests de la règle d'agrégation
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

## 6. Persistance

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

## 7. Conventions techniques

- **TypeScript strict** (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) — voir [`tsconfig.json`](tsconfig.json).
- **ESM / NodeNext** : imports avec extension `.js` (résolution Node native).
- **Branded types** pour les identifiants : empêche de confondre un `PlayerId`
  avec un `WeaponId` à la compilation, tout en restant une `string`
  sérialisable au runtime.
- Les **fabriques** (`createPlayer`, `createWeapon`) centralisent les valeurs
  par défaut pour garantir des entités cohérentes.

## 8. Scripts npm

| Script | Action |
| --- | --- |
| `npm run build` | Compile `src/` → `dist/` |
| `npm run dev` | Compilation en watch |
| `npm run typecheck` | Vérification de types sans émission |
| `npm test` | Tests (`node --test` via `tsx`) |
| `npm start` | Lance le serveur compilé |
