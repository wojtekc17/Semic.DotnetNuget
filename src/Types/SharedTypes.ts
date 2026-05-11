export type OperationStatus = "idle" | "loading" | "success" | "error";
export type TabKey = "browse" | "installed" | "updates" | "consolidated" | "vulnerabilities";

export interface NugetSource {
  name: string;
  url: string;
  enabled: boolean;
  authMode?: SourceAuthMode;
  username?: string;
  password?: string;
  healthStatus?: "ok" | "error" | "unknown";
  healthMessage?: string;
}

export interface PackageReferenceInfo {
  id: string;
  version: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  relativeProjectPath: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  packages: PackageReferenceInfo[];
}

export interface BrowsePackageInfo {
  id: string;
  version: string;
  versions: string[];
  description: string;
  authors: string;
  downloads?: number;
  verified: boolean;
  iconUrl?: string;
}

export interface PackageDependencyGroupInfo {
  targetFramework: string;
  dependencies: Array<{
    id: string;
    range: string;
  }>;
}

export interface PackageDetailsInfo {
  id: string;
  version: string;
  availableVersions: string[];
  sourceName?: string;
  description: string;
  authors: string;
  license: string;
  projectUrl: string;
  reportAbuseUrl: string;
  tags: string[];
  published: string;
  readmeUrl: string;
  readme: string;
  dependencies: PackageDependencyGroupInfo[];
}

export interface PackageGroupInfo {
  id: string;
  versions: string[];
  projects: PackageReferenceInfo[];
  availableInSelectedSource?: boolean;
  availableSourceNames?: string[];
  latestVersion?: string;
  latestVersionBySource?: Record<string, string>;
  latestVersionInAllSources?: string;
  hasUpdate?: boolean;
  hasUpdateInAllSources?: boolean;
  isConsolidated?: boolean;
  vulnerabilities: PackageVulnerabilityInfo[];
}

export interface PackageVulnerabilityInfo {
  projectId: string;
  projectName: string;
  version: string;
  severity: string;
  advisoryUrl: string;
}

export interface OptionsState {
  selectedSourceName: string;
  includePrerelease: boolean;
}

export interface WorkspaceSettingsState {
  useAllProjects: boolean;
  solutionPath: string;
  availableSolutions: string[];
}

export interface ProjectError {
  projectPath: string;
  message: string;
}

export interface NugetWorkspacePayload {
  requestId?: number;
  backgroundDataPending?: boolean;
  updatesDataPending?: boolean;
  vulnerabilitiesDataPending?: boolean;
  solutionPath?: string;
  workspaceSettings: WorkspaceSettingsState;
  projects: ProjectInfo[];
  installedPackages: PackageGroupInfo[];
  sources: NugetSource[];
  errors: ProjectError[];
  options: OptionsState;
  status: OperationStatus;
  message: string;
}

export interface BrowsePackagesPayload {
  requestId?: number;
  packages: BrowsePackageInfo[];
  skip: number;
  take: number;
  hasMore: boolean;
  append: boolean;
  status: OperationStatus;
  message: string;
}

export interface PackageDetailsPayload {
  details: PackageDetailsInfo;
  status: OperationStatus;
  message: string;
}

export type SourceAuthMode = "none" | "basic";

export interface AddSourceRequest {
  name: string;
  url: string;
  authMode: SourceAuthMode;
  username?: string;
  password?: string;
}

export interface UpdateSourceRequest extends AddSourceRequest {
  originalName: string;
}

export interface RemoveSourceRequest {
  name: string;
}

export interface ToggleSourceRequest {
  name: string;
}

export interface InstallPackageRequest {
  packageId: string;
  version?: string;
  projectIds: string[];
  sourceName: string;
}

export interface BulkInstallPackageRequest {
  items: Array<{
    packageId: string;
    version: string;
    projectIds: string[];
  }>;
  sourceName: string;
}

export interface UninstallPackageRequest {
  packageId: string;
  projectIds: string[];
}

export interface PanelClientState {
  activeTab: TabKey;
  searchTerm: string;
  options: OptionsState;
}

export interface BusyStatePayload {
  status: OperationStatus;
  message: string;
}

export interface ErrorPayload {
  message: string;
  details?: string;
}

export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "refresh"; payload?: { requestId?: number } }
  | { type: "verifyWorkspace" }
  | { type: "browsePackages"; payload: { query: string; includePrerelease: boolean; sourceName: string; skip: number; take: number; append: boolean; requestId: number } }
  | { type: "loadPackageDetails"; payload: { packageId: string; version: string; sourceName: string; includePrerelease: boolean } }
  | { type: "selectSource"; payload: { sourceName: string } }
  | { type: "setWorkspaceSolution"; payload: { solutionPath: string } }
  | { type: "setUseAllProjects"; payload: { useAllProjects: boolean } }
  | { type: "addSource"; payload: AddSourceRequest }
  | { type: "updateSource"; payload: UpdateSourceRequest }
  | { type: "removeSource"; payload: RemoveSourceRequest }
  | { type: "enableSource"; payload: ToggleSourceRequest }
  | { type: "disableSource"; payload: ToggleSourceRequest }
  | { type: "installPackage"; payload: InstallPackageRequest }
  | { type: "bulkInstallPackages"; payload: BulkInstallPackageRequest }
  | { type: "uninstallPackage"; payload: UninstallPackageRequest }
  | { type: "openSettings" }
  | { type: "syncState"; payload: PanelClientState };

export type ExtensionToWebviewMessage =
  | { type: "busyState"; payload: BusyStatePayload }
  | { type: "workspaceLoaded"; payload: NugetWorkspacePayload }
  | { type: "browsePackagesLoaded"; payload: BrowsePackagesPayload }
  | { type: "packageDetailsLoaded"; payload: PackageDetailsPayload }
  | { type: "stateChanged"; payload: PanelClientState }
  | { type: "error"; payload: ErrorPayload };

export const DefaultOptionsState: OptionsState = {
  selectedSourceName: "__all__",
  includePrerelease: false
};
