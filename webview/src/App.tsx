import { useEffect, useMemo, useState } from "react";
import { UseVsCodeApi } from "./Hooks/UseVsCodeApi";
import {
  DefaultOptionsState,
  type BrowsePackageInfo,
  type ExtensionToWebviewMessage,
  type NugetSource,
  type OperationStatus,
  type PackageGroupInfo,
  type PanelClientState,
  type ProjectError,
  type ProjectInfo,
  type TabKey
} from "./Types";

const Tabs: Array<{ key: TabKey; label: string }> = [
  { key: "browse", label: "BROWSE" },
  { key: "installed", label: "INSTALLED" },
  { key: "updates", label: "UPDATES" },
  { key: "consolidated", label: "CONSOLIDATED" },
  { key: "vulnerabilities", label: "VULNERABILITIES" }
];

export function App() {
  const vscode = UseVsCodeApi();
  const persistedState = vscode.getState() as PanelClientState | undefined;
  const [activeTab, setActiveTab] = useState<TabKey>(persistedState?.activeTab ?? "browse");
  const [searchTerm, setSearchTerm] = useState(persistedState?.searchTerm ?? "");
  const [includePrerelease, setIncludePrerelease] = useState(persistedState?.options.includePrerelease ?? DefaultOptionsState.includePrerelease);
  const [selectedSourceName, setSelectedSourceName] = useState(persistedState?.options.selectedSourceName ?? "");
  const [status, setStatus] = useState<OperationStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Ready.");
  const [solutionPath, setSolutionPath] = useState<string | undefined>();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [sources, setSources] = useState<NugetSource[]>([]);
  const [installedPackages, setInstalledPackages] = useState<PackageGroupInfo[]>([]);
  const [browsePackages, setBrowsePackages] = useState<BrowsePackageInfo[]>([]);
  const [errors, setErrors] = useState<ProjectError[]>([]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;

      switch (message.type) {
        case "stateChanged":
          setActiveTab(message.payload.activeTab);
          setSearchTerm(message.payload.searchTerm);
          setIncludePrerelease(message.payload.options.includePrerelease);
          setSelectedSourceName(message.payload.options.selectedSourceName);
          break;
        case "busyState":
          setStatus(message.payload.status);
          setStatusMessage(message.payload.message);
          break;
        case "workspaceLoaded":
          setSolutionPath(message.payload.solutionPath);
          setProjects(message.payload.projects);
          setSources(message.payload.sources);
          setInstalledPackages(message.payload.installedPackages);
          setErrors(message.payload.errors);
          setSelectedSourceName(message.payload.options.selectedSourceName);
          setIncludePrerelease(message.payload.options.includePrerelease);
          setStatus(message.payload.status);
          setStatusMessage(message.payload.message);
          break;
        case "browsePackagesLoaded":
          setBrowsePackages(message.payload.packages);
          setStatus(message.payload.status);
          setStatusMessage(message.payload.message);
          break;
        case "error":
          setStatus("error");
          setStatusMessage(message.payload.message);
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [vscode]);

  useEffect(() => {
    const state: PanelClientState = {
      activeTab,
      searchTerm,
      options: {
        selectedSourceName,
        includePrerelease
      }
    };

    vscode.setState(state);
    vscode.postMessage({ type: "syncState", payload: state });
  }, [activeTab, includePrerelease, searchTerm, selectedSourceName, vscode]);

  useEffect(() => {
    if (activeTab !== "browse") {
      return;
    }

    const timeout = window.setTimeout(() => {
      vscode.postMessage({
        type: "browsePackages",
        payload: {
          query: searchTerm,
          includePrerelease,
          sourceName: selectedSourceName
        }
      });
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [activeTab, includePrerelease, searchTerm, selectedSourceName, vscode]);

  const filteredInstalledPackages = useMemo(() => {
    const filter = searchTerm.trim().toLowerCase();

    return installedPackages.filter((packageGroup) => {
      if (!filter) {
        return true;
      }

      return (
        packageGroup.id.toLowerCase().includes(filter) ||
        packageGroup.projects.some((project) => project.projectName.toLowerCase().includes(filter) || project.relativeProjectPath.toLowerCase().includes(filter))
      );
    });
  }, [installedPackages, searchTerm]);

  const visibleGroups =
    activeTab === "consolidated"
      ? filteredInstalledPackages.filter((packageGroup) => !packageGroup.isConsolidated)
      : activeTab === "installed"
        ? filteredInstalledPackages
        : [];
  const selectedSource = sources.find((source) => source.name === selectedSourceName);

  const handleRefresh = () => {
    setStatus("loading");
    setStatusMessage("Loading .slnx projects and NuGet sources...");
    vscode.postMessage({ type: "refresh" });
  };

  const handleSourceChange = (value: string) => {
    setSelectedSourceName(value);
    vscode.postMessage({ type: "selectSource", payload: { sourceName: value } });
  };

  return (
    <div className="appShell">
      <main className="nugetWorkspace">
        <section className="packageColumn">
          <Toolbar
            activeTab={activeTab}
            searchTerm={searchTerm}
            includePrerelease={includePrerelease}
            installedCount={installedPackages.length}
            consolidatedCount={installedPackages.filter((packageGroup) => !packageGroup.isConsolidated).length}
            onTabChange={setActiveTab}
            onSearchChange={setSearchTerm}
            onPrereleaseChange={setIncludePrerelease}
            onRefresh={handleRefresh}
          />
          <div className="contentScroller">
            {activeTab === "browse" ? (
              <BrowseList packages={browsePackages} />
            ) : activeTab === "installed" || activeTab === "consolidated" ? (
              <InstalledList packageGroups={visibleGroups} />
            ) : activeTab === "updates" ? (
              <EmptyState title="Updates are not loaded yet." detail="Installed package detection is ready. Latest-version checks can be added on top of the selected source." />
            ) : (
              <EmptyState title="Vulnerabilities are not loaded yet." detail="This view is reserved for vulnerability data from the configured NuGet source or dotnet CLI." />
            )}
          </div>
        </section>
        <aside className="detailsPane">
          <section className="detailsSection">
            <h2>Sources</h2>
            <span className="sectionHint">NuGet sources</span>
            <select className="sourceSelect" value={selectedSourceName} onChange={(event) => handleSourceChange(event.target.value)}>
              {sources.map((source) => (
                <option key={source.name} value={source.name}>
                  {source.name}
                </option>
              ))}
            </select>
            <div className="sourceList">
              {sources.map((source) => (
                <button
                  key={source.name}
                  className={`sourceRow ${source.name === selectedSourceName ? "isActive" : ""}`}
                  type="button"
                  title={source.url}
                  onClick={() => handleSourceChange(source.name)}
                >
                  <span>{source.name}</span>
                  <code>{source.url}</code>
                </button>
              ))}
            </div>
            <button className="primaryButton" type="button" onClick={() => vscode.postMessage({ type: "openSettings" })}>
              Add source
            </button>
          </section>
          <section className="detailsSection">
            <h2>Workspace</h2>
            <dl className="statsList">
              <div>
                <dt>Projects</dt>
                <dd>{projects.length}</dd>
              </div>
              <div>
                <dt>Packages</dt>
                <dd>{installedPackages.length}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{selectedSource?.name || "None"}</dd>
              </div>
            </dl>
            {solutionPath ? <p className="pathText">{solutionPath}</p> : null}
          </section>
          {errors.length > 0 ? (
            <section className="detailsSection errorSection">
              <h2>Problems</h2>
              {errors.slice(0, 4).map((error) => (
                <p key={`${error.projectPath}-${error.message}`}>{error.message}</p>
              ))}
            </section>
          ) : null}
        </aside>
      </main>
      <footer className={`statusBar status-${status}`}>
        <strong>{status.toUpperCase()}</strong>
        <span>{statusMessage}</span>
      </footer>
    </div>
  );
}

function Toolbar({
  activeTab,
  searchTerm,
  includePrerelease,
  installedCount,
  consolidatedCount,
  onTabChange,
  onSearchChange,
  onPrereleaseChange,
  onRefresh
}: {
  activeTab: TabKey;
  searchTerm: string;
  includePrerelease: boolean;
  installedCount: number;
  consolidatedCount: number;
  onTabChange: (tab: TabKey) => void;
  onSearchChange: (value: string) => void;
  onPrereleaseChange: (value: boolean) => void;
  onRefresh: () => void;
}) {
  return (
    <header className="toolbar">
      <div className="tabs">
        <button className="iconButton" type="button" title="Refresh" onClick={onRefresh}>
          ↻
        </button>
        {Tabs.map((tab) => (
          <button key={tab.key} className={`tabButton ${activeTab === tab.key ? "isActive" : ""}`} type="button" onClick={() => onTabChange(tab.key)}>
            {tab.label}
            {tab.key === "installed" ? <span>{installedCount}</span> : null}
            {tab.key === "consolidated" ? <span>{consolidatedCount}</span> : null}
          </button>
        ))}
      </div>
      <div className="filters">
        <input className="searchInput" value={searchTerm} placeholder="Search packages..." onChange={(event) => onSearchChange(event.target.value)} />
        <label className="checkboxLabel">
          <input checked={includePrerelease} type="checkbox" onChange={(event) => onPrereleaseChange(event.target.checked)} />
          Prerelease
        </label>
        <select className="sortSelect" defaultValue="relevance">
          <option value="relevance">Relevance</option>
          <option value="downloads">Downloads</option>
          <option value="name">Name</option>
        </select>
      </div>
    </header>
  );
}

function BrowseList({ packages }: { packages: BrowsePackageInfo[] }) {
  if (packages.length === 0) {
    return <EmptyState title="No packages to show." detail="Search the selected NuGet source or refresh the workspace." />;
  }

  return (
    <div className="packageList">
      {packages.map((packageInfo) => (
        <article className="packageRow" key={packageInfo.id}>
          <div className="packageIcon">{packageInfo.iconUrl ? <img alt="" src={packageInfo.iconUrl} /> : <span>.NET</span>}</div>
          <div className="packageMain">
            <h3>
              {packageInfo.id}
              {packageInfo.verified ? <span className="verified">✓</span> : null}
            </h3>
            <p className="byline">{packageInfo.authors ? `by ${packageInfo.authors}` : "by unknown author"}</p>
            <p className="description">{packageInfo.description}</p>
            {packageInfo.downloads ? <p className="downloads">⇩ {packageInfo.downloads.toLocaleString()}</p> : null}
          </div>
          <strong className="versionText">{packageInfo.version}</strong>
        </article>
      ))}
    </div>
  );
}

function InstalledList({ packageGroups }: { packageGroups: PackageGroupInfo[] }) {
  if (packageGroups.length === 0) {
    return <EmptyState title="No installed packages found." detail="PackageReference entries are loaded from projects listed in the .slnx file." />;
  }

  return (
    <div className="packageList">
      {packageGroups.map((packageGroup) => (
        <article className="packageRow installedRow" key={packageGroup.id}>
          <div className="packageIcon">
            <span>.NET</span>
          </div>
          <div className="packageMain">
            <h3>{packageGroup.id}</h3>
            <p className="description">{packageGroup.projects.length} project(s)</p>
            <div className="projectChips">
              {packageGroup.projects.slice(0, 5).map((project) => (
                <span key={`${project.projectId}-${project.version}`}>{project.projectName}</span>
              ))}
            </div>
          </div>
          <strong className={`versionText ${packageGroup.isConsolidated ? "" : "warningText"}`}>{packageGroup.versions.join(", ")}</strong>
        </article>
      ))}
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="emptyState">
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
