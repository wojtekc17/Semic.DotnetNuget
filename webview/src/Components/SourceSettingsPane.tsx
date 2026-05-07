import type { SourceSettingsPaneProps } from "../AppTypes";
import { ALL_SOURCES } from "../Constants/AppConstants";
import type { SourceAuthMode } from "../Types";
import { Spinner } from "./Common";

export function SourceSettingsPane(props: SourceSettingsPaneProps) {
    return (
        <>
            <section className="detailsSection">
                <h2>Workspace</h2>
                <label className="optionRow"><input checked={props.workspaceSettings.useAllProjects} type="checkbox" onChange={(event) => props.onChangeUseAllProjects(event.target.checked)} /> Use all .csproj projects</label>
                <select className="sourceSelect" disabled={props.workspaceSettings.useAllProjects} value={props.workspaceSettings.solutionPath || props.solutionPath} onChange={(event) => props.onChangeSolution(event.target.value)}>
                    {props.workspaceSettings.availableSolutions.length === 0 ? <option value="">No .sln or .slnx found</option> : props.workspaceSettings.availableSolutions.map((solutionPath) => <option key={solutionPath} value={solutionPath}>{solutionPath}</option>)}
                </select>
            </section>
            <section className="detailsSection">
                <h2>Sources</h2>
                <select className="sourceSelect" value={props.selectedSourceName || ALL_SOURCES} onChange={(event) => props.onSelectSource(event.target.value)}>
                    <option value={ALL_SOURCES}>All</option>
                    {props.sources.map((source) => <option key={source.name} value={source.name}>{source.name}</option>)}
                </select>
                <div className="sourceList">
                    {props.sources.map((source) => (
                        <div key={source.name} className={`sourceRow ${source.name === props.selectedSourceName ? "isActive" : ""}`} title={source.url}>
                            <button className="sourceSelectButton" type="button" onClick={() => props.onSelectSource(source.name)}><span>{source.name}</span><code>{source.url}</code></button>
                            <div className="sourceActions">
                                <button className="iconButton sourceActionButton" type="button" onClick={() => props.onEditSource(source)}>Edit</button>
                                <button className="iconButton sourceActionButton removeSourceButton" type="button" onClick={() => props.onRemoveSource(source.name)}>{props.actionBusy === "source" && props.sourceActionName === source.name ? <Spinner /> : null} Remove</button>
                            </div>
                        </div>
                    ))}
                </div>
            </section>
            <section className="detailsSection">
                {!props.sourceFormOpen ? <button className="primaryButton" type="button" onClick={props.onShowSourceForm}>Add source</button> : null}
                {props.sourceFormOpen ? <SourceForm {...props} /> : null}
            </section>
        </>
    );
}

function SourceForm(props: SourceSettingsPaneProps) {
    return (
        <div className="sourceForm">
            <label className="fieldLabel">Name<input className="textInput" value={props.sourceDraft.name} onChange={(event) => props.onChangeDraft({ name: event.target.value })} /></label>
            <label className="fieldLabel">URL<input className="textInput" value={props.sourceDraft.url} placeholder="https://..." onChange={(event) => props.onChangeDraft({ url: event.target.value })} /></label>
            <label className="fieldLabel">Authentication
                <select className="sourceSelect" value={props.sourceAuthMode} onChange={(event) => props.onChangeAuthMode(event.target.value as SourceAuthMode)}>
                    <option value="none">None</option>
                    <option value="basic">Username and password</option>
                </select>
            </label>
            {props.sourceAuthMode === "basic" ? (
                <>
                    <label className="fieldLabel">Username<input className="textInput" value={props.sourceDraft.username} onChange={(event) => props.onChangeDraft({ username: event.target.value })} /></label>
                    <label className="fieldLabel">Password<input className="textInput" type="password" value={props.sourceDraft.password} onChange={(event) => props.onChangeDraft({ password: event.target.value })} /></label>
                </>
            ) : null}
            <div className="buttonRow">
                <button className="primaryButton" type="button" onClick={props.sourceEditName ? props.onUpdateSource : props.onAddSource}>{props.actionBusy === "source" ? <Spinner /> : null} {props.sourceEditName ? "Update source" : "Save source"}</button>
                <button className="secondaryButton" type="button" onClick={props.onCancelSourceForm}>Cancel</button>
            </div>
        </div>
    );
}