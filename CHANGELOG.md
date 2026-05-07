# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0] - 2026-05-07

### Added

- Workspace loading settings shared with other Semic .NET extensions, including solution selection and optional scanning of all `.csproj` files.
- Source management from the extension UI, including add, update and remove operations for NuGet feeds.
- Rich package preview with README rendering, package metadata and dependency tree presentation.
- Version selection from feed metadata in the `Installed` tab, so any available package version can be chosen for install/update flows.
- Playwright coverage for incremental loading, per-tab search behavior, preview reset, README rendering, dependency tree rendering and version selection.

### Changed

- Refactored the webview application into smaller components and shared utilities to simplify maintenance.
- Improved the package details pane so `Package Details` is the default preview tab and version selectors are driven by feed metadata.
- Updated the `Installed` and `Updates` forms to better reflect installed versions across projects.
- Refreshed project documentation and architecture overview in the README.

### Fixed

- Browse incremental loading now shows a single loading state instead of duplicated loading messages.
- Bulk update and consolidate operations no longer stop after the first package failure and now expose clearer operation logs.
- Refresh, install, update and consolidate actions now keep button busy states visible until the post-operation refresh completes.
- NuGet package README rendering now preserves structured markdown, including fenced code blocks such as Mermaid snippets.
- Package preview is reset correctly when switching tabs.
- Dependency rendering in package details now shows framework groups as an expandable tree.
- Browse project version tables now show correct current and target versions, and unchecked projects show `-` for target version.

[1.3.0]: https://github.com/wojtekc17/Semic.DotnetNuget/tree/v1.3.0