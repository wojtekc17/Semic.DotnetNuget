import type { SelectedPackageContext } from "../AppTypes";
import { formatDate, formatDownloads, renderMarkdownPreview } from "../AppUtils";
import type { PackageDetailsInfo, ProjectError, TabKey } from "../Types";

export function PackageIcon({ iconUrl, preview = false }: { iconUrl?: string; preview?: boolean }) {
    return <div className={`packageIcon ${preview ? "previewIcon" : ""}`}>{iconUrl ? <img alt="" src={iconUrl} /> : <span>.NET</span>}</div>;
}

export function PackageMetaStrip({ downloads, verified }: { downloads?: number; verified: boolean }) {
    if (!downloads && !verified) {
        return null;
    }

    return <div className="packageMetaStrip">{verified ? <span className="verifiedBadge">Verified</span> : null}{downloads ? <span className="downloadBadge"><span className="downloadIcon" /> {formatDownloads(downloads)}</span> : null}</div>;
}

export function Spinner() {
    return <span className="spinner" aria-hidden="true" />;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
    return <div className="emptyState"><h3>{title}</h3><p>{detail}</p></div>;
}

export function LoadingState({ message }: { message: string }) {
    return <div className="emptyState loadingState"><div className="centeredSpinner"><Spinner /><span>{message}</span></div></div>;
}

export function InstalledEmptyState({ activeTab, filter }: { activeTab: TabKey; filter: string }) {
    if (filter) {
        return <EmptyState title="No matching packages." detail={`No packages match "${filter}".`} />;
    }

    if (activeTab === "updates") {
        return <EmptyState title="No updates found." detail="All installed packages are already on the latest version available from the selected NuGet source." />;
    }

    if (activeTab === "consolidated") {
        return <EmptyState title="No consolidation needed." detail="All packages use one version across the loaded projects." />;
    }

    if (activeTab === "vulnerabilities") {
        return <EmptyState title="No vulnerabilities found." detail="No vulnerable package references were reported for loaded projects." />;
    }

    return <EmptyState title="No installed packages found." detail="PackageReference entries are loaded from projects listed in the selected solution." />;
}

export function Errors({ errors }: { errors: ProjectError[] }) {
    if (errors.length === 0) {
        return null;
    }

    return <section className="detailsSection errorSection"><h2>Problems</h2>{errors.slice(0, 4).map((error) => <p key={`${error.projectPath}-${error.message}`}>{error.message}</p>)}</section>;
}

export function ExternalLink({ label, url }: { label: string; url: string }) {
    return <a href={url}>{label}</a>;
}

export function MaybeLink({ value }: { value: string }) {
    return /^https?:\/\//i.test(value) ? <ExternalLink label={value} url={value} /> : <>{value}</>;
}

export function ReadmeTab({ details, loading, packageInfo }: { details?: PackageDetailsInfo; loading: boolean; packageInfo: SelectedPackageContext }) {
    if (loading) {
        return <LoadingState message="Loading README..." />;
    }

    if (!details?.readme) {
        return <EmptyState title="No README available." detail={`No README metadata was returned for ${packageInfo.id}.`} />;
    }

    return <div className="readmePreview" data-testid="readme-preview" dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(details.readme) }} />;
}

export function PackageDetailsTab({ details, loading, packageInfo, selectedVersion }: { details?: PackageDetailsInfo; loading: boolean; packageInfo: SelectedPackageContext; selectedVersion: string }) {
    if (loading) {
        return <LoadingState message="Loading package details..." />;
    }

    const data = details;

    return (
        <dl className="packageDetailsList" data-testid="package-details-content">
            <div><dt>ID</dt><dd>{packageInfo.id}</dd></div>
            <div><dt>Version</dt><dd>{data?.version || selectedVersion}</dd></div>
            <div><dt>Authors</dt><dd>{data?.authors || packageInfo.authors || "unknown"}</dd></div>
            <div><dt>Description</dt><dd>{data?.description || packageInfo.description || ""}</dd></div>
            <div><dt>License</dt><dd>{data?.license ? <MaybeLink value={data.license} /> : "unknown"}</dd></div>
            <div><dt>Project</dt><dd>{data?.projectUrl ? <ExternalLink label={data.projectUrl} url={data.projectUrl} /> : "none"}</dd></div>
            <div><dt>Published</dt><dd>{formatDate(data?.published)}</dd></div>
            <div><dt>Tags</dt><dd>{data?.tags?.join(", ") || "none"}</dd></div>
            <div className="packageDetailsTreeRow"><dt>Dependencies</dt><dd><Dependencies dependencies={data?.dependencies ?? []} /></dd></div>
        </dl>
    );
}

function Dependencies({ dependencies }: { dependencies: PackageDetailsInfo["dependencies"] }) {
    if (dependencies.length === 0) {
        return <>none</>;
    }

    return (
        <ul className="dependencyFrameworkList">
            {dependencies.map((group) => {
                const frameworkLabel = group.targetFramework || "Any framework";

                return (
                    <li key={frameworkLabel} className="dependencyFrameworkListItem">
                        <details className="dependencyFrameworkNode" open>
                            <summary>{frameworkLabel}</summary>
                            <ul className="dependencyPackageList">
                                {group.dependencies.length > 0
                                    ? group.dependencies.map((dependency) => (
                                        <li key={`${frameworkLabel}-${dependency.id}`}>
                                            <span>{`${dependency.id} (${dependency.range || "any version"})`}</span>
                                        </li>
                                    ))
                                    : <li><span>No packages</span></li>}
                            </ul>
                        </details>
                    </li>
                );
            })}
        </ul>
    );
}