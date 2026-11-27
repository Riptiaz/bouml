# BouML Next

Modernization and clean-slate modular rewrite of **BouML** — preserving its core DNA (**blazing speed, low memory footprint, and high-precision bidirectional UML ↔ code round-trip**) with a pure **Rust UML 2.5 Core Engine**, **Git-friendly canonical multi-file YAML persistence (`.bouml/`)**, **Tree-sitter universal imports**, **Tauri v2 + React/XYFlow + ELKjs** UI, and **native AI & MCP workflows**.

The historical BouML v4 (C++/Qt 3) source code is preserved under [`legacy/`](legacy/).

## Workspace Architecture (Phases 1–5 Complete)

- `crates/bouml-core`: Pure UML 2.5 metamodel (`Package`, `Classifier`, `Property`, `Operation`, `Relation`, `Interaction`, `StateMachine`, `Activity`, decoupled `Diagram`), transactional `CommandHistory` (atomic `Batch` + Undo/Redo), and UML 2.5 / SOLID validator.
- `crates/bouml-persistence`: Canonical multi-file `.bouml/` YAML store (1 file per package/classifier, deterministic sorting, zero merge-conflict counters or byte offsets) + historical BouML v4 (`.prj` / `format 75`) importer.
- `crates/bouml-codegen`: BouML macro/template engine, 8 language generators (**C++20, Java, Python 3, TypeScript, PHP 8, Rust, Go, SQL DDL**), differential disk writes (`must_be_saved`), live preview, and preserved-body bidirectional round-trip.
- `crates/bouml-importers`: Universal importer with **Tree-sitter** AST reverse-engineering (7 languages), **PlantUML**, **Mermaid**, **SQL DDL**, **OpenAPI 3.x / JSON Schema**, **XMI 2.1/2.5**, and automatic `AutoElk` diagram generation.
- `crates/bouml-ai`: Native AI pipeline supporting **OpenAI**, **Anthropic**, and local **Ollama** with strict JSON Schema Structured Outputs (`schemas/uml-graph-patch.schema.json`), Text-to-UML with self-repair validation, and atomic conversational refactoring.
- `crates/bouml-rpc`: Language-agnostic **JSON-RPC 2.0** plug-out protocol & native **MCP (Model Context Protocol)** stdio server.
- `crates/bouml-cli`: Headless `bouml` CLI for CI/CD, migration, codegen, reverse-engineering, AI, and MCP.
- `apps/desktop`: **Tauri v2 + React 19 + TypeScript + XYFlow + ELKjs** desktop/web IDE (infinite 60 FPS canvas, ELK Sugiyama auto-layout, inline UML editing, `Ctrl+K` Command Palette, live 8-language code preview, dark/light themes).

## Quick Start

```bash
# Run the full Rust test suite (all 7 crates)
cargo test --workspace

# Build the Desktop / Web UI
cd apps/desktop && pnpm build

# Migrate a historical BouML v4 .prj project
cargo run --bin bouml -- import-prj legacy/plugouts/empty/empty.prj --out ./empty.bouml

# Reverse-engineer any source repo or UML/SQL/OpenAPI file
cargo run --bin bouml -- import ./my-app.bouml ./src

# Generate code & round-trip developer-edited method bodies
cargo run --bin bouml -- generate ./my-app.bouml --lang rust --out ./gen
cargo run --bin bouml -- roundtrip-bodies ./my-app.bouml --lang rust --src ./gen

# Text-to-UML & conversational refactoring (OpenAI / Anthropic / local Ollama)
cargo run --bin bouml -- ai-generate ./my-app.bouml --provider ollama --model qwen2.5-coder:14b --spec ./spec.md
cargo run --bin bouml -- ai-refactor ./my-app.bouml --provider openai --model gpt-4o --prompt "Add Strategy pattern on PaymentProcessor"

# Start the JSON-RPC 2.0 / MCP server over stdio
cargo run --bin bouml -- rpc ./my-app.bouml
```
