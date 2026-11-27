# Guide Complet d'Utilisation — BouML Next

**BouML Next** est la réécriture moderne de BouML : un moteur métamodèle **UML 2.5 pur en Rust**, une persistance **Git-friendly en YAML multi-fichiers (`.bouml/`)**, une génération/synchronisation **round-trip 8 langages**, un **import universel (Tree-sitter + formats standards)**, une interface **Tauri v2 + XYFlow + ELKjs**, et une **intégration IA & MCP native**.

---

## 1. Prérequis & Compilation

### Prérequis
- **Rust** (1.80+ / `cargo`) pour le Core Engine, les générateurs, les importateurs, l'IA et la CLI.
- **Node.js 22+** et **pnpm** pour l'interface moderne (`apps/desktop`).
- *(Optionnel pour build desktop natif Tauri)* : dépendances WebKitGTK / GTK3 sur Linux, Xcode CLT sur macOS, WebView2 sur Windows.

### Compiler & Tester
```bash
# Compiler et lancer toute la suite de tests Rust (7 crates)
cargo test --workspace

# Compiler la CLI en mode release (binaire ultra-rapide dans target/release/bouml)
cargo build --release --bin bouml

# Lancer l'interface Web/Desktop en développement
cd apps/desktop
pnpm install
pnpm dev
```

---

## 2. Structure d'un Projet `.bouml/` (Git-Friendly)

Contrairement au format historique `format 75` (fichiers numériques opaques + offsets binaires `.bodies`), un projet **BouML Next** est un dossier `.bouml/` composé de fichiers YAML canoniques, triés alphabétiquement et directement lisibles dans une Pull Request Git :

```text
mon-projet.bouml/
├── project.yaml                       # Métadonnées projet, schéma v1, langages activés
├── model/
│   ├── package.yaml                   # Package racine
│   └── billing/
│       ├── package.yaml               # Métadonnées du package billing
│       ├── payment_processor.yaml     # 1 fichier par classifieur (snake_case)
│       ├── payment_strategy.yaml
│       ├── relations.yaml             # Relations sortantes du package
│       └── behaviors/
│           └── checkout.interaction.yaml
└── diagrams/
    └── billing_overview.diagram.yaml  # Références d'éléments + mode AutoElk
```

- **Identifiants ULID** : aucune collision d'ID entre développeurs sur des branches Git parallèles.
- **Écriture différentielle** : seuls les fichiers réellement modifiés sont réécrits sur disque.
- **Corps de méthodes lisibles** : stockés directement en blocs YAML multilignes par langage (`bodies.rust`, `bodies.cpp`, `bodies.python`…), sans aucun offset binaire fragile.

---

## 3. Référence Complète de la CLI (`bouml`)

### 3.1 Créer, Inspecter et Valider un Projet (CI/CD)

```bash
# Initialiser un nouveau projet .bouml/
bouml init ./shop.bouml --name Shop

# Ajouter rapidement des classifieurs (class, interface, enum, datatype, actor, component)
bouml add-class ./shop.bouml --name PaymentStrategy --package billing --kind interface
bouml add-class ./shop.bouml --name PaymentProcessor --package billing --kind class
bouml add-class ./shop.bouml --name Currency --package billing --kind enum

# Afficher les statistiques du modèle
bouml info ./shop.bouml

# Valider la conformité UML 2.5 (références, multiplicités, cycles d'héritage) & SOLID
# Retourne le code de sortie 2 en cas d'erreur (prêt pour GitHub Actions / GitLab CI)
bouml validate ./shop.bouml
bouml validate ./shop.bouml --json

# Exporter le modèle complet en JSON normalisé
bouml export-json ./shop.bouml --out ./model.json
```

### 3.2 Migrer un Ancien Projet BouML v4 (`.prj`)

```bash
# Importe récursivement les packages, classes, attributs, opérations, *.bodies, relations et diagrammes
bouml import-prj legacy/plugouts/empty/empty.prj --out ./empty.bouml
bouml validate ./empty.bouml
```

### 3.3 Génération de Code & Round-Trip Bidirectionnel

Langages supportés : `cpp`, `java`, `python`, `typescript`, `php`, `rust`, `go`, `sql`.

```bash
# Générer du code avec marqueurs de préservation des corps (par défaut)
bouml generate ./shop.bouml --lang rust --out ./generated/rust
bouml generate ./shop.bouml --lang cpp --out ./generated/cpp
bouml generate ./shop.bouml --lang python --out ./generated/python
bouml generate ./shop.bouml --lang sql --out ./generated/sql

# Simulation sans écrire sur disque
bouml generate ./shop.bouml --lang typescript --out ./generated/ts --dry-run
```

**Cycle Round-Trip (`preserved body`) :**
1. BouML encadre chaque corps de méthode généré avec des marqueurs stables indexés par l'ULID de l'opération :
   ```rust
   // Bouml preserved body begin 01J...
   amount > 0.0 && !self.api_key.is_empty()
   // Bouml preserved body end 01J...
   ```
   *(En Python, les marqueurs utilisent `## Bouml preserved body begin <id>`.)*
2. Modifie librement ton code métier entre ces marqueurs dans ton IDE.
3. Lors d'une regénération (`bouml generate`), tes corps modifiés sur disque sont **automatiquement préservés**.
4. Pour synchroniser tes corps édités sur disque vers le modèle `.bouml/` :
   ```bash
   bouml roundtrip-bodies ./shop.bouml --lang rust --src ./generated/rust
   ```

### 3.4 Import Universel & Génération Automatique de Diagrammes

Chaque import peuple le modèle UML 2.5, résout les références internes (`TypeRef::Internal`) et **génère automatiquement des diagrammes `AutoElk`** sans chevauchement :

```bash
# Auto-détection sur un répertoire de code source (Tree-sitter : Rust, Python, TS/JS, Java, C++, Go, PHP)
bouml import ./app.bouml ./src

# Formats textuels & standards (auto-détectés par extension ou forcés via --format)
bouml import ./app.bouml ./architecture.puml          # PlantUML
bouml import ./app.bouml ./domain.mmd                 # Mermaid classDiagram
bouml import ./app.bouml ./schema.sql                 # SQL DDL (tables + Foreign Keys -> Associations)
bouml import ./app.bouml ./openapi.yaml               # OpenAPI 3.x / Swagger / JSON Schema
bouml import ./app.bouml ./legacy-export.xmi          # XMI 2.1 / 2.5
```

---

## 4. Pipeline IA Native (Text-to-UML & Refactoring)

BouML Next supporte nativement **OpenAI**, **Anthropic** et **Ollama (100 % local)** avec validation stricte par JSON Schema (**Structured Outputs**, voir [uml-graph-patch.schema.json](../schemas/uml-graph-patch.schema.json)).

### 4.1 Générer un Modèle depuis un Cahier des Charges (Text-to-UML)

```bash
# Avec Ollama en local (aucune clé API requise)
bouml ai-generate ./app.bouml \
  --provider ollama \
  --model qwen2.5-coder:14b \
  --spec ./cahier_des_charges.md

# Avec OpenAI
export OPENAI_API_KEY="sk-..."
bouml ai-generate ./app.bouml --provider openai --model gpt-4o --spec ./cahier_des_charges.md

# Avec Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
bouml ai-generate ./app.bouml --provider anthropic --model claude-3-5-sonnet-latest --spec ./spec.md
```

### 4.2 Refactoring Conversationnel sur un Modèle Existant

```bash
bouml ai-refactor ./app.bouml \
  --provider openai \
  --model gpt-4o \
  --prompt "Ajoute un pattern Strategy sur PaymentProcessor et crée le diagramme de séquence Checkout"
```

### 4.3 Appliquer un Patch IA JSON Manuellement ou depuis un Pipeline Externe

```bash
# Exporter le schéma JSON strict attendu
bouml ai-schema --out ./schemas/uml-graph-patch.schema.json

# Valider et appliquer un patch JSON de manière atomique
bouml ai-apply ./app.bouml ./mon_patch.json
```

---

## 5. Plug-outs Modernes : JSON-RPC 2.0 & Serveur MCP

Le protocole binaire historique `ToolCom`/`UmlCom` est remplacé par un serveur **JSON-RPC 2.0 + MCP (Model Context Protocol)** sur `stdio`, pilotable depuis n'importe quel langage ou agent IA (Claude Desktop, Cursor, Antigravity, etc.) :

```bash
bouml rpc ./shop.bouml
```

### Méthodes disponibles
- **MCP** : `initialize`, `tools/list`, `tools/call` (`get_model_summary`, `validate_uml`, `preview_code`, `apply_uml_patch`).
- **JSON-RPC 2.0 Plug-outs** : `bouml/get_project`, `bouml/get_stats`, `bouml/validate`, `bouml/execute_command`, `bouml/undo`, `bouml/redo`, `bouml/preview_code`, `bouml/apply_ai_patch`.

Exemple d'appel rapide en ligne de commande :
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"bouml/get_stats","params":{}}' | bouml rpc ./shop.bouml
```

---

## 6. Interface Utilisateur Moderne (`apps/desktop`)

- **Canvas infini 60 FPS** : zoom/pan fluide, minimap, grille magnétique (`Grid`).
- **Auto-Layout ELK (Sugiyama)** : clique sur **Auto-Layout** (ou via `Ctrl+K`) pour réorganiser instantanément boîtes et flèches orthogonales sans chevauchement.
- **Édition inline directe** : **double-clique** sur n'importe quelle boîte UML sur le canvas et tape :
  - `-email: string` → ajoute un attribut privé `email` de type `string`
  - `#total: f64` → ajoute un attribut protégé `total`
  - `+charge(amount: f64): bool` → ajoute une opération publique typée
- **Command Palette (`Ctrl+K` / `Cmd+K`)** : accès clavier instantané à toutes les commandes (ajout d'éléments, auto-layout, changement de langage d'aperçu, thème sombre/clair).
- **Aperçu Code Temps Réel** : panneau droit mettant à jour instantanément le code généré dans les 8 langages avec option de marqueurs `preserved body`.
- **Drag & Drop universel** : glisse-dépose un fichier `.puml`, `.mmd`, `.sql`, OpenAPI ou code source directement sur le canvas.
