import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PreviewTab, SelectedPackageContext, SourceDraft } from "./AppTypes";
import {
    getBulkPackageItems,
    getLatestVersionForSource,
    getSelectedPackageContext,
    getSelectedSourceLabel,
    getVisibleInstalledGroups,
    inferBusyAction,
    mergePackages,
    packageDetailsKey,
    toggleVisibleBulkPackages
} from "./AppUtils";
import { BrowsePackageList } from "./Components/BrowsePackageList";
import { LoadingState } from "./Components/Common";
import { InstalledPackageList } from "./Components/InstalledPackageList";
import { PackageDetailsPane } from "./Components/PackageDetailsPane";
import { InfoPane, WorkspacePane } from "./Components/SidebarPanes";
import { SourceSettingsPane } from "./Components/SourceSettingsPane";
import { Toolbar, type BusyAction } from "./Components/Toolbar";
import { ALL_SOURCES, BROWSE_PAGE_SIZE } from "./Constants/AppConstants";
import { UseVsCodeApi } from "./Hooks/UseVsCodeApi";
import type {
    BrowsePackageInfo,
    ExtensionToWebviewMessage,
    NugetSource,
    OperationStatus,
    PackageDetailsInfo,
    PackageGroupInfo,
    PanelClientState,
    ProjectError,
    ProjectInfo,
    SourceAuthMode,
    TabKey,
    WorkspaceSettingsState
} from "./Types";

export function App() {
    const vscode = UseVsCodeApi();
    const persistedState = vscode.getState() as PanelClientState | undefined;
    const [activeTab, setActiveTab] = useState<TabKey>(persistedState?.activeTab ?? "browse");
    const [searchTerm, setSearchTerm] = useState(persistedState?.searchTerm ?? "");
    const [includePrerelease, setIncludePrerelease] = useState(persistedState?.options.includePrerelease ?? false);
    const [selectedSourceName, setSelectedSourceName] = useState(persistedState?.options.selectedSourceName ?? ALL_SOURCES);
    const [selectedPackageId, setSelectedPackageId] = useState("");
    const [selectedPackageVersion, setSelectedPackageVersion] = useState("");
    const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
    const [bulkSelectedPackageIds, setBulkSelectedPackageIds] = useState<Set<string>>(new Set());
    const [bulkSelectionKey, setBulkSelectionKey] = useState("");
    const [previewTab, setPreviewTab] = useState<PreviewTab>("details");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [infoOpen, setInfoOpen] = useState(false);
    const [sourceFormOpen, setSourceFormOpen] = useState(false);
    const [sourceEditName, setSourceEditName] = useState("");
    const [sourceAuthMode, setSourceAuthMode] = useState<SourceAuthMode>("none");
    const [sourceDraft, setSourceDraft] = useState<SourceDraft>({ name: "", url: "", username: "", password: "" });
    const [status, setStatus] = useState<OperationStatus>("loading");
    const [statusMessage, setStatusMessage] = useState("Loading workspace projects and NuGet sources...");
    const [actionBusy, setActionBusy] = useState<BusyAction>("refresh");
    const [workspaceRefreshPending, setWorkspaceRefreshPending] = useState(true);
    const [updatesDataPending, setUpdatesDataPending] = useState(false);
    const [vulnerabilitiesDataPending, setVulnerabilitiesDataPending] = useState(false);
    const [solutionPath, setSolutionPath] = useState("");
    const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettingsState>({ useAllProjects: false, solutionPath: "", availableSolutions: [] });
    const [projects, setProjects] = useState<ProjectInfo[]>([]);
    const [sources, setSources] = useState<NugetSource[]>([]);
    const [installedPackages, setInstalledPackages] = useState<PackageGroupInfo[]>([]);
    const [browsePackages, setBrowsePackages] = useState<BrowsePackageInfo[]>([]);
    const [browseSkip, setBrowseSkip] = useState(0);
    const [browseHasMore, setBrowseHasMore] = useState(false);
    const [browseLoading, setBrowseLoading] = useState(true);
    const [packageDetails, setPackageDetails] = useState<Record<string, PackageDetailsInfo>>({});
    const [packageDetailsLoading, setPackageDetailsLoading] = useState<Record<string, boolean>>({});
    const [sourceActionName, setSourceActionName] = useState("");
    const [errors, setErrors] = useState<ProjectError[]>([]);
    const [errorDetails, setErrorDetails] = useState("");
    const [errorLogOpen, setErrorLogOpen] = useState(false);
    const browseTimerRef = useRef<number | undefined>(undefined);
    const sourceChangeTimerRef = useRef<number | undefined>(undefined);
    const refreshFrameRef = useRef<number | undefined>(undefined);
    const browseAppendInFlightRef = useRef(false);
    const browseRequestIdRef = useRef(0);
    const refreshRequestIdRef = useRef(0);
    const pendingRefreshRequestIdRef = useRef<number | undefined>(undefined);

    const postClientState = useCallback(
        (nextActiveTab = activeTab, nextSearchTerm = searchTerm, nextSelectedSourceName = selectedSourceName, nextIncludePrerelease = includePrerelease) => {
            const payload: PanelClientState = {
                activeTab: nextActiveTab,
                searchTerm: nextSearchTerm,
                options: {
                    selectedSourceName: nextSelectedSourceName,
                    includePrerelease: nextIncludePrerelease
                }
            };

            vscode.setState(payload);
            vscode.postMessage({ type: "syncState", payload });
        },
        [activeTab, includePrerelease, searchTerm, selectedSourceName, vscode]
    );

    const visibleGroups = useMemo(
        () => getVisibleInstalledGroups(installedPackages, activeTab, searchTerm, selectedSourceName),
        [activeTab, installedPackages, searchTerm, selectedSourceName]
    );

    const scheduleBrowse = useCallback(
        (options: { append?: boolean; immediate?: boolean; query?: string; sourceName?: string; prerelease?: boolean; force?: boolean } = {}) => {
            window.clearTimeout(browseTimerRef.current);

            if (activeTab !== "browse" && !options.force) {
                return;
            }

            const append = Boolean(options.append);
            const skip = append ? browseSkip : 0;

            if (append && browseAppendInFlightRef.current) {
                return;
            }

            if (append) {
                browseAppendInFlightRef.current = true;
            }

            if (!append) {
                setBrowseSkip(0);
                setBrowseHasMore(false);
            }

            setBrowseLoading(true);
            setStatus("loading");
            setStatusMessage("Loading packages...");

            browseTimerRef.current = window.setTimeout(
                () => {
                    const requestId = browseRequestIdRef.current + 1;
                    browseRequestIdRef.current = requestId;

                    vscode.postMessage({
                        type: "browsePackages",
                        payload: {
                            query: options.query ?? searchTerm,
                            includePrerelease: options.prerelease ?? includePrerelease,
                            sourceName: options.sourceName ?? selectedSourceName,
                            skip,
                            take: BROWSE_PAGE_SIZE,
                            append,
                            requestId
                        }
                    });
                },
                options.immediate ? 0 : 350
            );
        },
        [activeTab, browseSkip, includePrerelease, searchTerm, selectedSourceName, vscode]
    );

    const selectedPackage = useMemo<SelectedPackageContext | undefined>(
        () => getSelectedPackageContext(activeTab, selectedPackageId, selectedPackageVersion, browsePackages, installedPackages, selectedSourceName),
        [activeTab, browsePackages, installedPackages, selectedPackageId, selectedPackageVersion, selectedSourceName]
    );

    const requestPackageDetails = useCallback(
        (packageInfo: SelectedPackageContext | undefined, version: string) => {
            if (!packageInfo || !version) {
                return;
            }

            const key = packageDetailsKey(packageInfo.id, version);

            if (packageDetails[key] || packageDetailsLoading[key]) {
                return;
            }

            setPackageDetailsLoading((current) => ({ ...current, [key]: true }));
            setStatus("loading");
            setStatusMessage(`Loading metadata for ${packageInfo.id} ${version}...`);
            vscode.postMessage({ type: "loadPackageDetails", payload: { packageId: packageInfo.id, version, sourceName: selectedSourceName, includePrerelease } });
        },
        [includePrerelease, packageDetails, packageDetailsLoading, selectedSourceName, vscode]
    );

    useEffect(() => {
        const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
            const message = event.data;

            if (message.type === "stateChanged") {
                setActiveTab(message.payload.activeTab);
                setSearchTerm(message.payload.searchTerm);
                setIncludePrerelease(message.payload.options.includePrerelease);
                setSelectedSourceName(message.payload.options.selectedSourceName);
                return;
            }

            if (message.type === "busyState") {
                const nextBusyAction = message.payload.status === "loading" ? inferBusyAction(message.payload.message) : "";

                setStatus(message.payload.status);
                setStatusMessage(message.payload.message);
                setActionBusy(nextBusyAction);
                if (nextBusyAction === "refresh") {
                    setWorkspaceRefreshPending(true);
                }
                setSourceActionName((current) => (message.payload.status === "loading" ? current : ""));
                return;
            }

            if (message.type === "workspaceLoaded") {
                if (pendingRefreshRequestIdRef.current !== undefined && message.payload.requestId !== pendingRefreshRequestIdRef.current) {
                    return;
                }

                pendingRefreshRequestIdRef.current = undefined;
                setWorkspaceRefreshPending(false);
                setUpdatesDataPending(Boolean(message.payload.updatesDataPending));
                setVulnerabilitiesDataPending(Boolean(message.payload.vulnerabilitiesDataPending));
                const nextSelectedSourceName = selectedSourceName === ALL_SOURCES || message.payload.sources.some((source) => source.name === selectedSourceName)
                    ? selectedSourceName
                    : message.payload.options.selectedSourceName;
                setSolutionPath(message.payload.solutionPath || "");
                setWorkspaceSettings(message.payload.workspaceSettings);
                setProjects(message.payload.projects);
                setSources(message.payload.sources);
                setInstalledPackages(message.payload.installedPackages);
                setErrors(message.payload.errors);
                setSelectedSourceName(nextSelectedSourceName);
                setIncludePrerelease(message.payload.options.includePrerelease);
                setStatus(message.payload.status);
                setStatusMessage(message.payload.message);
                setActionBusy("");
                setSourceActionName("");
                setBulkSelectionKey("");

                if (message.payload.status !== "error") {
                    setErrorDetails("");
                    setErrorLogOpen(false);
                }

                // Keep settings form open during background refresh updates.
                // Close it only after source add/update/remove workflows complete.
                if (actionBusy === "source") {
                    setSourceFormOpen(false);
                }

                if (activeTab === "browse") {
                    scheduleBrowse({ immediate: true, query: searchTerm, sourceName: nextSelectedSourceName, prerelease: message.payload.options.includePrerelease });
                }

                return;
            }

            if (message.type === "browsePackagesLoaded") {
                if (typeof message.payload.requestId === "number" && message.payload.requestId !== browseRequestIdRef.current) {
                    return;
                }

                browseAppendInFlightRef.current = false;
                setBrowsePackages((current) => (message.payload.append ? mergePackages(current, message.payload.packages) : message.payload.packages));
                setBrowseSkip(message.payload.skip + message.payload.packages.length);
                setBrowseHasMore(message.payload.hasMore);
                setBrowseLoading(false);
                setStatus(message.payload.status);
                setStatusMessage(message.payload.status === "success" ? `Loaded package results${message.payload.hasMore ? ". Scroll for more." : "."}` : message.payload.message);
                return;
            }

            if (message.type === "packageDetailsLoaded") {
                const key = packageDetailsKey(message.payload.details.id, message.payload.details.version);
                setPackageDetails((current) => ({ ...current, [key]: message.payload.details }));
                setPackageDetailsLoading((current) => ({ ...current, [key]: false }));
                setStatus(message.payload.status);
                setStatusMessage(message.payload.message);
                return;
            }

            if (message.type === "error") {
                pendingRefreshRequestIdRef.current = undefined;
                setWorkspaceRefreshPending(false);
                setUpdatesDataPending(false);
                setVulnerabilitiesDataPending(false);
                browseAppendInFlightRef.current = false;
                setStatus("error");
                setStatusMessage(message.payload.message);
                setErrorDetails(message.payload.details ?? "");
                setErrorLogOpen(false);
                setActionBusy("");
                setSourceActionName("");
                setBrowseLoading(false);
                setPackageDetailsLoading({});
            }
        };

        window.addEventListener("message", handleMessage);
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, [scheduleBrowse, searchTerm, vscode]);

    useEffect(() => () => {
        window.clearTimeout(browseTimerRef.current);
        window.clearTimeout(sourceChangeTimerRef.current);
        window.cancelAnimationFrame(refreshFrameRef.current ?? 0);
    }, []);

    useEffect(() => {
        vscode.postMessage({ type: "ready" });
    }, [vscode]);

    useEffect(() => {
        if (activeTab !== "updates" && activeTab !== "consolidated") {
            setBulkSelectedPackageIds(new Set());
            setBulkSelectionKey("");
            return;
        }

        const nextKey = `${activeTab}|${searchTerm.trim().toLowerCase()}|${visibleGroups.map((group) => group.id).join("|")}`;

        if (nextKey !== bulkSelectionKey) {
            setBulkSelectedPackageIds(new Set(visibleGroups.map((group) => group.id)));
            setBulkSelectionKey(nextKey);
            return;
        }

        const visibleIds = new Set(visibleGroups.map((group) => group.id));
        setBulkSelectedPackageIds((current) => new Set(Array.from(current).filter((id) => visibleIds.has(id))));
    }, [activeTab, bulkSelectionKey, searchTerm, visibleGroups]);

    useEffect(() => {
        if (selectedPackage) {
            requestPackageDetails(selectedPackage, selectedPackageVersion || selectedPackage.version);
        }
    }, [requestPackageDetails, selectedPackage, selectedPackageVersion]);

    const selectTab = (tab: TabKey) => {
        setActiveTab(tab);
        setSelectedPackageId("");
        setSelectedPackageVersion("");
        setSelectedProjectIds(new Set());
        setPreviewTab("details");
        setSettingsOpen(false);
        setInfoOpen(false);
        postClientState(tab);

        if (tab === "browse") {
            scheduleBrowse({ immediate: true, force: true });
        }
    };

    const refresh = () => {
        const requestId = refreshRequestIdRef.current + 1;
        refreshRequestIdRef.current = requestId;
        pendingRefreshRequestIdRef.current = requestId;
        setWorkspaceRefreshPending(true);
        setUpdatesDataPending(false);
        setVulnerabilitiesDataPending(false);
        setStatus("loading");
        setStatusMessage("Loading workspace projects and NuGet sources...");
        setActionBusy("refresh");
        setErrorDetails("");
        setErrorLogOpen(false);
        setBrowsePackages([]);
        setBrowseSkip(0);
        setBrowseHasMore(false);
        setBrowseLoading(true);
        window.cancelAnimationFrame(refreshFrameRef.current ?? 0);
        refreshFrameRef.current = window.requestAnimationFrame(() => {
            vscode.postMessage({ type: "refresh", payload: { requestId } });
        });
    };

    const changeSearch = (value: string) => {
        setSearchTerm(value);
        postClientState(activeTab, value);
        if (activeTab === "browse") {
            scheduleBrowse({ query: value });
        }
    };

    const changePrerelease = (value: boolean) => {
        setIncludePrerelease(value);
        postClientState(activeTab, searchTerm, selectedSourceName, value);
        scheduleBrowse({ prerelease: value });
    };

    const changeSource = (value: string) => {
        window.clearTimeout(sourceChangeTimerRef.current);
        setSelectedSourceName(value);
        postClientState(activeTab, searchTerm, value);
        setSelectedPackageId("");
        setSelectedPackageVersion("");
        setSelectedProjectIds(new Set());
        setPreviewTab("details");
        setErrorDetails("");
        setErrorLogOpen(false);

        if (activeTab === "browse") {
            setBrowsePackages([]);
            setBrowseSkip(0);
            setBrowseHasMore(false);
            setBrowseLoading(true);
            setStatus("loading");
            setStatusMessage("Loading packages...");
            scheduleBrowse({ sourceName: value, immediate: true });
        } else {
            setStatus("success");
            setStatusMessage(`Showing packages from ${value === ALL_SOURCES ? "all sources" : value}.`);
            setActionBusy("");
        }

        sourceChangeTimerRef.current = window.setTimeout(() => {
            vscode.postMessage({ type: "selectSource", payload: { sourceName: value } });
        }, 150);
    };

    const selectBrowsePackage = (packageInfo: BrowsePackageInfo) => {
        const installedPackage = installedPackages.find((packageGroup) => packageGroup.id === packageInfo.id);
        setSelectedPackageId(packageInfo.id);
        setSelectedPackageVersion(packageInfo.version);
        setSelectedProjectIds(new Set((installedPackage?.projects ?? []).map((project) => project.projectId)));
        setSettingsOpen(false);
        setInfoOpen(false);
        setPreviewTab("details");
    };

    const selectInstalledPackage = (packageGroup: PackageGroupInfo) => {
        const latestVersion = getLatestVersionForSource(packageGroup, selectedSourceName);
        const version = activeTab === "updates" ? latestVersion || packageGroup.versions.at(-1) || packageGroup.versions[0] || "" : packageGroup.versions.at(-1) || packageGroup.versions[0] || "";
        setSelectedPackageId(packageGroup.id);
        setSelectedPackageVersion(version);
        setSelectedProjectIds(new Set(packageGroup.projects.map((project) => project.projectId)));
        setSettingsOpen(false);
        setInfoOpen(false);
        setPreviewTab("details");
    };

    const bulkItems = getBulkPackageItems(activeTab, visibleGroups, bulkSelectedPackageIds, selectedSourceName);
    const details = selectedPackage ? packageDetails[packageDetailsKey(selectedPackage.id, selectedPackageVersion || selectedPackage.version)] : undefined;
    const detailsLoading = selectedPackage ? Boolean(packageDetailsLoading[packageDetailsKey(selectedPackage.id, selectedPackageVersion || selectedPackage.version)]) : false;
    const selectableProjectIds = useMemo(() => {
        if (!selectedPackage) {
            return [] as string[];
        }

        if (activeTab === "browse") {
            return projects.map((project) => project.id);
        }

        const packageProjectIds = (selectedPackage.projects ?? []).map((project) => project.projectId);
        return packageProjectIds.length > 0 ? packageProjectIds : projects.map((project) => project.id);
    }, [activeTab, projects, selectedPackage]);
    const isWorkspaceReloading = workspaceRefreshPending;
    const isBackgroundTabLoading = !isWorkspaceReloading
        && ((activeTab === "updates" && updatesDataPending) || (activeTab === "vulnerabilities" && vulnerabilitiesDataPending));
    const tabLoading = {
        browse: activeTab === "browse" && browseLoading,
        installed: isWorkspaceReloading,
        updates: isWorkspaceReloading || updatesDataPending,
        consolidated: isWorkspaceReloading,
        vulnerabilities: isWorkspaceReloading || vulnerabilitiesDataPending
    } as const;
    const toolbarBusyAction: BusyAction = isWorkspaceReloading ? "refresh" : actionBusy;

    return (
        <div className="appShell">
            <main className="nugetWorkspace">
                <section className="packageColumn">
                    <Toolbar
                        activeTab={activeTab}
                        actionBusy={toolbarBusyAction}
                        tabLoading={tabLoading}
                        bulkSelectedPackageIds={bulkSelectedPackageIds}
                        includePrerelease={includePrerelease}
                        installedPackages={installedPackages}
                        onBulkAction={() => {
                            if (bulkItems.length === 0) {
                                setStatus("error");
                                setStatusMessage("Select packages before running bulk update.");
                                return;
                            }
                            setActionBusy("bulk");
                            setStatus("loading");
                            setStatusMessage("Updating selected package references...");
                            setErrorDetails("");
                            vscode.postMessage({ type: "bulkInstallPackages", payload: { items: bulkItems, sourceName: selectedSourceName } });
                        }}
                        onChangePrerelease={changePrerelease}
                        onChangeSearch={changeSearch}
                        onChangeSource={changeSource}
                        onRefresh={refresh}
                        onSelectTab={selectTab}
                        onToggleInfo={() => {
                            setInfoOpen((current) => !current);
                            setSettingsOpen(false);
                        }}
                        onToggleSettings={() => {
                            setSettingsOpen((current) => !current);
                            setInfoOpen(false);
                        }}
                        onToggleVisibleBulkPackages={() => toggleVisibleBulkPackages(visibleGroups, setBulkSelectedPackageIds)}
                        searchTerm={searchTerm}
                        selectedSourceName={selectedSourceName}
                        sources={sources}
                        visibleGroups={visibleGroups}
                        infoOpen={infoOpen}
                        settingsOpen={settingsOpen}
                    />
                    <div className="contentScroller" onScroll={(event) => {
                        const element = event.currentTarget;
                        if (activeTab === "browse" && element.scrollTop + element.clientHeight >= element.scrollHeight - 120 && browseHasMore && !browseLoading) {
                            scheduleBrowse({ append: true, immediate: true });
                        }
                    }}>
                        {activeTab === "browse" ? (
                            <BrowsePackageList
                                browseHasMore={browseHasMore}
                                browseLoading={browseLoading}
                                packages={browsePackages}
                                selectedPackageId={selectedPackageId}
                                onLoadMore={() => scheduleBrowse({ append: true, immediate: true })}
                                onSelect={selectBrowsePackage}
                            />
                        ) : isWorkspaceReloading ? (
                            <LoadingState message="Loading workspace packages..." />
                        ) : isBackgroundTabLoading ? (
                            <LoadingState message={activeTab === "updates" ? "Loading available updates..." : "Loading vulnerability data..."} />
                        ) : (
                            <InstalledPackageList
                                activeTab={activeTab}
                                bulkSelectedPackageIds={bulkSelectedPackageIds}
                                groups={visibleGroups}
                                searchTerm={searchTerm}
                                selectedPackageId={selectedPackageId}
                                onBulkSelectionChange={(packageId, selected) => setBulkSelectedPackageIds((current) => {
                                    const next = new Set(current);
                                    if (selected) {
                                        next.add(packageId);
                                    } else {
                                        next.delete(packageId);
                                    }
                                    return next;
                                })}
                                onSelect={selectInstalledPackage}
                            />
                        )}
                    </div>
                </section>
                <aside className="detailsPane">
                    {infoOpen ? (
                        <InfoPane />
                    ) : isWorkspaceReloading ? (
                        <LoadingState message="Refreshing package data..." />
                    ) : settingsOpen ? (
                        <SourceSettingsPane
                            actionBusy={actionBusy}
                            selectedSourceName={selectedSourceName}
                            sourceActionName={sourceActionName}
                            sourceAuthMode={sourceAuthMode}
                            sourceDraft={sourceDraft}
                            sourceEditName={sourceEditName}
                            sourceFormOpen={sourceFormOpen}
                            sources={sources}
                            workspaceSettings={workspaceSettings}
                            solutionPath={solutionPath}
                            onAddSource={() => {
                                setActionBusy("source");
                                setSourceActionName(sourceDraft.name);
                                vscode.postMessage({ type: "addSource", payload: { ...sourceDraft, authMode: sourceAuthMode } });
                            }}
                            onCancelSourceForm={() => {
                                setSourceFormOpen(false);
                                setSourceEditName("");
                                setSourceAuthMode("none");
                                setSourceDraft({ name: "", url: "", username: "", password: "" });
                            }}
                            onChangeAuthMode={setSourceAuthMode}
                            onChangeDraft={(patch) => setSourceDraft((current) => ({ ...current, ...patch }))}
                            onChangeSolution={(nextSolutionPath) => {
                                setWorkspaceSettings((current) => ({ ...current, solutionPath: nextSolutionPath }));
                                setStatus("loading");
                                setStatusMessage("Refreshing workspace projects...");
                                vscode.postMessage({ type: "setWorkspaceSolution", payload: { solutionPath: nextSolutionPath } });
                            }}
                            onChangeUseAllProjects={(useAllProjects) => {
                                setWorkspaceSettings((current) => ({ ...current, useAllProjects }));
                                setStatus("loading");
                                setStatusMessage("Refreshing workspace projects...");
                                vscode.postMessage({ type: "setUseAllProjects", payload: { useAllProjects } });
                            }}
                            onEditSource={(source) => {
                                setSourceFormOpen(true);
                                setSourceEditName(source.name);
                                const nextAuthMode = source.authMode === "basic" || source.username || source.password ? "basic" : "none";
                                setSourceAuthMode(nextAuthMode);
                                setSourceDraft({
                                    name: source.name,
                                    url: source.url,
                                    username: source.username ?? "",
                                    password: source.password ?? ""
                                });
                            }}
                            onEnableSource={(sourceName) => {
                                setSources((current) => current.map((source) => source.name === sourceName ? { ...source, enabled: true, healthStatus: "unknown", healthMessage: "Checking source health..." } : source));
                                setActionBusy("source");
                                setSourceActionName(sourceName);
                                vscode.postMessage({ type: "enableSource", payload: { name: sourceName } });
                            }}
                            onDisableSource={(sourceName) => {
                                setSources((current) => current.map((source) => source.name === sourceName ? { ...source, enabled: false } : source));
                                if (selectedSourceName === sourceName) {
                                    setSelectedSourceName(ALL_SOURCES);
                                    postClientState(activeTab, searchTerm, ALL_SOURCES, includePrerelease);
                                }
                                setActionBusy("source");
                                setSourceActionName(sourceName);
                                vscode.postMessage({ type: "disableSource", payload: { name: sourceName } });
                            }}
                            onRemoveSource={(sourceName) => {
                                setActionBusy("source");
                                setSourceActionName(sourceName);
                                vscode.postMessage({ type: "removeSource", payload: { name: sourceName } });
                            }}
                            onSelectSource={changeSource}
                            onShowSourceForm={() => {
                                setSourceFormOpen(true);
                                setSourceEditName("");
                                setSourceAuthMode("none");
                                setSourceDraft({ name: "", url: "", username: "", password: "" });
                            }}
                            onUpdateSource={() => {
                                setActionBusy("source");
                                setSourceActionName(sourceEditName || sourceDraft.name);
                                vscode.postMessage({ type: "updateSource", payload: { ...sourceDraft, originalName: sourceEditName, authMode: sourceAuthMode } });
                            }}
                        />
                    ) : selectedPackage ? (
                        <PackageDetailsPane
                            activeTab={activeTab}
                            actionBusy={actionBusy}
                            details={details}
                            detailsLoading={detailsLoading}
                            packageInfo={selectedPackage}
                            previewTab={previewTab}
                            projects={projects}
                            selectedPackageVersion={selectedPackageVersion || selectedPackage.version}
                            selectedProjectIds={selectedProjectIds}
                            selectedSourceLabel={getSelectedSourceLabel(selectedSourceName)}
                            onChangePreviewTab={setPreviewTab}
                            onChangeSelectedVersion={(version) => {
                                setSelectedPackageVersion(version);
                                requestPackageDetails(selectedPackage, version);
                            }}
                            onInstall={(version) => {
                                if (selectedProjectIds.size === 0) {
                                    setStatus("error");
                                    setStatusMessage("Select at least one project before installing the package.");
                                    return;
                                }

                                setActionBusy("install");
                                setStatus("loading");
                                setStatusMessage(`Installing ${selectedPackage.id}...`);
                                vscode.postMessage({ type: "installPackage", payload: { packageId: selectedPackage.id, version, projectIds: Array.from(selectedProjectIds), sourceName: selectedSourceName } });
                            }}
                            onToggleProject={(projectId, selected) => setSelectedProjectIds((current) => {
                                const next = new Set(current);
                                if (selected) {
                                    next.add(projectId);
                                } else {
                                    next.delete(projectId);
                                }
                                return next;
                            })}
                            onToggleSettings={() => setSettingsOpen(true)}
                            onToggleAllProjects={() => setSelectedProjectIds((current) => {
                                const allSelected = selectableProjectIds.length > 0 && selectableProjectIds.every((id) => current.has(id));
                                return allSelected ? new Set() : new Set(selectableProjectIds);
                            })}
                            onUninstall={() => {
                                if (selectedProjectIds.size === 0) {
                                    setStatus("error");
                                    setStatusMessage("Select at least one project before uninstalling the package.");
                                    return;
                                }

                                setActionBusy("uninstall");
                                setStatus("loading");
                                setStatusMessage(`Uninstalling ${selectedPackage.id}...`);
                                vscode.postMessage({ type: "uninstallPackage", payload: { packageId: selectedPackage.id, projectIds: Array.from(selectedProjectIds) } });
                            }}
                        />
                    ) : (
                        <WorkspacePane errors={errors} installedPackages={installedPackages} projects={projects} selectedSourceName={selectedSourceName} solutionPath={solutionPath} />
                    )}
                </aside>
            </main>
            {errorDetails && errorLogOpen ? (
                <section className="operationErrorPanel">
                    <div className="operationErrorHeader">
                        <strong>Operation log</strong>
                        <button type="button" className="operationErrorClose" onClick={() => setErrorLogOpen(false)}>Hide</button>
                    </div>
                    <pre>{errorDetails}</pre>
                </section>
            ) : null}
            <footer className={`statusBar status-${status}`}>
                <strong>{status.toUpperCase()}</strong>
                <span>{statusMessage}</span>
                {errorDetails ? (
                    <button
                        type="button"
                        className="statusLogsButton"
                        onClick={() => setErrorLogOpen((current) => !current)}
                    >
                        {errorLogOpen ? "Hide logs" : "Logs"}
                    </button>
                ) : null}
            </footer>
        </div>
    );
}