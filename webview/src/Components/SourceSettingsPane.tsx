import type { SourceSettingsPaneProps } from "../AppTypes";
import { ALL_SOURCES } from "../Constants/AppConstants";
import type { SourceAuthMode } from "../Types";
import { Spinner } from "./Common";

export function SourceSettingsPane(props: SourceSettingsPaneProps) {
    const selectableSources = props.sources.filter((source) => source.enabled && source.healthStatus !== "error");

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
                    {selectableSources.map((source) => <option key={source.name} value={source.name}>{source.name}</option>)}
                </select>
                <div className="sourceList">
                    {props.sources.map((source) => (
                        <div key={source.name} className={`sourceRow ${source.name === props.selectedSourceName ? "isActive" : ""}`} title={source.url}>
                            {(() => {
                                const hasProblem = source.healthStatus === "error";
                                const isExcluded = !source.enabled && source.healthStatus !== "error";

                                return (
                            <button className="sourceSelectButton" type="button" onClick={() => props.onSelectSource(source.name)}>
                                <span className="sourceNameRow">
                                    <span>{source.name}</span>
                                    {hasProblem ? <span className={source.enabled ? "sourceProblemMark" : "sourceWarningMark"} aria-label="Source problem">!</span> : null}
                                    {isExcluded ? <span className="sourceExcludedMark" aria-label="Source excluded">▲</span> : null}
                                </span>
                                <code>{source.url}</code>
                                <span className="sourceStatusRow">
                                    <span className={`sourceStatusBadge ${source.enabled ? "isEnabled" : "isDisabled"}`}>{source.enabled ? "Enabled" : "Disabled"}</span>
                                    <span className={`sourceStatusBadge ${isExcluded ? "isExcluded" : source.healthStatus === "ok" ? "isHealthy" : source.healthStatus === "error" ? "isProblem" : "isUnknown"}`}>{isExcluded ? "Excluded" : source.healthStatus === "ok" ? "OK" : source.healthStatus === "error" ? "Problem" : "Unchecked"}</span>
                                </span>
                                <small className="sourceHealthText">{source.healthMessage || (source.enabled ? "Source status unknown." : "Source is disabled.")}</small>
                            </button>
                                );
                            })()}
                            <div className="sourceActions">
                                <button className="iconButton sourceActionButton" type="button" onClick={() => props.onEditSource(source)}>Edit</button>
                                {source.enabled ? <button className="iconButton sourceActionButton" type="button" onClick={() => props.onDisableSource(source.name)}>{props.actionBusy === "source" && props.sourceActionName === source.name ? <Spinner /> : null} Disable</button> : <button className="iconButton sourceActionButton" type="button" onClick={() => props.onEnableSource(source.name)}>{props.actionBusy === "source" && props.sourceActionName === source.name ? <Spinner /> : null} Enable</button>}
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