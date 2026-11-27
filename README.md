# BouML v2 — Studio UML 2.5, PlantUML & Génération Multi-Langages

**BouML v2** modernise l'intégralité du patrimoine fonctionnel de BouML (métamodèle UML 2.5 complet, génération de code multi-langages haute précision, préservation des corps de méthodes en round-trip, profils/stéréotypes, export HTML & XMI 2.1) dans une application Desktop native cross-platform (**Tauri v2 + React/TypeScript + Rust**), propulsée par **PlantUML** en colonne vertébrale bidirectionnelle, **ELK** pour l'auto-layout 60 FPS et **Google AI Studio (`gemini-4-hydrogen`)**.

## Fonctionnalités Clés
- **9 types de diagrammes UML 2.5** : Classes, Cas d'utilisation, Séquence, Communication, Composants, Déploiement, Activités, États, Objets.
- **UX Guidée 60 FPS (Zéro Syntaxe Obligatoire)** :
  - Canvas infini React Flow + Auto-Layout **ELK** en 1 clic.
  - **Menus contextuels intelligents (clic droit)** sur les classes, liens, explorateur et canvas (le menu natif WebView est désactivé).
  - Inspecteur latéral visuel (types, modificateurs, cardinalités visuelles `1`, `0..1`, `0..*`, `1..*`, stéréotypes DDD/REST/C++).
  - Aperçu Code en temps réel (Split View) + onglet PlantUML bidirectionnel synchronisé.
- **Génération de Code & Round-Trip Multi-Langages** :
  - **C++ (`.h`/`.cpp`), Java, Python, TypeScript, PHP, SQL (DDL), Rust, Go, CORBA IDL** + Générateur Machine à États.
  - Préservation stricte des corps de méthodes compatible avec les marqueurs historiques BouML (`// Bouml preserved body begin/end` & `## Bouml preserved body begin/end`).
- **Import Universel par Glisser-Déposer** : Code source, `.puml`, `.mmd`, `.sql`, `.xmi`, OpenAPI `.yaml`/`.json`.
- **IA Native Google AI Studio (`gemini-4-hydrogen`)** :
  - Stockage sécurisé de la clé API dans le trousseau système (OS Keyring) + test de connexion 1 clic.
  - Générateur **Cahier des Charges (`.md`/`.txt`/`.pdf`/texte) → Diagrammes UML** via Structured Outputs.
  - Copilote contextuel dans le menu clic droit (corps de méthodes, audit SOLID, tests unitaires).

## Développement Local
```bash
npm install
npm run test
npm run build
npm run tauri dev
```

## Releases Multi-OS (GitHub Actions)
Le workflow `.github/workflows/release.yml` compile et publie automatiquement sur push de tag `v*` ou via `workflow_dispatch` :
- **Windows** : `.msi` / `.exe`
- **macOS** : `.dmg` Universal (Apple Silicon + Intel)
- **Linux** : `.AppImage` / `.deb`
