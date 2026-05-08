# Changelog

All notable changes to this project will be documented in this file.

## [1.4.0] - 2026-05-08

### Added

- Source health diagnostics in the extension UI, including per-source status, health messages and visual problem indicators.
- Enable and disable actions for NuGet sources directly from the settings pane.
- Toolbar problem badges for source issues, including a red counter for enabled failing sources and a yellow warning for disabled sources that still have health problems.
- Playwright coverage for per-source filtering outside `Browse`, rapid source switching, refresh lifecycle correlation and source health management states.

### Changed

- Reduced `Browse` batch loading size to `15` packages per request to keep incremental loading responsive.
- Entering the `Browse` tab now triggers the initial package load immediately, instead of waiting for the incremental loading path.
- Package filtering now respects the selected source across `Installed`, `Updates`, `Consolidated` and `Vulnerabilities`, using in-memory filtering instead of `Browse`-only behavior.
- Tab counters continue to show totals for `All` packages instead of changing with the currently selected source.
- Source selection now ignores disabled and unhealthy feeds for package discovery requests, while still surfacing their status in settings.
- All `dotnet` CLI calls from the extension now force `DOTNET_CLI_UI_LANGUAGE=en` for stable parsing across localized environments.

### Fixed

- Resolved a race where quickly switching NuGet sources could restore stale package results from an older request.
- Fixed refresh synchronization so manual refresh keeps the loading state visible until the workspace reload actually completes.
- Added a dedicated workspace refresh pending flow so the main loading message and refresh spinner stay aligned during full refresh operations.
- Fixed selected-source filtering regressions in tabs other than `Browse`.
- Fixed source state rendering so a disabled source no longer remains labeled as enabled after toggling.
- Improved source parsing for localized `dotnet nuget list source` output, including disabled-state handling.
- Unhealthy feeds no longer slow down or corrupt browse, details and availability queries; they are excluded from request flows and install/update actions fail fast with a clearer error when the chosen source is unusable.
- Restored clear visual feedback for workspace refresh from the main loading area instead of only on local list-level loading states.

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

[1.4.0]: https://github.com/wojtekc17/Semic.DotnetNuget/tree/v1.4.0
[1.3.0]: https://github.com/wojtekc17/Semic.DotnetNuget/tree/v1.3.0