import { ALL_SOURCES, APP_TABS } from "../Constants/AppConstants";
import type { PackageGroupInfo, NugetSource, TabKey } from "../Types";

export type BusyAction = "" | "refresh" | "bulk" | "install" | "uninstall" | "source" | "generic";

export function Toolbar(props: {
  activeTab: TabKey;
  actionBusy: BusyAction;
  tabLoading: Partial<Record<TabKey, boolean>>;
  bulkSelectedPackageIds: Set<string>;
  includePrerelease: boolean;
  installedPackages: PackageGroupInfo[];
  infoOpen: boolean;
  searchTerm: string;
  selectedSourceName: string;
  settingsOpen: boolean;
  sources: NugetSource[];
  visibleGroups: PackageGroupInfo[];
  onBulkAction: () => void;
  onChangePrerelease: (value: boolean) => void;
  onChangeSearch: (value: string) => void;
  onChangeSource: (value: string) => void;
  onRefresh: () => void;
  onSelectTab: (tab: TabKey) => void;
  onToggleInfo: () => void;
  onToggleSettings: () => void;
  onToggleVisibleBulkPackages: () => void;
}) {
  const updatesCount = props.installedPackages.filter((packageGroup) => packageGroup.hasUpdateInAllSources ?? packageGroup.hasUpdate).length;
  const consolidatedCount = props.installedPackages.filter((packageGroup) => !packageGroup.isConsolidated).length;
  const vulnerabilitiesCount = props.installedPackages.filter((packageGroup) => packageGroup.vulnerabilities.length > 0).length;
  const sourceProblemCount = props.sources.filter((source) => source.enabled && source.healthStatus === "error").length;
  const disabledSourceProblemCount = props.sources.filter((source) => !source.enabled && source.healthStatus === "error").length;
  const selectableSources = props.sources.filter((source) => source.enabled && source.healthStatus !== "error");
  const selectedPackageCount = props.visibleGroups.filter((group) => props.bulkSelectedPackageIds.has(group.id)).length;
  const allPackagesSelected = props.visibleGroups.length > 0 && props.visibleGroups.every((group) => props.bulkSelectedPackageIds.has(group.id));

  return (
    <header className="toolbar">
      <div className="tabs">
        {APP_TABS.map((tab) => {
          const count = tab.key === "updates" ? updatesCount : tab.key === "consolidated" ? consolidatedCount : tab.key === "vulnerabilities" ? vulnerabilitiesCount : 0;
          const isTabLoading = Boolean(props.tabLoading[tab.key]);
          return (
            <button key={tab.key} className={`tabButton ${props.activeTab === tab.key ? "isActive" : ""}`} type="button" onClick={() => props.onSelectTab(tab.key)}>
              {tab.label}
              {isTabLoading ? <span className="tabLoadingSpinner"><Spinner /></span> : null}
              {count > 0 ? <span className={tab.key === "vulnerabilities" ? "warningTabBadge" : ""}>{tab.key === "vulnerabilities" ? `! ${count}` : count}</span> : null}
            </button>
          );
        })}
        <button className="iconButton refreshButton" type="button" title="Refresh" onClick={props.onRefresh}>{props.actionBusy === "refresh" ? <Spinner /> : null}</button>
        <button className={`iconButton infoButton ${props.infoOpen ? "isActive" : ""}`} type="button" title="Info" onClick={props.onToggleInfo}>i</button>
        <button className={`iconButton gearButton ${props.settingsOpen ? "isActive" : ""}`} type="button" title="Settings" onClick={props.onToggleSettings}>Settings{disabledSourceProblemCount > 0 ? <span className="toolbarWarningBadge" aria-label="Disabled source problems">!</span> : null}{sourceProblemCount > 0 ? <span className="toolbarAlertBadge">{sourceProblemCount}</span> : null}</button>
      </div>
      <div className="filters">
        <div className="searchBox">
          <input className="searchInput" value={props.searchTerm} placeholder="Search packages..." data-input="search" onChange={(event) => props.onChangeSearch(event.target.value)} />
          {props.searchTerm ? <button className="clearSearchButton" type="button" title="Clear search" onClick={() => props.onChangeSearch("")}>x</button> : null}
        </div>
        <label className="checkboxLabel">
          <input checked={props.includePrerelease} type="checkbox" onChange={(event) => props.onChangePrerelease(event.target.checked)} />
          Prerelease
        </label>
        <span className="toolbarSpacer" />
        <select className="sourceSelect toolbarSourceSelect" aria-label="NuGet source" value={props.selectedSourceName || ALL_SOURCES} onChange={(event) => props.onChangeSource(event.target.value)}>
          <option value={ALL_SOURCES}>All</option>
          {selectableSources.map((source) => <option key={source.name} value={source.name}>{source.name}</option>)}
        </select>
        {(props.activeTab === "updates" || props.activeTab === "consolidated") ? (
          <div className="toolbarBulkActions">
            <button className="primaryButton" type="button" disabled={selectedPackageCount === 0} onClick={props.onBulkAction}>
              {props.actionBusy === "bulk" ? <Spinner /> : null} {props.activeTab === "updates" ? "Update" : "Consolidate"}
            </button>
            <button className="secondaryButton" type="button" disabled={props.visibleGroups.length === 0} onClick={props.onToggleVisibleBulkPackages}>
              {allPackagesSelected ? "Unselect all" : "Select all"}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
