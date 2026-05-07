import type { PackageGroupInfo, ProjectError, ProjectInfo } from "../Types";
import { Errors } from "./Common";

export function WorkspacePane(props: { errors: ProjectError[]; installedPackages: PackageGroupInfo[]; projects: ProjectInfo[]; selectedSourceName: string; solutionPath: string }) {
    return (
        <>
            <section className="detailsSection">
                <h2>Workspace</h2>
                <dl className="statsList">
                    <div><dt>Projects</dt><dd>{props.projects.length}</dd></div>
                    <div><dt>Packages</dt><dd>{props.installedPackages.length}</dd></div>
                    <div><dt>Source</dt><dd>{props.selectedSourceName || "None"}</dd></div>
                </dl>
                {props.solutionPath ? <p className="pathText">{props.solutionPath}</p> : null}
            </section>
            <Errors errors={props.errors} />
        </>
    );
}

export function InfoPane() {
    return (
        <section className="detailsSection infoSection">
            <h2>Info</h2>
            <p>Browse, README and Package Details use NuGet feed API v3 endpoints.</p>
            <p>Local/offline package sources are visible in source settings, but they do not expose searchable package metadata in this view.</p>
            <p>Package install and uninstall still use the .NET CLI against selected projects.</p>
        </section>
    );
}