import type { PackageGroupInfo, TabKey } from "../Types";
import { InstalledEmptyState, PackageIcon } from "./Common";

export function InstalledPackageList(props: {
    activeTab: TabKey;
    bulkSelectedPackageIds: Set<string>;
    groups: PackageGroupInfo[];
    searchTerm: string;
    selectedPackageId: string;
    onBulkSelectionChange: (packageId: string, selected: boolean) => void;
    onSelect: (packageGroup: PackageGroupInfo) => void;
}) {
    const hasBulkSelection = props.activeTab === "updates" || props.activeTab === "consolidated";

    if (props.groups.length === 0) {
        return <InstalledEmptyState activeTab={props.activeTab} filter={props.searchTerm.trim()} />;
    }

    return (
        <div className="packageList">
            {props.groups.map((packageGroup) => {
                const iconVersion = packageGroup.versions.at(-1) || packageGroup.versions[0] || "";

                return (
                    <div key={packageGroup.id} className={`packageRow installedRow ${hasBulkSelection ? "packageSelectableRow" : ""} ${props.selectedPackageId === packageGroup.id ? "isSelected" : ""}`} data-testid={`installed-package-row-${packageGroup.id}`}>
                        {hasBulkSelection ? (
                            <input
                                className="bulkPackageCheckbox"
                                checked={props.bulkSelectedPackageIds.has(packageGroup.id)}
                                type="checkbox"
                                aria-label={`Select ${packageGroup.id} for bulk action`}
                                onChange={(event) => props.onBulkSelectionChange(packageGroup.id, event.target.checked)}
                            />
                        ) : null}
                        <button className="packageButton packageContentButton" data-testid={`installed-package-button-${packageGroup.id}`} type="button" onClick={() => props.onSelect(packageGroup)}>
                            <PackageIcon packageId={packageGroup.id} packageVersion={iconVersion} />
                            <div className="packageMain">
                                <h3>{packageGroup.id}</h3>
                                <p className="description">{packageGroup.projects.length} project(s){packageGroup.vulnerabilities.length > 0 ? ` · ${packageGroup.vulnerabilities.length} vulnerable` : ""}</p>
                                <div className="projectChips">{packageGroup.projects.slice(0, 5).map((project) => <span key={project.projectId}>{project.projectName}</span>)}</div>
                            </div>
                            <strong className={`versionText ${packageGroup.isConsolidated ? "" : "warningText"}`}>{packageGroup.versions.join(", ")}</strong>
                        </button>
                    </div>
                );
            })}
        </div>
    );
}