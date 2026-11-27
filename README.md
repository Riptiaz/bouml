# BouML Next

Modernization and clean-slate modular rewrite of **BouML** — preserving its core DNA (**blazing speed, low memory footprint, and high-precision bidirectional UML ↔ code round-trip**) with a pure **Rust UML 2.5 Core Engine**, **Git-friendly canonical multi-file YAML persistence (`.bouml/`)**, **Tree-sitter universal imports**, **Tauri v2 + React/XYFlow + ELKjs** UI, and **native AI architecture workflows**.

The historical BouML v4 (C++/Qt 3) source code is preserved under [`legacy/`](legacy/).

## Workspace Structure (Phase 1)

- `crates/bouml-core`: Pure UML 2.5 metamodel (`Package`, `Classifier`, `Property`, `Operation`, `Relation`, `Interaction`, `StateMachine`, `Activity`, decoupled `Diagram`), transactional `CommandHistory` (atomic `Batch` + Undo/Redo), and UML 2.5 / SOLID validator.
- `crates/bouml-persistence`: Canonical multi-file `.bouml/` YAML store (1 file per package/classifier, deterministic sorting, zero merge-conflict counters or byte offsets) + historical BouML v4 (`.prj` / `format 75`) importer.
- `crates/bouml-cli`: Headless `bouml` CLI for CI/CD and model management.

## Quick Start

```bash
# Run the full test suite
cargo test --workspace

# Initialize a new .bouml/ project
cargo run --bin bouml -- init ./demo.bouml --name Demo

# Migrate a historical BouML v4 .prj project
cargo run --bin bouml -- import-prj legacy/plugouts/empty/empty.prj --out ./empty.bouml

# Inspect & validate a project (CI/CD ready, non-zero exit on errors)
cargo run --bin bouml -- info ./empty.bouml
cargo run --bin bouml -- validate ./empty.bouml
```
