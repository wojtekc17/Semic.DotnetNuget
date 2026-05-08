import type { BusyAction } from "./Components/Toolbar";
import type { NugetSource, PackageGroupInfo, PackageReferenceInfo, SourceAuthMode, WorkspaceSettingsState } from "./Types";

export type PreviewTab = "readme" | "details";

export interface SourceDraft {
    name: string;
    url: string;
    username: string;
    password: string;
}

export interface SelectedPackageContext {
    id: string;
    version: string;
    versions: string[];
    iconUrl?: string;
    authors?: string;
    description?: string;
    downloads?: number;
    verified?: boolean;
    projects?: PackageReferenceInfo[];
    vulnerabilities?: PackageGroupInfo["vulnerabilities"];
}

export interface SourceSettingsPaneProps {
    actionBusy: BusyAction;
    selectedSourceName: string;
    solutionPath: string;
    sourceActionName: string;
    sourceAuthMode: SourceAuthMode;
    sourceDraft: SourceDraft;
    sourceEditName: string;
    sourceFormOpen: boolean;
    sources: NugetSource[];
    workspaceSettings: WorkspaceSettingsState;
    onAddSource: () => void;
    onCancelSourceForm: () => void;
    onChangeAuthMode: (mode: SourceAuthMode) => void;
    onChangeDraft: (patch: Partial<SourceDraft>) => void;
    onChangeSolution: (solutionPath: string) => void;
    onChangeUseAllProjects: (useAllProjects: boolean) => void;
    onEditSource: (source: NugetSource) => void;
    onEnableSource: (sourceName: string) => void;
    onDisableSource: (sourceName: string) => void;
    onRemoveSource: (sourceName: string) => void;
    onSelectSource: (sourceName: string) => void;
    onShowSourceForm: () => void;
    onUpdateSource: () => void;
}