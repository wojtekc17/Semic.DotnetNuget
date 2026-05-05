const vscode = acquireVsCodeApi();
const ALL_SOURCES = "__all__";

const state = {
  activeTab: "browse",
  searchTerm: "",
  includePrerelease: false,
  selectedSourceName: "",
  selectedPackageId: "",
  selectedPackageVersion: "",
  previewTab: "readme",
  selectedProjectIds: new Set(),
  settingsOpen: false,
  infoOpen: false,
  sourceFormOpen: false,
  sourceEditName: "",
  sourceAuthMode: "none",
  sourceDraft: {
    name: "",
    url: "",
    username: "",
    password: ""
  },
  status: "idle",
  statusMessage: "Ready.",
  actionBusy: "",
  solutionPath: "",
  workspaceSettings: {
    useAllProjects: false,
    solutionPath: "",
    availableSolutions: []
  },
  projects: [],
  sources: [],
  installedPackages: [],
  browsePackages: [],
  browseSkip: 0,
  browseTake: 30,
  browseHasMore: false,
  browseLoading: false,
  packageDetails: {},
  packageDetailsLoading: {},
  sourceActionName: "",
  errors: []
};

const tabs = [
  ["browse", "BROWSE"],
  ["installed", "INSTALLED"],
  ["updates", "UPDATES"],
  ["consolidated", "CONSOLIDATED"],
  ["vulnerabilities", "VULNERABILITIES"]
];

window.addEventListener("message", (event) => {
  const message = event.data;
  let preserveDetailsScroll = false;

  if (message.type === "stateChanged") {
    state.activeTab = message.payload.activeTab;
    state.searchTerm = message.payload.searchTerm;
    state.includePrerelease = message.payload.options.includePrerelease;
    state.selectedSourceName = message.payload.options.selectedSourceName;
  }

  if (message.type === "busyState") {
    state.status = message.payload.status;
    state.statusMessage = message.payload.message;
    state.actionBusy = message.payload.status === "loading" ? inferBusyAction(message.payload.message) : "";
    state.sourceActionName = message.payload.status === "loading" ? state.sourceActionName : "";

    if (message.payload.status === "loading" && state.activeTab === "browse" && state.actionBusy === "refresh") {
      state.browsePackages = [];
      state.browseSkip = 0;
      state.browseHasMore = false;
      state.browseLoading = true;
    }
  }

  if (message.type === "workspaceLoaded") {
    const wasSourceActionBusy = state.actionBusy === "source";
    state.solutionPath = message.payload.solutionPath || "";
    state.workspaceSettings = message.payload.workspaceSettings || { useAllProjects: false, solutionPath: "", availableSolutions: [] };
    state.projects = message.payload.projects;
    state.sources = message.payload.sources;
    state.installedPackages = message.payload.installedPackages;
    state.errors = message.payload.errors;
    state.selectedSourceName = message.payload.options.selectedSourceName;
    state.includePrerelease = message.payload.options.includePrerelease;
    state.status = message.payload.status;
    state.statusMessage = message.payload.message;
    state.actionBusy = "";
    state.sourceActionName = "";
    preserveDetailsScroll = state.settingsOpen;

    if (wasSourceActionBusy) {
      state.sourceFormOpen = false;
      state.sourceEditName = "";
      state.sourceAuthMode = "none";
      state.sourceDraft = { name: "", url: "", username: "", password: "" };
    }

    scheduleBrowse({ renderLoading: true, immediate: true });
  }

  if (message.type === "browsePackagesLoaded") {
    state.browsePackages = message.payload.append ? mergePackages(state.browsePackages, message.payload.packages) : message.payload.packages;
    state.browseSkip = message.payload.skip + message.payload.packages.length;
    state.browseTake = message.payload.take;
    state.browseHasMore = message.payload.hasMore;
    state.browseLoading = false;
    state.status = message.payload.status;
    state.statusMessage =
      message.payload.status === "success"
        ? `Loaded ${state.browsePackages.length} package(s)${state.browseHasMore ? ". Scroll for more." : "."}`
        : message.payload.message;

    if (state.selectedPackageId && !state.browsePackages.some((packageInfo) => packageInfo.id === state.selectedPackageId)) {
      state.selectedPackageId = "";
    }

    if (message.payload.append) {
      preserveDetailsScroll = true;
      message.preserveContentScroll = true;
    }
  }

  if (message.type === "packageDetailsLoaded") {
    const details = message.payload.details;
    const detailsKey = packageDetailsKey(details.id, details.version);
    state.packageDetails[detailsKey] = details;
    state.packageDetailsLoading[detailsKey] = false;
    state.status = message.payload.status;
    state.statusMessage = message.payload.message;
    preserveDetailsScroll = true;
  }

  if (message.type === "error") {
    state.status = "error";
    state.statusMessage = message.payload.message;
    state.actionBusy = "";
    state.sourceActionName = "";
    state.browseLoading = false;
    state.packageDetailsLoading = {};
  }

  render({ preserveDetailsScroll, preserveContentScroll: message.preserveContentScroll });
});

state.status = "loading";
state.statusMessage = "Loading workspace projects and NuGet sources...";
state.actionBusy = "refresh";
state.browseLoading = true;
render();
vscode.postMessage({ type: "ready" });

function syncState() {
  const payload = {
    activeTab: state.activeTab,
    searchTerm: state.searchTerm,
    options: {
      selectedSourceName: state.selectedSourceName,
      includePrerelease: state.includePrerelease
    }
  };

  vscode.setState(payload);
  vscode.postMessage({ type: "syncState", payload });
}

let browseTimer = 0;

function scheduleBrowse(options = {}) {
  window.clearTimeout(browseTimer);

  if (state.activeTab === "browse") {
    if (!options.append) {
      state.browseSkip = 0;
      state.browseHasMore = false;
    }

    state.browseLoading = true;
    state.status = "loading";
    state.statusMessage = options.append ? "Loading more packages..." : "Loading packages...";

    render({ focusSearch: Boolean(options.focusSearch), preserveDetailsScroll: Boolean(options.preserveDetailsScroll) });
  }

  browseTimer = window.setTimeout(() => {
    if (state.activeTab !== "browse") {
      return;
    }

    vscode.postMessage({
      type: "browsePackages",
      payload: {
        query: state.searchTerm,
        includePrerelease: state.includePrerelease,
        sourceName: state.selectedSourceName,
        skip: options.append ? state.browseSkip : 0,
        take: state.browseTake,
        append: Boolean(options.append)
      }
    });
  }, options.immediate ? 0 : 350);
}

function render(options = {}) {
  const detailsPane = document.querySelector(".detailsPane");
  const contentScroller = document.querySelector(".contentScroller");
  const detailsScrollTop = options.preserveDetailsScroll ? detailsPane?.scrollTop ?? 0 : 0;
  const contentScrollTop = options.preserveContentScroll ? contentScroller?.scrollTop ?? 0 : 0;
  const wasSearchFocused = document.activeElement?.getAttribute("data-input") === "search";
  const searchSelectionStart = wasSearchFocused ? document.activeElement.selectionStart : undefined;

  document.getElementById("root").innerHTML = `
    <div class="appShell">
      <main class="nugetWorkspace">
        <section class="packageColumn">
          ${renderToolbar()}
          <div class="contentScroller">${renderContent()}</div>
        </section>
        <aside class="detailsPane">${state.infoOpen ? renderFeedInfo() : state.settingsOpen ? renderSourceSettings() : renderDetails()}</aside>
      </main>
      <footer class="statusBar status-${escapeHtml(state.status)}">
        <strong>${escapeHtml(state.status.toUpperCase())}</strong>
        <span>${escapeHtml(state.statusMessage)}</span>
      </footer>
    </div>`;

  bindEvents();
  restoreSearchFocus({ ...options, wasSearchFocused, searchSelectionStart });

  if (options.preserveDetailsScroll) {
    document.querySelector(".detailsPane")?.scrollTo({ top: detailsScrollTop });
  }

  if (options.preserveContentScroll) {
    document.querySelector(".contentScroller")?.scrollTo({ top: contentScrollTop });
  }
}

function renderToolbar() {
  const updatesCount = state.installedPackages.filter((packageGroup) => packageGroup.hasUpdate).length;
  const consolidatedCount = state.installedPackages.filter((packageGroup) => !packageGroup.isConsolidated).length;
  const vulnerabilitiesCount = state.installedPackages.filter((packageGroup) => packageGroup.vulnerabilities.length > 0).length;

  return `
    <header class="toolbar">
      <div class="tabs">
        ${tabs
          .map(([key, label]) => {
            const count =
              key === "updates"
                  ? updatesCount
                  : key === "consolidated"
                    ? consolidatedCount
                    : key === "vulnerabilities"
                      ? vulnerabilitiesCount
                      : "";
            const badge =
              count > 0
                ? key === "vulnerabilities"
                  ? `<span class="warningTabBadge">! ${count}</span>`
                  : `<span>${count}</span>`
                : "";
            return `<button class="tabButton ${state.activeTab === key ? "isActive" : ""}" type="button" data-tab="${key}">
              ${label}${badge}
            </button>`;
          })
          .join("")}
        <button class="iconButton refreshButton" type="button" data-action="refresh" title="Refresh">${state.actionBusy === "refresh" ? renderSpinner() : ""}</button>
        <button class="iconButton infoButton ${state.infoOpen ? "isActive" : ""}" type="button" data-action="toggle-info" title="Info">i</button>
        <button class="iconButton gearButton ${state.settingsOpen ? "isActive" : ""}" type="button" data-action="toggle-settings" title="Settings">⚙</button>
      </div>
      <div class="filters">
        <div class="searchBox">
          <input class="searchInput" value="${escapeAttribute(state.searchTerm)}" placeholder="Search packages..." data-input="search" />
          ${state.searchTerm ? `<button class="clearSearchButton" type="button" data-action="clear-search" title="Clear search">×</button>` : ""}
        </div>
        <label class="checkboxLabel">
          <input ${state.includePrerelease ? "checked" : ""} type="checkbox" data-input="prerelease" />
          Prerelease
        </label>
        <span class="toolbarSpacer"></span>
        <select class="sourceSelect toolbarSourceSelect" data-input="toolbar-source" aria-label="NuGet source">
          <option ${state.selectedSourceName === ALL_SOURCES || !state.selectedSourceName ? "selected" : ""} value="${ALL_SOURCES}">All</option>
          ${state.sources.map((source) => `<option ${source.name === state.selectedSourceName ? "selected" : ""} value="${escapeAttribute(source.name)}">${escapeHtml(source.name)}</option>`).join("")}
        </select>
      </div>
    </header>`;
}

function renderContent() {
  if (state.activeTab === "browse") {
    return renderBrowsePackages();
  }

  if (state.activeTab === "installed" || state.activeTab === "updates" || state.activeTab === "consolidated" || state.activeTab === "vulnerabilities") {
    return renderInstalledPackages();
  }

  return renderEmpty("No packages to show.", "Refresh the workspace.");
}

function renderBrowsePackages() {
  if (state.browsePackages.length === 0) {
    return state.browseLoading
      ? renderLoadingState("Loading packages...")
      : renderEmpty("No packages to show.", "Search the selected NuGet source or refresh the workspace.");
  }

  return `<div class="packageList">${state.browsePackages
    .map(
      (packageInfo) => `
        <button class="packageRow packageButton ${state.selectedPackageId === packageInfo.id ? "isSelected" : ""}" type="button" data-package="${escapeAttribute(packageInfo.id)}">
          <div class="packageIcon">${packageInfo.iconUrl ? `<img alt="" src="${escapeAttribute(packageInfo.iconUrl)}" />` : "<span>.NET</span>"}</div>
          <div class="packageMain">
            <h3>${escapeHtml(packageInfo.id)}</h3>
            <p class="byline">by ${escapeHtml(packageInfo.authors || "unknown author")}</p>
            <p class="description">${escapeHtml(packageInfo.description || "")}</p>
            ${renderPackageMetaStrip(packageInfo)}
          </div>
          <strong class="versionText">${escapeHtml(packageInfo.version)}</strong>
        </button>`
    )
    .join("")}${state.browseLoading ? `<div class="loadingRow">${renderSpinner()} Loading packages...</div>` : ""}${state.browseHasMore ? `<button class="loadMoreRow" type="button" data-action="load-more">${state.browseLoading ? renderSpinner() : ""} Load more</button>` : ""}</div>`;
}

function renderInstalledPackages() {
  const filter = state.searchTerm.trim().toLowerCase();
  let groups = state.installedPackages.filter((packageGroup) => {
    if (!filter) {
      return true;
    }

    return packageGroup.id.toLowerCase().includes(filter) || packageGroup.projects.some((project) => project.projectName.toLowerCase().includes(filter));
  });

  if (state.activeTab === "consolidated") {
    groups = groups.filter((packageGroup) => !packageGroup.isConsolidated);
  }

  if (state.activeTab === "updates") {
    groups = groups.filter((packageGroup) => packageGroup.hasUpdate);
  }

  if (state.activeTab === "vulnerabilities") {
    groups = groups.filter((packageGroup) => packageGroup.vulnerabilities.length > 0);
  }

  if (groups.length === 0) {
    return renderEmpty("No installed packages found.", "PackageReference entries are loaded from projects listed in the .slnx file.");
  }

  return `<div class="packageList">${groups
    .map(
      (packageGroup) => `
        <button class="packageRow packageButton installedRow ${state.selectedPackageId === packageGroup.id ? "isSelected" : ""}" type="button" data-package-group="${escapeAttribute(packageGroup.id)}">
          <div class="packageIcon"><span>.NET</span></div>
          <div class="packageMain">
            <h3>${escapeHtml(packageGroup.id)}</h3>
            <p class="description">${packageGroup.projects.length} project(s)${packageGroup.vulnerabilities.length > 0 ? ` · ${packageGroup.vulnerabilities.length} vulnerable` : ""}</p>
            <div class="projectChips">${packageGroup.projects
              .slice(0, 5)
              .map((project) => `<span>${escapeHtml(project.projectName)}</span>`)
              .join("")}</div>
          </div>
          <strong class="versionText ${packageGroup.isConsolidated ? "" : "warningText"}">${escapeHtml(packageGroup.versions.join(", "))}</strong>
        </button>`
    )
    .join("")}</div>`;
}

function renderDetails() {
  const selectedPackage = getSelectedPackageContext();

  if (selectedPackage) {
    return renderPackageDetails(selectedPackage);
  }

  return `
    <section class="detailsSection">
      <h2>Workspace</h2>
      <dl class="statsList">
        <div><dt>Projects</dt><dd>${state.projects.length}</dd></div>
        <div><dt>Packages</dt><dd>${state.installedPackages.length}</dd></div>
        <div><dt>Source</dt><dd>${escapeHtml(state.selectedSourceName || "None")}</dd></div>
      </dl>
      ${state.solutionPath ? `<p class="pathText">${escapeHtml(state.solutionPath)}</p>` : ""}
    </section>
    ${renderErrors()}`;
}

function renderFeedInfo() {
  return `
    <section class="detailsSection infoSection">
      <h2>Info</h2>
      <p>Browse, README and Package Details use NuGet feed API v3 endpoints.</p>
      <p>Local/offline package sources are visible in source settings, but they do not expose searchable package metadata in this view.</p>
      <p>Package install and uninstall still use the .NET CLI against selected projects.</p>
    </section>`;
}

function renderPackageDetails(packageInfo) {
  const versions = packageInfo.versions && packageInfo.versions.length > 0 ? packageInfo.versions : [packageInfo.version];
  const selectedVersion = state.selectedPackageVersion || packageInfo.version;
  const installedVersion = getInstalledVersion(packageInfo);
  const details = getLoadedPackageDetails(packageInfo.id, selectedVersion);
  const detailsLoading = isPackageDetailsLoading(packageInfo.id, selectedVersion);

  return `
    <section class="packagePreview">
      <div class="previewStickyHeader">
        <div class="previewHeader">
          <div class="packageIcon previewIcon">${packageInfo.iconUrl ? `<img alt="" src="${escapeAttribute(packageInfo.iconUrl)}" />` : "<span>.NET</span>"}</div>
          <div>
            <h2>${escapeHtml(packageInfo.id)}</h2>
          <p class="byline">${escapeHtml(getSelectedSourceLabel())}</p>
          </div>
        </div>
        ${renderPackageMetaStrip(packageInfo)}
      </div>
      ${renderActionForm(versions, selectedVersion, installedVersion)}
      <div class="mappingNotice">Package source mapping is off. <button class="linkButton" type="button" data-action="toggle-settings">Configure</button></div>
      ${renderProjectVersionTable(packageInfo)}
      <div class="previewTabs">
        <button class="previewTab ${state.previewTab === "readme" ? "isActive" : ""}" type="button" data-preview-tab="readme">README</button>
        <button class="previewTab ${state.previewTab === "details" ? "isActive" : ""}" type="button" data-preview-tab="details">Package Details</button>
      </div>
      ${state.previewTab === "details" ? renderPackageDetailsTab(packageInfo, selectedVersion, installedVersion, details, detailsLoading) : renderReadmeTab(packageInfo, details, detailsLoading)}
    </section>`;
}

function renderPackageMetaStrip(packageInfo) {
  const parts = [];

  if (packageInfo.verified) {
    parts.push(`<span class="verifiedBadge" title="Verified package">Verified✓</span>`);
  }

  if (packageInfo.downloads) {
    parts.push(`<span class="downloadBadge" title="Downloads"><span class="downloadIcon"></span>${formatDownloads(packageInfo.downloads)}</span>`);
  }

  return parts.length > 0 ? `<div class="packageMetaStrip">${parts.join("")}</div>` : "";
}

function renderActionForm(versions, selectedVersion, installedVersion) {
  const versionSelect = `
    <select class="sourceSelect" data-input="install-version">
      ${versions.map((version) => `<option ${version === selectedVersion ? "selected" : ""} value="${escapeAttribute(version)}">${escapeHtml(version)}</option>`).join("")}
    </select>`;
  const uninstallButton = installedVersion
    ? `<button class="dangerButton" type="button" data-action="uninstall-package">${state.actionBusy === "uninstall" ? renderSpinner() : ""} Uninstall</button>`
    : "";

  if (state.activeTab === "updates") {
    return `
      <div class="previewFormGrid updateFormGrid">
        <label>Installed:<input class="textInput" value="${escapeAttribute(installedVersion || "not installed")}" readonly /></label>
        <label>Update to:${versionSelect}</label>
        <button class="primaryButton" type="button" data-action="install-package">${state.actionBusy === "install" ? renderSpinner() : ""} Update</button>
        ${uninstallButton}
      </div>`;
  }

  if (state.activeTab === "installed" || state.activeTab === "consolidated") {
    return `
      <div class="previewFormGrid installedFormGrid">
        <label>Version:${versionSelect}</label>
        <button class="primaryButton" type="button" data-action="install-package">${state.actionBusy === "install" ? renderSpinner() : ""} Install</button>
        ${uninstallButton}
      </div>`;
  }

  return `
    <div class="previewFormGrid browseFormGrid">
      <label>Installed:<input class="textInput" value="${escapeAttribute(installedVersion || "not installed")}" readonly /></label>
      <label>Version:${versionSelect}</label>
      <button class="primaryButton" type="button" data-action="install-package">${state.actionBusy === "install" ? renderSpinner() : ""} Install</button>
      ${uninstallButton}
    </div>`;
}

function renderProjectVersionTable(packageInfo) {
  const rows = state.projects.map((project) => {
    const reference = project.packages.find((packageReference) => packageReference.id.toLowerCase() === packageInfo.id.toLowerCase());
    const installed = reference?.version || "";
    const packageLevel = reference ? "Top-level" : "";

    return `
      <label class="projectVersionRow" title="${escapeAttribute(project.relativePath)}">
        <input ${state.selectedProjectIds.has(project.id) ? "checked" : ""} type="checkbox" data-project="${escapeAttribute(project.id)}" />
        <span>${escapeHtml(project.name)}</span>
        <span>${escapeHtml(selectedProjectVersion(packageInfo, project, installed))}</span>
        <span>${escapeHtml(installed)}</span>
        <span>${escapeHtml(packageLevel)}</span>
      </label>`;
  });

  return `
    <section class="versionsPanel">
      <div class="projectSelectHeader">
        <span>Versions: ${packageInfo.projects?.length ?? 0}</span>
        <button class="linkButton" type="button" data-action="toggle-all-projects">Toggle all</button>
      </div>
      <div class="projectVersionTable">
        <div class="projectVersionHeader">
          <span></span>
          <span>Project</span>
          <span>Version</span>
          <span>Installed</span>
          <span>Package Level</span>
        </div>
        <div class="projectVersionScroller">${rows.join("")}</div>
      </div>
    </section>`;
}

function selectedProjectVersion(packageInfo, project, installedVersion) {
  if (state.activeTab === "updates") {
    return state.selectedPackageVersion || packageInfo.version || installedVersion;
  }

  return installedVersion;
}

function renderReadmeTab(packageInfo, details, detailsLoading) {
  const readme = details?.readme?.trim();

  return `
    <article class="readmePreview">
      ${
        readme
          ? renderMarkdownPreview(readme)
          : detailsLoading || !details
            ? renderLoadingState("Loading README from NuGet feed...")
            : `<h1>${escapeHtml(packageInfo.id)}</h1>
               <p>No README is available from the enabled NuGet v3 feeds.</p>`
      }
    </article>`;
}

function renderPackageDetailsTab(packageInfo, selectedVersion, installedVersion, details, detailsLoading) {
  if (detailsLoading || !details) {
    return `<article class="readmePreview">${renderLoadingState("Loading package metadata from NuGet feed...")}</article>`;
  }

  const data = details ?? {};
  const dependencies = data.dependencies ?? [];

  return `
    <article class="readmePreview">
      <h1>Package Details</h1>
      <h2>Description</h2>
      <p>${escapeHtml(data.description || packageInfo.description || "")}</p>
      <dl class="packageDetailsList">
        <div><dt>ID</dt><dd>${escapeHtml(packageInfo.id)}</dd></div>
        <div><dt>Version</dt><dd>${escapeHtml(data.version || selectedVersion)}</dd></div>
        <div><dt>Installed</dt><dd>${escapeHtml(installedVersion || "not installed")}</dd></div>
        <div><dt>Author(s)</dt><dd>${escapeHtml(data.authors || packageInfo.authors || "unknown")}</dd></div>
        <div><dt>License</dt><dd>${data.license ? renderMaybeLink(data.license) : "unknown"}</dd></div>
        <div><dt>Readme</dt><dd>${data.readmeUrl ? renderExternalLink("View Readme", data.readmeUrl) : "not available"}</dd></div>
        <div><dt>Date published</dt><dd>${escapeHtml(formatDate(data.published))}</dd></div>
        <div><dt>Project URL</dt><dd>${data.projectUrl ? renderExternalLink(data.projectUrl, data.projectUrl) : "not available"}</dd></div>
        <div><dt>Report Abuse</dt><dd>${data.reportAbuseUrl ? renderExternalLink(data.reportAbuseUrl, data.reportAbuseUrl) : "not available"}</dd></div>
        <div><dt>Tags</dt><dd>${escapeHtml((data.tags ?? []).join(", ") || "none")}</dd></div>
        <div><dt>Downloads</dt><dd>${packageInfo.downloads ? Number(packageInfo.downloads).toLocaleString() : "unknown"}</dd></div>
        <div><dt>Source</dt><dd>${escapeHtml(data.sourceName || state.selectedSourceName || "default")}</dd></div>
        <div><dt>Vulnerabilities</dt><dd>${renderVulnerabilitySummary(packageInfo)}</dd></div>
      </dl>
      <details open>
        <summary>Dependencies</summary>
        ${renderDependencies(dependencies)}
      </details>
    </article>`;
}

function renderVulnerabilitySummary(packageInfo) {
  const group = state.installedPackages.find((packageGroup) => packageGroup.id.toLowerCase() === packageInfo.id.toLowerCase());
  const vulnerabilities = group?.vulnerabilities ?? [];

  if (vulnerabilities.length === 0) {
    return "none";
  }

  return vulnerabilities
    .map((vulnerability) => {
      const text = `${vulnerability.severity} ${vulnerability.version} (${vulnerability.projectName})`;
      return vulnerability.advisoryUrl ? renderExternalLink(text, vulnerability.advisoryUrl) : escapeHtml(text);
    })
    .join("<br />");
}

function getSelectedPackageContext() {
  if (!state.selectedPackageId) {
    return undefined;
  }

  const browsePackage = state.browsePackages.find((packageInfo) => packageInfo.id === state.selectedPackageId);

  if (browsePackage) {
    return browsePackage;
  }

  const group = state.installedPackages.find((packageGroup) => packageGroup.id === state.selectedPackageId);

  if (!group) {
    return undefined;
  }

  const version = state.selectedPackageVersion || group.versions[group.versions.length - 1] || group.versions[0] || "";

  return {
    id: group.id,
    version,
    versions: group.versions.length > 0 ? group.versions : [version],
    description: `${group.projects.length} project(s) reference this package.`,
    authors: "",
    downloads: undefined,
    verified: false,
    projects: group.projects
  };
}

function getLoadedPackageDetails(packageId, version) {
  return state.packageDetails[packageDetailsKey(packageId, version)];
}

function isPackageDetailsLoading(packageId, version) {
  return Boolean(state.packageDetailsLoading[packageDetailsKey(packageId, version)]);
}

function requestSelectedPackageDetails() {
  const selectedPackage = getSelectedPackageContext();
  const version = state.selectedPackageVersion || selectedPackage?.version || "";
  const detailsKey = selectedPackage ? packageDetailsKey(selectedPackage.id, version) : "";

  if (!selectedPackage || !version || getLoadedPackageDetails(selectedPackage.id, version) || state.packageDetailsLoading[detailsKey]) {
    return;
  }

  state.packageDetailsLoading[detailsKey] = true;
  state.status = "loading";
  state.statusMessage = `Loading metadata for ${selectedPackage.id} ${version}...`;

  vscode.postMessage({
    type: "loadPackageDetails",
    payload: {
      packageId: selectedPackage.id,
      version,
      sourceName: state.selectedSourceName
    }
  });
}

function packageDetailsKey(packageId, version) {
  return `${String(packageId).toLowerCase()}@${String(version).toLowerCase()}`;
}

function formatDownloads(downloads) {
  if (downloads >= 1000000000) {
    return `${(downloads / 1000000000).toFixed(1)}B`;
  }

  if (downloads >= 1000000) {
    return `${(downloads / 1000000).toFixed(downloads >= 10000000 ? 0 : 1)}M`;
  }

  if (downloads >= 1000) {
    return `${(downloads / 1000).toFixed(downloads >= 10000 ? 0 : 1)}K`;
  }

  return String(downloads);
}

function formatDate(value) {
  if (!value) {
    return "unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function renderExternalLink(label, url) {
  return `<a href="${escapeAttribute(url)}">${escapeHtml(label)}</a>`;
}

function renderMaybeLink(value) {
  return /^https?:\/\//i.test(value) ? renderExternalLink(value, value) : escapeHtml(value);
}

function renderDependencies(dependencies) {
  if (dependencies.length === 0) {
    return `<p>No dependencies</p>`;
  }

  return dependencies
    .map(
      (group) => `
        <div class="dependencyGroup">
          <strong>${escapeHtml(group.targetFramework || "Any")}</strong>
          ${
            group.dependencies.length === 0
              ? `<p>No dependencies</p>`
              : `<ul>${group.dependencies.map((dependency) => `<li>${escapeHtml(dependency.id)} ${escapeHtml(dependency.range)}</li>`).join("")}</ul>`
          }
        </div>`
    )
    .join("");
}

function renderMarkdownPreview(markdown) {
  const html = [];
  let inCodeBlock = false;
  let codeLines = [];

  markdown
    .split(/\r?\n/)
    .slice(0, 800)
    .forEach((line) => {
      if (line.startsWith("```")) {
        if (inCodeBlock) {
          html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
          codeLines = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        return;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        return;
      }

      if (line.startsWith("### ")) {
        html.push(`<h3>${renderInlineMarkdown(line.slice(4))}</h3>`);
        return;
      }

      if (line.startsWith("## ")) {
        html.push(`<h2>${renderInlineMarkdown(line.slice(3))}</h2>`);
        return;
      }

      if (line.startsWith("# ")) {
        html.push(`<h1>${renderInlineMarkdown(line.slice(2))}</h1>`);
        return;
      }

      if (line.startsWith("- ") || line.startsWith("* ")) {
        html.push(`<p class="markdownListItem">• ${renderInlineMarkdown(line.slice(2))}</p>`);
        return;
      }

      if (line.trim().length === 0) {
        html.push("<br />");
        return;
      }

      html.push(`<p>${renderInlineMarkdown(line)}</p>`);
      return;

      if (line.startsWith("- ") || line.startsWith("* ")) {
        return `<p>• ${escapeHtml(line.slice(2))}</p>`;
      }

      if (line.trim().length === 0) {
        return `<br />`;
      }

      return `<p>${escapeHtml(line)}</p>`;
    });

  if (codeLines.length > 0) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }

  return html.join("");
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, '<img class="markdownImage" alt="$1" src="$2" />')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function getInstalledVersion(packageInfo) {
  const group = state.installedPackages.find((packageGroup) => packageGroup.id.toLowerCase() === packageInfo.id.toLowerCase());

  if (!group) {
    return "";
  }

  return group.versions.length === 1 ? group.versions[0] : group.versions.join(", ");
}

function renderSourceSettings() {
  return `
    <section class="detailsSection">
      <h2>Workspace</h2>
      <label class="optionRow">
        <input ${state.workspaceSettings.useAllProjects ? "checked" : ""} type="checkbox" data-input="use-all-projects" />
        <span>Use all .csproj projects</span>
      </label>
      <span class="sectionHint">When enabled, packages are loaded from every .csproj in the workspace instead of a solution file.</span>
      <div class="workspaceSettingRow">
        <label class="fieldLabel">Solution
          <select class="sourceSelect" data-input="workspace-solution" ${state.workspaceSettings.useAllProjects ? "disabled" : ""}>
            ${renderWorkspaceSolutionOptions()}
          </select>
        </label>
      </div>
    </section>
    <section class="detailsSection">
      <h2>Sources</h2>
      <span class="sectionHint">NuGet sources</span>
      <select class="sourceSelect" data-input="source">
        <option ${state.selectedSourceName === ALL_SOURCES || !state.selectedSourceName ? "selected" : ""} value="${ALL_SOURCES}">All</option>
        ${state.sources.map((source) => `<option ${source.name === state.selectedSourceName ? "selected" : ""} value="${escapeAttribute(source.name)}">${escapeHtml(source.name)}</option>`).join("")}
      </select>
      <div class="sourceList">
        ${state.sources
          .map(
            (source) => `
              <div class="sourceRow ${source.name === state.selectedSourceName ? "isActive" : ""}" title="${escapeAttribute(source.url)}">
                <button class="sourceSelectButton" type="button" data-source="${escapeAttribute(source.name)}">
                  <span>${escapeHtml(source.name)}</span>
                  <code>${escapeHtml(source.url)}</code>
                </button>
                <div class="sourceActions">
                  <button class="iconButton sourceActionButton" type="button" data-action="edit-source" data-source-name="${escapeAttribute(source.name)}" title="Edit source">Edit</button>
                  <button class="iconButton sourceActionButton removeSourceButton" type="button" data-action="remove-source" data-source-name="${escapeAttribute(source.name)}" title="Remove source">${state.actionBusy === "source" && state.sourceActionName === source.name ? renderSpinner() : ""} Remove</button>
                </div>
              </div>`
          )
          .join("")}
      </div>
    </section>
    <section class="detailsSection">
      ${state.sourceFormOpen ? "" : `<button class="primaryButton" type="button" data-action="toggle-source-form">Add source</button>`}
      ${state.sourceFormOpen ? renderSourceForm() : ""}
    </section>`;
}

function renderSourceForm() {
  return `
    <div class="sourceForm">
      <label class="fieldLabel">Name<input class="textInput" data-input="source-name" value="${escapeAttribute(state.sourceDraft.name)}" /></label>
      <label class="fieldLabel">URL<input class="textInput" data-input="source-url" value="${escapeAttribute(state.sourceDraft.url)}" placeholder="https://..." /></label>
      <label class="fieldLabel">Authentication
        <select class="sourceSelect" data-input="auth-mode">
          <option ${state.sourceAuthMode === "none" ? "selected" : ""} value="none">None</option>
          <option ${state.sourceAuthMode === "basic" ? "selected" : ""} value="basic">Username and password</option>
        </select>
      </label>
      ${
        state.sourceAuthMode === "basic"
          ? `<label class="fieldLabel">Username<input class="textInput" data-input="source-username" value="${escapeAttribute(state.sourceDraft.username)}" /></label>
             <label class="fieldLabel">Password<input class="textInput" type="password" data-input="source-password" value="${escapeAttribute(state.sourceDraft.password)}" /></label>`
          : ""
      }
      <div class="buttonRow">
        <button class="primaryButton" type="button" data-action="${state.sourceEditName ? "update-source" : "add-source"}">${state.actionBusy === "source" ? renderSpinner() : ""} ${state.sourceEditName ? "Update source" : "Save source"}</button>
        <button class="secondaryButton" type="button" data-action="cancel-source-form">Cancel</button>
      </div>
    </div>`;
}

function renderWorkspaceSolutionOptions() {
  const selectedPath = state.workspaceSettings.solutionPath || state.solutionPath || "";
  const solutions = state.workspaceSettings.availableSolutions || [];

  if (solutions.length === 0) {
    return `<option value="">No .sln or .slnx found</option>`;
  }

  return solutions
    .map((solutionPath) => `<option ${solutionPath === selectedPath ? "selected" : ""} value="${escapeAttribute(solutionPath)}">${escapeHtml(solutionPath)}</option>`)
    .join("");
}

function renderErrors() {
  if (state.errors.length === 0) {
    return "";
  }

  return `<section class="detailsSection errorSection">
    <h2>Problems</h2>
    ${state.errors.slice(0, 4).map((error) => `<p>${escapeHtml(error.message)}</p>`).join("")}
  </section>`;
}

function renderEmpty(title, detail) {
  return `<div class="emptyState"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(detail)}</p></div>`;
}

function renderLoadingState(message) {
  return `<div class="emptyState loadingState"><div class="centeredSpinner">${renderSpinner()}<span>${escapeHtml(message)}</span></div></div>`;
}

function renderSpinner() {
  return `<span class="spinner" aria-hidden="true"></span>`;
}

function inferBusyAction(message) {
  const lowered = message.toLowerCase();

  if (lowered.includes("uninstall")) {
    return "uninstall";
  }

  if (lowered.includes("install")) {
    return "install";
  }

  if (lowered.includes("nuget source")) {
    return "source";
  }

  if (lowered.includes("loading .slnx")) {
    return "refresh";
  }

  return "generic";
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((element) => {
    element.addEventListener("click", () => {
      state.activeTab = element.getAttribute("data-tab");
      state.settingsOpen = false;
      state.infoOpen = false;
      syncState();
      scheduleBrowse();
      render();
    });
  });

  document.querySelector('[data-action="refresh"]')?.addEventListener("click", () => {
    state.status = "loading";
    state.statusMessage = "Loading workspace projects and NuGet sources...";
    state.actionBusy = "refresh";
    state.browsePackages = [];
    state.browseSkip = 0;
    state.browseHasMore = false;
    state.browseLoading = true;
    vscode.postMessage({ type: "refresh" });
    render();
  });

  document.querySelectorAll('[data-action="toggle-settings"]').forEach((element) => {
    element.addEventListener("click", () => {
      state.settingsOpen = !state.settingsOpen;
      state.infoOpen = false;
      render();
    });
  });

  document.querySelector('[data-action="toggle-info"]')?.addEventListener("click", () => {
    state.infoOpen = !state.infoOpen;
    state.settingsOpen = false;
    render();
  });

  document.querySelector('[data-action="toggle-source-form"]')?.addEventListener("click", () => {
    state.sourceFormOpen = true;
    state.sourceEditName = "";
    state.sourceAuthMode = "none";
    state.sourceDraft = { name: "", url: "", username: "", password: "" };
    render();
  });

  document.querySelector('[data-action="cancel-source-form"]')?.addEventListener("click", () => {
    state.sourceFormOpen = false;
    state.sourceEditName = "";
    state.sourceAuthMode = "none";
    state.sourceDraft = { name: "", url: "", username: "", password: "" };
    render();
  });

  document.querySelector('[data-input="search"]')?.addEventListener("input", (event) => {
    state.searchTerm = event.target.value;
    syncState();
    scheduleBrowse();
  });

  document.querySelector('[data-action="clear-search"]')?.addEventListener("click", () => {
    state.searchTerm = "";
    syncState();
    scheduleBrowse({ immediate: true, renderLoading: true, focusSearch: true });
  });

  document.querySelector('[data-input="prerelease"]')?.addEventListener("change", (event) => {
    state.includePrerelease = event.target.checked;
    syncState();
    scheduleBrowse({ renderLoading: true });
  });

  document.querySelector('[data-input="source"]')?.addEventListener("change", (event) => {
    state.selectedSourceName = event.target.value;
    syncState();
    if (state.selectedSourceName === ALL_SOURCES) {
      scheduleBrowse();
      render();
      return;
    }

    vscode.postMessage({ type: "selectSource", payload: { sourceName: state.selectedSourceName } });
  });

  document.querySelector('[data-input="use-all-projects"]')?.addEventListener("change", (event) => {
    state.workspaceSettings.useAllProjects = event.target.checked;
    state.status = "loading";
    state.statusMessage = "Refreshing workspace projects...";
    render({ preserveDetailsScroll: true });
    vscode.postMessage({ type: "setUseAllProjects", payload: { useAllProjects: state.workspaceSettings.useAllProjects } });
  });

  document.querySelector('[data-input="workspace-solution"]')?.addEventListener("change", (event) => {
    state.workspaceSettings.solutionPath = event.target.value;
    state.status = "loading";
    state.statusMessage = "Refreshing workspace projects...";
    render({ preserveDetailsScroll: true });
    vscode.postMessage({ type: "setWorkspaceSolution", payload: { solutionPath: state.workspaceSettings.solutionPath } });
  });

  document.querySelector('[data-input="toolbar-source"]')?.addEventListener("change", (event) => {
    state.selectedSourceName = event.target.value;
    syncState();
    scheduleBrowse();
    requestSelectedPackageDetails();
    render();
  });

  document.querySelector('[data-action="load-more"]')?.addEventListener("click", () => {
    loadMoreBrowsePackages();
  });

  document.querySelector(".contentScroller")?.addEventListener("scroll", (event) => {
    const element = event.currentTarget;

    if (state.activeTab === "browse" && element.scrollTop + element.clientHeight >= element.scrollHeight - 120) {
      loadMoreBrowsePackages();
    }
  });

  document.querySelectorAll("[data-source]").forEach((element) => {
    element.addEventListener("click", () => {
      state.selectedSourceName = element.getAttribute("data-source");
      syncState();
      vscode.postMessage({ type: "selectSource", payload: { sourceName: state.selectedSourceName } });
    });
  });

  document.querySelectorAll('[data-action="edit-source"]').forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      const sourceName = element.getAttribute("data-source-name");
      const source = state.sources.find((candidate) => candidate.name === sourceName);

      if (!source) {
        return;
      }

      state.sourceFormOpen = true;
      state.sourceEditName = source.name;
      state.sourceAuthMode = "none";
      state.sourceDraft = { name: source.name, url: source.url, username: "", password: "" };
      render();
    });
  });

  document.querySelectorAll('[data-action="remove-source"]').forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      const sourceName = element.getAttribute("data-source-name");

      if (!sourceName) {
        return;
      }

      state.actionBusy = "source";
      state.sourceActionName = sourceName;
      render();
      vscode.postMessage({ type: "removeSource", payload: { name: sourceName } });
    });
  });

  document.querySelectorAll("[data-package]").forEach((element) => {
    element.addEventListener("click", () => {
      state.selectedPackageId = element.getAttribute("data-package");
      const selectedPackage = state.browsePackages.find((packageInfo) => packageInfo.id === state.selectedPackageId);
      state.selectedPackageVersion = selectedPackage?.version || "";
      state.selectedProjectIds.clear();
      state.settingsOpen = false;
      state.previewTab = "readme";
      requestSelectedPackageDetails();
      render();
    });
  });

  document.querySelectorAll("[data-package-group]").forEach((element) => {
    element.addEventListener("click", () => {
      state.selectedPackageId = element.getAttribute("data-package-group");
      const selectedGroup = state.installedPackages.find((packageGroup) => packageGroup.id === state.selectedPackageId);
      state.selectedPackageVersion = selectedGroup?.versions[selectedGroup.versions.length - 1] || selectedGroup?.versions[0] || "";
      state.selectedProjectIds = new Set((selectedGroup?.projects ?? []).map((project) => project.projectId));
      state.settingsOpen = false;
      state.previewTab = "readme";
      requestSelectedPackageDetails();
      render();
    });
  });

  document.querySelector('[data-input="install-version"]')?.addEventListener("change", (event) => {
    state.selectedPackageVersion = event.target.value;
    requestSelectedPackageDetails();
  });

  document.querySelectorAll("[data-preview-tab]").forEach((element) => {
    element.addEventListener("click", () => {
      state.previewTab = element.getAttribute("data-preview-tab");
      requestSelectedPackageDetails();
      render({ preserveDetailsScroll: true });
    });
  });

  document.querySelector('[data-input="auth-mode"]')?.addEventListener("change", (event) => {
    state.sourceAuthMode = event.target.value;
    render();
  });

  document.querySelector('[data-input="source-name"]')?.addEventListener("input", (event) => {
    state.sourceDraft.name = event.target.value;
  });

  document.querySelector('[data-input="source-url"]')?.addEventListener("input", (event) => {
    state.sourceDraft.url = event.target.value;
  });

  document.querySelector('[data-input="source-username"]')?.addEventListener("input", (event) => {
    state.sourceDraft.username = event.target.value;
  });

  document.querySelector('[data-input="source-password"]')?.addEventListener("input", (event) => {
    state.sourceDraft.password = event.target.value;
  });

  document.querySelectorAll("[data-project]").forEach((element) => {
    element.addEventListener("change", (event) => {
      const projectId = event.target.getAttribute("data-project");

      if (event.target.checked) {
        state.selectedProjectIds.add(projectId);
      } else {
        state.selectedProjectIds.delete(projectId);
      }
    });
  });

  document.querySelector('[data-action="toggle-all-projects"]')?.addEventListener("click", () => {
    if (state.selectedProjectIds.size === state.projects.length) {
      state.selectedProjectIds.clear();
    } else {
      state.projects.forEach((project) => state.selectedProjectIds.add(project.id));
    }

    render();
  });

  document.querySelector('[data-action="install-package"]')?.addEventListener("click", () => {
    const selectedPackage = getSelectedPackageContext();
    const version = document.querySelector('[data-input="install-version"]')?.value || state.selectedPackageVersion || selectedPackage?.version || "";

    if (!selectedPackage) {
      return;
    }

    vscode.postMessage({
      type: "installPackage",
      payload: {
        packageId: selectedPackage.id,
        version,
        projectIds: Array.from(state.selectedProjectIds),
        sourceName: state.selectedSourceName
      }
    });
  });

  document.querySelector('[data-action="uninstall-package"]')?.addEventListener("click", () => {
    const selectedPackage = getSelectedPackageContext();

    if (!selectedPackage) {
      return;
    }

    vscode.postMessage({
      type: "uninstallPackage",
      payload: {
        packageId: selectedPackage.id,
        projectIds: Array.from(state.selectedProjectIds)
      }
    });
  });

  document.querySelector('[data-action="add-source"]')?.addEventListener("click", () => {
    state.actionBusy = "source";
    state.sourceActionName = state.sourceDraft.name;
    render();
    vscode.postMessage({
      type: "addSource",
      payload: {
        name: state.sourceDraft.name,
        url: state.sourceDraft.url,
        authMode: state.sourceAuthMode,
        username: state.sourceDraft.username,
        password: state.sourceDraft.password
      }
    });
  });

  document.querySelector('[data-action="update-source"]')?.addEventListener("click", () => {
    state.actionBusy = "source";
    state.sourceActionName = state.sourceEditName || state.sourceDraft.name;
    render();
    vscode.postMessage({
      type: "updateSource",
      payload: {
        originalName: state.sourceEditName,
        name: state.sourceDraft.name,
        url: state.sourceDraft.url,
        authMode: state.sourceAuthMode,
        username: state.sourceDraft.username,
        password: state.sourceDraft.password
      }
    });
  });
}

function loadMoreBrowsePackages() {
  if (!state.browseHasMore || state.browseLoading) {
    return;
  }

  scheduleBrowse({ append: true, immediate: true });
}

function mergePackages(existingPackages, nextPackages) {
  const merged = new Map();

  existingPackages.concat(nextPackages).forEach((packageInfo) => {
    const key = packageInfo.id.toLowerCase();
    const existing = merged.get(key);

    if (!existing || (packageInfo.downloads ?? 0) > (existing.downloads ?? 0)) {
      merged.set(key, packageInfo);
    }
  });

  return Array.from(merged.values());
}

function restoreSearchFocus(options) {
  if (!options.focusSearch && !options.wasSearchFocused) {
    return;
  }

  const input = document.querySelector('[data-input="search"]');

  if (!input) {
    return;
  }

  const cursorPosition = options.searchSelectionStart ?? state.searchTerm.length;
  input.focus();
  input.setSelectionRange(cursorPosition, cursorPosition);
}

function getSelectedSourceLabel() {
  if (state.selectedSourceName === ALL_SOURCES || !state.selectedSourceName) {
    return "All sources";
  }

  return state.selectedSourceName;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

render();
