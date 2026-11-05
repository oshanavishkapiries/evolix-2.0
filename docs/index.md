# Evolix documentation

All project documentation lives here. Start with [local development](development/local-development.md), [application configuration](configuration/application-configuration.md), or [Evo Engine deployment](evo-engine/deployment.md).

## Organization

Use lowercase, hyphenated Markdown filenames under the matching topic folder. Keep source code, deployment files, and credentials in their original project directories. Shell commands in these guides run from the repository root unless a guide specifies another working directory. Historical plans describe their original design and may mention retired components.

The root `README.md` links here. The root `AGENTS.md` stays in place for agent instruction discovery and is maintained by Next.js.

## Contents

### Development

- [Local Docker Development Environment](development/local-development.md)

### Configuration

- [Application configuration](configuration/application-configuration.md)
- [Engine configuration push](configuration/engine-configuration.md)

### API

- [Evolix 2.0 — Backend API guide for AI agents](api/backend-api.md)

### Architecture

- [CineSrc Player Reverse Engineering & Provider Architecture Specification](architecture/cinesrc-player.md)
- [Evo pipeline](architecture/evo-pipeline.md)

### Evo Engine

- [Extraction benchmark (live)](evo-engine/benchmarks/benchmark-live.md)
- [Extraction benchmark (synthetic)](evo-engine/benchmarks/benchmark-synthetic.md)
- [Evo Engine deployment](evo-engine/deployment.md)
- [Implementation Plan: Hybrid Media Architecture with Evolix 2.0 Design System](evo-engine/implementation-plan.md)

### Features

- [Player questions ("feedback moments")](features/feedback-moments.md)
- [Friendly errors](features/friendly-errors.md)
- [Sinhala subtitles: keeping every line on its own cue](features/sinhala-subtitle-alignment.md)
- [Subtitle library](features/subtitle-library.md)

### Operations

- [Error tracking](operations/error-tracking.md)
- [Viewer journeys](operations/viewer-journeys.md)

### Specifications

- [Support chat](specs/support-chat.md)
- [Spec: Viewer UI redesign (Plex-inspired)](specs/ui-redesign.md)

### Tools

- [Architecture and Technical Reference](tools/architecture.md)
- [Evolix 2.0 Media Tooling & Automation Suite](tools/index.md)
- [Evolix 2.0 Media Tooling & Automation Suite](tools/overview.md)
- [Automated Ingestion Pipeline (`run_50_pipeline.py` & `select_clean_50.py`)](tools/pipeline.md)
- [Pixeldrain CRUD & Upload Suite (`upload_pixeldrain.py`)](tools/pixeldrain.md)
- [Setup and Configuration](tools/setup.md)
- [Stream Worker](tools/stream-worker.md)
- [Subtitle Extraction (`extract_subtitles.py`)](tools/subtitles.md)
- [TG-FileStream](tools/telegram-file-stream/overview.md)
- [Telegram file stream roadmap](tools/telegram-file-stream/roadmap.md)
- [Usage and Commands](tools/usage.md)
