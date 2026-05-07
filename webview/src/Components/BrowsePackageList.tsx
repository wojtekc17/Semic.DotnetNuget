import type { BrowsePackageInfo } from "../Types";
import { EmptyState, LoadingState, PackageIcon, PackageMetaStrip, Spinner } from "./Common";

export function BrowsePackageList(props: {
    browseHasMore: boolean;
    browseLoading: boolean;
    packages: BrowsePackageInfo[];
    selectedPackageId: string;
    onLoadMore: () => void;
    onSelect: (packageInfo: BrowsePackageInfo) => void;
}) {
    if (props.packages.length === 0) {
        return props.browseLoading ? <LoadingState message="Loading packages..." /> : <EmptyState title="No packages to show." detail="Search the selected NuGet source or refresh the workspace." />;
    }

    return (
        <div className="packageList">
            {props.packages.map((packageInfo) => (
                <button key={packageInfo.id} className={`packageRow packageButton ${props.selectedPackageId === packageInfo.id ? "isSelected" : ""}`} type="button" onClick={() => props.onSelect(packageInfo)}>
                    <PackageIcon iconUrl={packageInfo.iconUrl} />
                    <div className="packageMain">
                        <h3>{packageInfo.id}</h3>
                        <p className="byline">by {packageInfo.authors || "unknown author"}</p>
                        <p className="description">{packageInfo.description || ""}</p>
                        <PackageMetaStrip downloads={packageInfo.downloads} verified={packageInfo.verified} />
                    </div>
                    <strong className="versionText">{packageInfo.version}</strong>
                </button>
            ))}
            {props.browseLoading ? <div className="loadingRow"><Spinner /> Loading packages...</div> : null}
            {props.browseHasMore && !props.browseLoading ? <button className="loadMoreRow" type="button" onClick={props.onLoadMore}>Load more</button> : null}
        </div>
    );
}