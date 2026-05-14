# Changelog

All notable changes to this project will be documented in this file.

## [1.5.2] - 2026-05-14

### Added

- Added optional `verifyAfterUpdate` flag to bulk update requests, allowing consolidate flows to skip post-update verification when not needed.
- Added regression coverage for:
  - consolidated-tab refresh behavior when `workspaceLoaded` arrives without `requestId`,
  - updates visibility with `Microsoft.EntityFrameworkCore.Design` project references,
  - webview bootstrap handling for explicit `refresh` messages.

### Changed

- Bulk package action flow now sends `verifyAfterUpdate: false` for `Consolidated` tab actions and keeps verification enabled for `Updates`.
- UI controls are now consistently disabled while an action is in progress (`refresh`, `install`, `uninstall`, `bulk`, `source`) across toolbar, installed list, and package details forms.
- Tab badges are now hidden while a tab is in loading state to avoid showing stale counts during refresh.
- Selected package details are now auto-cleared when the selected package is no longer visible after filtering or state refresh.
- Improved `workspaceLoaded` request correlation in the webview so payloads without `requestId` are still accepted during pending refresh flows.

### Fixed

- Fixed XML package update writes for `.csproj` and `Directory.Packages.props` files with non-UTF8 encodings by preserving detected XML encoding (`utf8`, `utf16-le`, `utf16-be`) and UTF-8 BOM behavior.
- Fixed post-consolidation state where `Updates` and `Vulnerabilities` could temporarily show `0` items until manual refresh by ensuring background enrichment runs after bulk operations.
- Fixed bulk operation result messaging so non-verified flows no longer report "and verified" when verification was intentionally skipped.

## [1.5.1] - 2026-05-11

### Changed

- In the `Browse` tab, selecting a package now preselects only projects where that package is already installed; other projects remain unchecked.

### Fixed

- Fixed vulnerabilities scanning regression where a single invalid or unreachable NuGet source could prevent package vulnerability detection.
- Added resilient vulnerability scan fallback flow using `--ignore-failed-sources` and a healthy-source fallback when available.
- Fixed `Vulnerabilities` tab filtering so vulnerable installed packages are visible even when they are unavailable in the currently selected feed.
- Updated Playwright coverage for package action states across tabs (`Browse`, `Installed`, `Updates`, `Consolidated`, `Vulnerabilities`) to match the current preselection behavior.
- Stabilized `Browse` package selection tests by using exact heading matches and deterministic `browsePackagesLoaded` test payload handling.

## [1.5.0] - 2026-05-11

### Added

- Offline-first workspace loading mode that returns project/package data quickly and performs updates/vulnerability enrichment in the background.
- Background enrichment pipeline for workspace data (`LoadWorkspaceBackgroundData`) with explicit success/warning status messaging.
- Global `backgroundDataPending` state in workspace payloads, enabling deterministic UI loading behavior while background data is still being fetched.
- Workspace verification capability (`verifyWorkspace`) in extension messaging and panel handling, including summary/error reporting for scan results.
- New setting `semicDotnetNuget.workspace.networkChecksOnLoad` to control whether source health probes are executed during initial workspace load.

### Changed

- `LoadWorkspace` no longer blocks on network-heavy latest-version and vulnerability checks; these are now performed asynchronously after the initial payload is shown.
- Source listing now supports optional health checks (`ListSources(checkHealth)`), and browse/details/install paths use lightweight source reads without health probing to reduce latency.
- Install/update/consolidate workflow now prefers direct XML version replacement in project files (`.csproj`) or central package management files (`Directory.Packages.props`) before falling back to CLI add behavior.
- Install and bulk update/consolidate operations now include post-operation verification and return verified success messages.
- `Updates` and `Vulnerabilities` tabs now show a loading spinner while background enrichment is in progress, removing dead-empty interim states.
- Tab switching no longer resets background loading progress; loading duration is tied to one global enrichment run rather than active tab changes.
- Project selection is now cleared by default when opening package install/update details, so users explicitly choose target projects before applying changes.

### Fixed

- Fixed empty `Updates` view caused by deferred latest-version resolution by introducing automatic background hydration and second-phase payload delivery.
- Fixed user-facing stale/ambiguous state during deferred loading by explicitly signaling background pending/completed states to the webview.
- Improved failure diagnostics for bulk update operations by preserving detailed per-project failure descriptions and verification mismatches.
- Fixed package icon resolution in tabs other than `Browse` by using NuGet icon fallback URLs based on package id and version.
- Fixed settings UX during background refresh so the source edit form is no longer closed while left-side tabs continue loading.
- Improved private feed authentication by reading source credentials from `NuGet.Config` and applying auth headers for source health, browse, details and update metadata requests.

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

[1.5.1]: https://github.com/wojtekc17/Semic.DotnetNuget/tree/v1.5.1
[1.5.0]: https://github.com/wojtekc17/Semic.DotnetNuget/tree/v1.5.0
[1.4.0]: https://github.com/wojtekc17/Semic.DotnetNuget/tree/v1.4.0
[1.3.0]: https://github.com/wojtekc17/Semic.DotnetNuget/tree/v1.3.0
