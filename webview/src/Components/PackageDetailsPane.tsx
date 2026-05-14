import type { PreviewTab, SelectedPackageContext } from "../AppTypes";
import type { BusyAction } from "./Toolbar";
import type { PackageDetailsInfo, ProjectInfo, TabKey } from "../Types";
import { PackageDetailsTab, PackageIcon, PackageMetaStrip, ReadmeTab, Spinner } from "./Common";

export function PackageDetailsPane(props: {
    activeTab: TabKey;
    actionBusy: BusyAction;
    details?: PackageDetailsInfo;
    detailsLoading: boolean;
    packageInfo: SelectedPackageContext;
    previewTab: PreviewTab;
    projects: ProjectInfo[];
    selectedPackageVersion: string;
    selectedProjectIds: Set<string>;
    selectedSourceLabel: string;
    onChangePreviewTab: (tab: PreviewTab) => void;
    onChangeSelectedVersion: (version: string) => void;
    onInstall: (version: string) => void;
    onToggleAllProjects: () => void;
    onToggleProject: (projectId: string, selected: boolean) => void;
    onToggleSettings: () => void;
    onUninstall: () => void;
}) {
    const versions = props.details?.availableVersions.length ? props.details.availableVersions : (props.packageInfo.versions.length > 0 ? props.packageInfo.versions : [props.packageInfo.version]);
    const installedVersionSet = new Set((props.packageInfo.projects ?? []).map((project) => project.version).filter((version) => version.length > 0));
    const installedVersions = props.packageInfo.versions.filter((version, index, allVersions) => installedVersionSet.has(version) && allVersions.indexOf(version) === index);
    const installedVersion = installedVersions.length > 0
        ? installedVersions.join(", ")
        : (props.packageInfo.projects?.[0]?.version ?? "");
    const installButtonBusy = props.actionBusy === "install";
    const uninstallButtonBusy = props.actionBusy === "uninstall";
    const isActionInProgress = props.actionBusy !== "";
    const selectedProjectCount = props.selectedProjectIds.size;

    return (
        <section className="packagePreview" data-testid="package-details-pane">
            <div className="previewStickyHeader">
                <div className="previewHeader">
                    <PackageIcon iconUrl={props.packageInfo.iconUrl} preview />
                    <div>
                        <h2 data-testid="selected-package-title">{props.packageInfo.id}</h2>
                        <p className="byline">{props.selectedSourceLabel}</p>
                    </div>
                </div>
                <PackageMetaStrip downloads={props.packageInfo.downloads} verified={Boolean(props.packageInfo.verified)} />
            </div>
            <ActionForm
                activeTab={props.activeTab}
                installBusy={installButtonBusy}
                installedVersion={installedVersion}
                selectedProjectCount={selectedProjectCount}
                selectedVersion={props.selectedPackageVersion}
                uninstallBusy={uninstallButtonBusy}
                controlsDisabled={isActionInProgress}
                versions={versions}
                onChangeVersion={props.onChangeSelectedVersion}
                onInstall={props.onInstall}
                onUninstall={props.onUninstall}
            />
            <div className="mappingNotice">Package source mapping is off. <button className="linkButton" type="button" onClick={props.onToggleSettings}>Configure</button></div>
            <ProjectVersionTable activeTab={props.activeTab} controlsDisabled={isActionInProgress} packageInfo={props.packageInfo} projects={props.projects} selectedProjectIds={props.selectedProjectIds} selectedVersion={props.selectedPackageVersion} onToggleAllProjects={props.onToggleAllProjects} onToggleProject={props.onToggleProject} />
            <div className="previewTabs">
                <button className={`previewTab ${props.previewTab === "readme" ? "isActive" : ""}`} data-testid="preview-tab-readme" type="button" onClick={() => props.onChangePreviewTab("readme")}>README</button>
                <button className={`previewTab ${props.previewTab === "details" ? "isActive" : ""}`} data-testid="preview-tab-details" type="button" onClick={() => props.onChangePreviewTab("details")}>Package Details</button>
            </div>
            {props.previewTab === "readme" ? <ReadmeTab details={props.details} loading={props.detailsLoading} packageInfo={props.packageInfo} /> : <PackageDetailsTab details={props.details} loading={props.detailsLoading} packageInfo={props.packageInfo} selectedVersion={props.selectedPackageVersion} />}
        </section>
    );
}

function ActionForm(props: {
    activeTab: TabKey;
    controlsDisabled: boolean;
    installBusy: boolean;
    installedVersion: string;
    selectedProjectCount: number;
    selectedVersion: string;
    uninstallBusy: boolean;
    versions: string[];
    onChangeVersion: (version: string) => void;
    onInstall: (version: string) => void;
    onUninstall: () => void;
}) {
    const versionSelect = (
        <select className="sourceSelect" data-testid="package-version-select" disabled={props.controlsDisabled} value={props.selectedVersion} onChange={(event) => props.onChangeVersion(event.target.value)}>
            {props.versions.map((version) => <option key={version} value={version}>{version}</option>)}
        </select>
    );
    const installButton = (label: string) => (
        <button className="primaryButton" data-testid="package-install-action" disabled={props.controlsDisabled || props.selectedProjectCount === 0 || props.installBusy} type="button" onClick={() => props.onInstall(props.selectedVersion)}>
            {props.installBusy ? <Spinner /> : null} {label}
        </button>
    );
    const uninstallButton = props.activeTab === "browse"
        ? null
        : (
            <button className="dangerButton" disabled={props.controlsDisabled || props.selectedProjectCount === 0 || props.uninstallBusy} type="button" onClick={props.onUninstall}>
                {props.uninstallBusy ? <Spinner /> : null} Uninstall
            </button>
        );

    if (props.activeTab === "browse") {
        return <div className="previewFormGrid browseFormGrid"><label>Version:{versionSelect}</label>{installButton("Install")}</div>;
    }

    if (props.activeTab === "updates") {
        return <div className="previewFormGrid updateFormGrid"><label>Installed:<input className="textInput" data-testid="installed-versions-input" value={props.installedVersion} readOnly /></label><label>Update to:{versionSelect}</label>{installButton("Update")}{uninstallButton}</div>;
    }

    if (props.activeTab === "consolidated") {
        return <div className="previewFormGrid installedFormGrid"><label>Consolidate to:{versionSelect}</label>{installButton("Consolidate")}{uninstallButton}</div>;
    }

    return <div className="previewFormGrid installedFormGrid"><label>Version:{versionSelect}</label>{installButton("Install")}{uninstallButton}</div>;
}

function ProjectVersionTable(props: {
    activeTab: TabKey;
    controlsDisabled: boolean;
    packageInfo: SelectedPackageContext;
    projects: ProjectInfo[];
    selectedProjectIds: Set<string>;
    selectedVersion: string;
    onToggleAllProjects: () => void;
    onToggleProject: (projectId: string, selected: boolean) => void;
}) {
    const packageProjects = props.packageInfo.projects ?? [];

    if (props.activeTab === "browse" && props.projects.length === 0) {
        return null;
    }

    if (props.activeTab !== "browse" && packageProjects.length === 0 && props.projects.length === 0) {
        return null;
    }

    const installedProjectsById = new Map(
        packageProjects.map((project) => [project.projectId, project] as const)
    );

    const rows = props.activeTab === "browse"
        ? props.projects.map((project) => {
            const installedProject = installedProjectsById.get(project.id);

            return {
                projectId: project.id,
                projectName: project.name,
                currentVersion: installedProject?.version ?? "",
                path: project.relativePath
            };
        })
        : packageProjects.length > 0
            ? packageProjects.map((project) => ({ projectId: project.projectId, projectName: project.projectName, currentVersion: project.version, path: project.relativeProjectPath }))
            : props.projects.map((project) => ({ projectId: project.id, projectName: project.name, currentVersion: "", path: project.relativePath }));

    return (
        <div className="versionsPanel">
            <div className="projectSelectHeader"><strong>Projects</strong><button className="linkButton" type="button" disabled={props.controlsDisabled} onClick={props.onToggleAllProjects}>Toggle all</button></div>
            <div className="projectVersionTable">
                <div className="projectVersionHeader"><span></span><span>Project</span><span>Current</span><span>Target</span><span>Path</span></div>
                <div className="projectVersionScroller">
                    {rows.map((row) => (
                        <label key={row.projectId} className="projectVersionRow">
                            <input checked={props.selectedProjectIds.has(row.projectId)} disabled={props.controlsDisabled} type="checkbox" onChange={(event) => props.onToggleProject(row.projectId, event.target.checked)} />
                            <span>{row.projectName}</span>
                            <span>{row.currentVersion || "-"}</span>
                            <span>{props.selectedProjectIds.has(row.projectId) ? props.selectedVersion : "-"}</span>
                            <span title={row.path}>{row.path}</span>
                        </label>
                    ))}
                </div>
            </div>
        </div>
    );
}