import type { Dispatch, SetStateAction } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { BusyAction } from "./Components/Toolbar";
import type { SelectedPackageContext } from "./AppTypes";
import { ALL_SOURCES } from "./Constants/AppConstants";
import type { BrowsePackageInfo, PackageGroupInfo, TabKey } from "./Types";

export function getVisibleInstalledGroups(installedPackages: PackageGroupInfo[], activeTab: TabKey, searchTerm: string) {
    const filter = searchTerm.trim().toLowerCase();
    let groups = installedPackages.filter((packageGroup) => {
        if (!filter) {
            return true;
        }

        return packageGroup.id.toLowerCase().includes(filter) || packageGroup.projects.some((project) => project.projectName.toLowerCase().includes(filter));
    });

    if (activeTab === "consolidated") {
        groups = groups.filter((packageGroup) => !packageGroup.isConsolidated);
    }

    if (activeTab === "updates") {
        groups = groups.filter((packageGroup) => packageGroup.hasUpdate);
    }

    if (activeTab === "vulnerabilities") {
        groups = groups.filter((packageGroup) => packageGroup.vulnerabilities.length > 0);
    }

    return groups;
}

export function getSelectedPackageContext(activeTab: TabKey, selectedPackageId: string, selectedPackageVersion: string, browsePackages: BrowsePackageInfo[], installedPackages: PackageGroupInfo[]): SelectedPackageContext | undefined {
    if (!selectedPackageId) {
        return undefined;
    }

    if (activeTab === "browse") {
        const browsePackage = browsePackages.find((packageInfo) => packageInfo.id === selectedPackageId);
        const installedGroup = installedPackages.find((packageGroup) => packageGroup.id === selectedPackageId);
        return browsePackage
            ? {
                ...browsePackage,
                version: selectedPackageVersion || browsePackage.version,
                projects: installedGroup?.projects,
                vulnerabilities: installedGroup?.vulnerabilities ?? []
            }
            : undefined;
    }

    const group = installedPackages.find((packageGroup) => packageGroup.id === selectedPackageId);

    if (!group) {
        return undefined;
    }

    const defaultVersion = activeTab === "updates" ? group.latestVersion || group.versions.at(-1) || group.versions[0] || "" : group.versions.at(-1) || group.versions[0] || "";
    const versions = activeTab === "updates" && group.latestVersion ? [group.latestVersion, ...group.versions.filter((version) => version !== group.latestVersion)] : group.versions;

    return {
        id: group.id,
        version: selectedPackageVersion || defaultVersion,
        versions,
        projects: group.projects,
        vulnerabilities: group.vulnerabilities
    };
}

export function getBulkPackageItems(activeTab: TabKey, visibleGroups: PackageGroupInfo[], bulkSelectedPackageIds: Set<string>) {
    if (activeTab !== "updates" && activeTab !== "consolidated") {
        return [];
    }

    return visibleGroups
        .filter((packageGroup) => bulkSelectedPackageIds.has(packageGroup.id))
        .map((packageGroup) => ({
            packageId: packageGroup.id,
            version: activeTab === "updates" ? packageGroup.latestVersion || "" : packageGroup.versions.at(-1) || "",
            projectIds: packageGroup.projects.map((project) => project.projectId)
        }))
        .filter((item) => item.version && item.projectIds.length > 0);
}

export function toggleVisibleBulkPackages(visibleGroups: PackageGroupInfo[], setBulkSelectedPackageIds: Dispatch<SetStateAction<Set<string>>>) {
    setBulkSelectedPackageIds((current) => {
        const allSelected = visibleGroups.length > 0 && visibleGroups.every((group) => current.has(group.id));
        const next = new Set(current);

        visibleGroups.forEach((group) => {
            if (allSelected) {
                next.delete(group.id);
            } else {
                next.add(group.id);
            }
        });

        return next;
    });
}

export function mergePackages(existingPackages: BrowsePackageInfo[], nextPackages: BrowsePackageInfo[]) {
    const merged = new Map<string, BrowsePackageInfo>();

    existingPackages.concat(nextPackages).forEach((packageInfo) => {
        const key = packageInfo.id.toLowerCase();
        const existing = merged.get(key);

        if (!existing || (packageInfo.downloads ?? 0) > (existing.downloads ?? 0)) {
            merged.set(key, packageInfo);
        }
    });

    return Array.from(merged.values());
}

export function packageDetailsKey(packageId: string, version: string) {
    return `${packageId.toLowerCase()}@${version.toLowerCase()}`;
}

export function getSelectedSourceLabel(selectedSourceName: string) {
    if (selectedSourceName === ALL_SOURCES || !selectedSourceName) {
        return "All sources";
    }

    return selectedSourceName;
}

export function inferBusyAction(message: string): BusyAction {
    const lowered = message.toLowerCase();

    if (lowered.includes("uninstall")) {
        return "uninstall";
    }

    if (lowered.includes("selected package references")) {
        return "bulk";
    }

    if (lowered.includes("install")) {
        return "install";
    }

    if (lowered.includes("nuget source")) {
        return "source";
    }

    if (lowered.includes("loading .slnx") || lowered.includes("loading workspace projects") || lowered.includes("refreshing workspace projects")) {
        return "refresh";
    }

    return "generic";
}

export function formatDownloads(downloads: number) {
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

export function formatDate(value: string | undefined) {
    if (!value) {
        return "unknown";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function renderMarkdownPreview(markdown: string) {
    const rendered = marked.parse(markdown, {
        async: false,
        breaks: true,
        gfm: true
    });

    return DOMPurify.sanitize(rendered, {
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
    });
}