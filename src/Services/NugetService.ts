import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import {
  DefaultOptionsState,
  type BrowsePackageInfo,
  type BrowsePackagesPayload,
  type AddSourceRequest,
  type BulkInstallPackageRequest,
  type InstallPackageRequest,
  type PackageDetailsPayload,
  type PackageVulnerabilityInfo,
  type NugetSource,
  type NugetWorkspacePayload,
  type OptionsState,
  type PackageGroupInfo,
  type RemoveSourceRequest,
  type UninstallPackageRequest,
  type UpdateSourceRequest
} from "../Types/SharedTypes";
import { WorkspaceScanner } from "./WorkspaceScanner";

const execFileAsync = promisify(execFile);
const AllSourcesName = "__all__";
const FeedRequestTimeoutMs = 10000;
const SourceHealthTimeoutMs = 2500;
const MaxFeedConcurrency = 6;
const MaxDotnetConcurrency = 6;
const WorkspaceConfigurationSection = "semicDotnetNuget.workspace";

interface WorkspaceLoadPerformanceSettings {
  networkChecksOnLoad: boolean;
}

type NugetCatalogEntry = {
  id?: string;
  version?: string;
  description?: string;
  authors?: string | string[];
  licenseExpression?: string;
  licenseUrl?: string;
  projectUrl?: string;
  readmeUrl?: string;
  published?: string;
  tags?: string[] | string;
  dependencyGroups?: unknown;
  dependencies?: unknown;
};

type NugetRegistrationLeaf = {
  catalogEntry?: NugetCatalogEntry | string;
  packageContent?: string;
};

type ServiceIndexResource = {
  "@type"?: string | string[];
  "@id"?: string;
};

type ServiceIndex = {
  resources?: ServiceIndexResource[];
};

class OperationError extends Error {
  public constructor(message: string, public readonly details?: string) {
    super(message);
    this.name = "OperationError";
  }
}

export class NugetService {
  public constructor(private readonly scanner: WorkspaceScanner, private readonly dotnetCliHome: string) { }

  public async SelectWorkspaceSolution(): Promise<boolean> {
    return await this.scanner.SelectSolutionFromWorkspace();
  }

  public async SetUseAllProjects(useAllProjects: boolean): Promise<void> {
    await this.scanner.SetUseAllProjects(useAllProjects);
  }

  public async SetWorkspaceSolution(solutionPath: string): Promise<void> {
    await this.scanner.SetWorkspaceSolution(solutionPath);
  }

  public async LoadWorkspace(options: OptionsState): Promise<NugetWorkspacePayload> {
    const performanceSettings = this.GetWorkspaceLoadPerformanceSettings();
    const [scanResult, sources, availableSolutions] = await Promise.all([
      this.scanner.Scan(),
      this.ListSources(performanceSettings.networkChecksOnLoad),
      this.scanner.ListAvailableSolutionPaths()
    ]);
    const selectedSourceName = options.selectedSourceName || AllSourcesName;
    const installedPackages = BuildPackageGroups(scanResult.projects.flatMap((project) => project.packages));
    const backgroundInfo = " (updates and vulnerabilities are loading in background)";

    return {
      solutionPath: scanResult.solutionPath,
      workspaceSettings: {
        ...scanResult.workspaceSettings,
        availableSolutions
      },
      projects: scanResult.projects,
      installedPackages,
      sources,
      errors: scanResult.errors,
      options: {
        ...DefaultOptionsState,
        ...options,
        selectedSourceName
      },
      status: scanResult.projects.length > 0 ? "success" : "error",
      message:
        scanResult.projects.length > 0
          ? `Loaded ${scanResult.projects.length} project(s) and ${installedPackages.length} package(s).${backgroundInfo}`
          : scanResult.errors[0]?.message ?? "No projects were loaded."
    };
  }

  public async LoadWorkspaceUpdatesData(
    options: OptionsState,
    projects: NugetWorkspacePayload["projects"]
  ): Promise<{ installedPackages: PackageGroupInfo[]; sources: NugetSource[]; status: "success" | "error"; message: string }> {
    const selectedSourceName = options.selectedSourceName || AllSourcesName;
    const installedPackages = BuildPackageGroups(projects.flatMap((project) => project.packages));
    const sources = await this.ListSources(false);
    try {
      await this.ApplyLatestVersions(installedPackages, sources, selectedSourceName, options.includePrerelease);

      return {
        installedPackages,
        sources,
        status: "success",
        message: `Background updates scan completed for ${installedPackages.length} package group(s).`
      };
    } catch (error) {
      const details = error instanceof Error ? error.message : "unknown error";

      return {
        installedPackages,
        sources,
        status: "error",
        message: `Background updates scan completed with warnings (${details}).`
      };
    }
  }

  public async LoadWorkspaceVulnerabilitiesData(
    projects: NugetWorkspacePayload["projects"],
    installedPackages: PackageGroupInfo[]
  ): Promise<{ installedPackages: PackageGroupInfo[]; status: "success" | "error"; message: string }> {
    try {
      await this.ApplyVulnerabilities(installedPackages, projects);

      return {
        installedPackages,
        status: "success",
        message: `Background vulnerabilities scan completed for ${installedPackages.length} package group(s).`
      };
    } catch (error) {
      const details = error instanceof Error ? error.message : "unknown error";

      return {
        installedPackages,
        status: "error",
        message: `Background vulnerabilities scan completed with warnings (${details}).`
      };
    }
  }

  public async VerifyWorkspaceState(): Promise<string> {
    const scanResult = await this.scanner.Scan();
    const packageGroups = BuildPackageGroups(scanResult.projects.flatMap((project) => project.packages));
    const totalPackageReferences = scanResult.projects.reduce((total, project) => total + project.packages.length, 0);

    if (scanResult.projects.length === 0) {
      throw new Error(scanResult.errors[0]?.message ?? "Verification failed because no projects were loaded.");
    }

    if (scanResult.errors.length > 0) {
      const details = scanResult.errors
        .map((entry) => `- ${entry.projectPath || "(workspace)"}: ${entry.message}`)
        .join("\n");

      throw new Error(
        `Verification finished with ${scanResult.errors.length} project error(s).\n${details}`
      );
    }

    return `Verification completed. Checked ${scanResult.projects.length} project(s), ${packageGroups.length} package group(s), and ${totalPackageReferences} package reference(s).`;
  }

  public async BrowsePackages(
    query: string,
    sourceName: string,
    includePrerelease: boolean,
    skip: number,
    take: number,
    append: boolean
  ): Promise<BrowsePackagesPayload> {
    const sources = await this.ListSources(false);
    const selectedSources =
      sourceName === AllSourcesName || sourceName.trim().length === 0
        ? sources.filter((candidate) => IsSourceUsableForRequests(candidate))
        : sources.filter((candidate) => candidate.name === sourceName && IsSourceUsableForRequests(candidate));

    if (selectedSources.length === 0) {
      return {
        packages: [],
        skip,
        take,
        hasMore: false,
        append,
        status: "error",
        message: sourceName !== AllSourcesName && sourceName.trim().length > 0
          ? "Selected NuGet source is unavailable or excluded because it is failing health checks."
          : "No enabled NuGet source is available."
      };
    }

    try {
      const results = await Promise.allSettled(
        selectedSources.map(async (source) => ({
          source,
          packages: await SearchSource(source.url, query, includePrerelease, skip, take)
        }))
      );
      const packagesById = new Map<string, BrowsePackageInfo>();

      results.forEach((result) => {
        if (result.status !== "fulfilled") {
          return;
        }

        result.value.packages.forEach((packageInfo) => {
          const existing = packagesById.get(packageInfo.id.toLowerCase());

          if (!existing || (packageInfo.downloads ?? 0) > (existing.downloads ?? 0)) {
            packagesById.set(packageInfo.id.toLowerCase(), packageInfo);
          }
        });
      });

      const packages = Array.from(packagesById.values()).sort((left, right) => (right.downloads ?? 0) - (left.downloads ?? 0));

      const loadedWord = append ? "Loaded next" : "Loaded";

      return {
        packages,
        skip,
        take,
        hasMore: packages.length >= take,
        append,
        status: "success",
        message: `${loadedWord} ${packages.length} package(s) from ${sourceName === AllSourcesName ? "all sources" : selectedSources[0].name}.`
      };
    } catch (error) {
      return {
        packages: [],
        skip,
        take,
        hasMore: false,
        append,
        status: "error",
        message: error instanceof Error ? error.message : "NuGet search failed."
      };
    }
  }

  public async LoadPackageDetails(packageId: string, version: string, sourceName: string, includePrerelease: boolean): Promise<PackageDetailsPayload> {
    const sources = await this.ListSources(false);
    const candidateSources = SelectPackageDetailsSources(sources, sourceName);
    const errors: string[] = [];

    if (candidateSources.length === 0) {
      throw new Error("No enabled NuGet v3 HTTP source is available for package metadata.");
    }

    let bestResult: { details: PackageDetailsPayload["details"]; sourceName: string } | undefined;
    for (const source of candidateSources) {
      try {
        const details = await FetchPackageDetails(source.url, packageId, version, includePrerelease);
        const result = { details, sourceName: source.name };

        if (!bestResult || ScorePackageDetails(result.details) > ScorePackageDetails(bestResult.details)) {
          bestResult = result;
        }

        if (details.readme.trim().length > 0) {
          break;
        }
      } catch (error) {
        errors.push(`${source.name}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    if (bestResult) {
      return {
        details: {
          ...bestResult.details,
          sourceName: bestResult.sourceName
        },
        status: "success",
        message: `Loaded details for ${packageId} ${version} from ${bestResult.sourceName}.`
      };
    }

    throw new Error(`Package metadata could not be loaded from enabled NuGet v3 sources. ${errors.join(" ")}`);
  }

  public async SetConfiguredSource(sourceName: string): Promise<void> {
    await vscode.workspace.getConfiguration("semicDotnetNuget").update("source", sourceName, vscode.ConfigurationTarget.Workspace);
  }

  public async AddSource(request: AddSourceRequest): Promise<void> {
    const args = ["nuget", "add", "source", request.url.trim(), "--name", request.name.trim()];

    this.AppendSourceAuthentication(args, request);

    await this.RunDotnet(args);
    await this.SetConfiguredSource(request.name.trim());
  }

  public async UpdateSource(request: UpdateSourceRequest): Promise<void> {
    const originalName = request.originalName.trim();
    const name = request.name.trim();
    const url = request.url.trim();

    if (!originalName || !name || !url) {
      throw new Error("NuGet source name and URL are required.");
    }

    if (name !== originalName) {
      await this.RunDotnet(["nuget", "remove", "source", originalName]);
      await this.AddSource(request);
      return;
    }

    const args = ["nuget", "update", "source", originalName, "--source", url];
    this.AppendSourceAuthentication(args, request);
    await this.RunDotnet(args);
    await this.SetConfiguredSource(name);
  }

  public async RemoveSource(request: RemoveSourceRequest): Promise<void> {
    const name = request.name.trim();

    if (!name) {
      throw new Error("NuGet source name is required.");
    }

    await this.RunDotnet(["nuget", "remove", "source", name]);

    const configuredSource = vscode.workspace.getConfiguration("semicDotnetNuget").get<string>("source", "").trim();

    if (configuredSource === name) {
      await this.SetConfiguredSource(AllSourcesName);
    }
  }

  public async EnableSource(name: string): Promise<void> {
    const trimmedName = name.trim();

    if (!trimmedName) {
      throw new Error("NuGet source name is required.");
    }

    await this.RunDotnet(["nuget", "enable", "source", trimmedName]);
  }

  public async DisableSource(name: string): Promise<void> {
    const trimmedName = name.trim();

    if (!trimmedName) {
      throw new Error("NuGet source name is required.");
    }

    await this.RunDotnet(["nuget", "disable", "source", trimmedName]);

    const configuredSource = vscode.workspace.getConfiguration("semicDotnetNuget").get<string>("source", "").trim();

    if (configuredSource === trimmedName) {
      await this.SetConfiguredSource(AllSourcesName);
    }
  }

  public async InstallPackage(request: InstallPackageRequest, projects: NugetWorkspacePayload["projects"]): Promise<string> {
    const selectedProjects = projects.filter((project) => request.projectIds.includes(project.id));
    const sources = await this.ListSources(false);
    const source =
      request.sourceName === AllSourcesName || request.sourceName.trim().length === 0
        ? undefined
        : sources.find((candidate) => candidate.name === request.sourceName);

    if (selectedProjects.length === 0) {
      throw new Error("Select at least one project before installing the package.");
    }

    if (source && !IsSourceUsableForRequests(source)) {
      throw new Error("Selected NuGet source is unavailable. Disable it or choose another source before installing packages.");
    }

    const requestedVersion = request.version?.trim();
    let inPlaceUpdatedProjects = 0;

    for (const project of selectedProjects) {
      const hasPackageReference = project.packages.some((packageReference) => packageReference.id.toLowerCase() === request.packageId.toLowerCase());

      if (hasPackageReference && requestedVersion) {
        const updated = await this.UpdatePackageVersionInProjectOrCentral(project.path, request.packageId, requestedVersion);

        if (updated) {
          inPlaceUpdatedProjects += 1;
          continue;
        }
      }

      const args = ["add", project.path, "package", request.packageId];

      if (requestedVersion) {
        args.push("--version", requestedVersion);
      }

      if (source?.url) {
        args.push("--source", source.url);
      }

      await this.RunDotnet(args);
    }

    const verificationFailures = await this.VerifyPackageApplied(
      selectedProjects.map((project) => project.id),
      request.packageId,
      requestedVersion
    );

    if (verificationFailures.length > 0) {
      throw new Error([
        "Package operation finished, but verification failed for some projects.",
        ...verificationFailures
      ].join("\n"));
    }

    return inPlaceUpdatedProjects > 0
      ? `Applied ${request.packageId} in ${selectedProjects.length} project(s); ${inPlaceUpdatedProjects} project(s) were updated directly in XML and verified.`
      : `Installed ${request.packageId} in ${selectedProjects.length} project(s) and verified.`;
  }

  public async BulkInstallPackages(request: BulkInstallPackageRequest, projects: NugetWorkspacePayload["projects"]): Promise<string> {
    let operationCount = 0;
    const failures: string[] = [];

    for (const item of request.items) {
      const selectedProjects = projects.filter(
        (project) =>
          item.projectIds.includes(project.id) &&
          project.packages.some((packageReference) => packageReference.id.toLowerCase() === item.packageId.toLowerCase())
      );

      for (const project of selectedProjects) {
        const targetVersion = item.version.trim();

        if (!targetVersion) {
          failures.push(`Failed to update ${item.packageId} in ${project.name}.\nTarget version is empty.`);
          continue;
        }

        try {
          const updated = await this.UpdatePackageVersionInProjectOrCentral(project.path, item.packageId, targetVersion);

          if (updated) {
            operationCount += 1;
          } else {
            failures.push(`Failed to update ${item.packageId} in ${project.name}.\nNo editable PackageReference or Directory.Packages.props entry was found.`);
          }
        } catch (error) {
          failures.push(this.FormatCommandFailure(`Failed to update ${item.packageId} in ${project.name}.`, ["local-xml-update", project.path, item.packageId, targetVersion], error));
        }
      }
    }

    if (operationCount === 0 && failures.length === 0) {
      throw new Error("No matching package references were found in the selected projects.");
    }

    if (failures.length > 0) {
      const message =
        operationCount > 0
          ? `Updated ${operationCount} project reference(s), but ${failures.length} update operation(s) failed.`
          : `No package references were updated. ${failures.length} update operation(s) failed.`;
      throw new OperationError(message, failures.join("\n\n"));
    }

    const verificationFailures = await this.VerifyBulkPackageUpdates(request);

    if (verificationFailures.length > 0) {
      throw new OperationError(
        `Updated ${operationCount} project reference(s), but verification failed for ${verificationFailures.length} project/package pair(s).`,
        verificationFailures.join("\n\n")
      );
    }

    return `Updated ${request.items.length} package(s) across ${operationCount} project reference(s) and verified.`;
  }

  public async UninstallPackage(request: UninstallPackageRequest, projects: NugetWorkspacePayload["projects"]): Promise<string> {
    const packageId = request.packageId.toLowerCase();
    const selectedProjects = projects.filter(
      (project) =>
        request.projectIds.includes(project.id) &&
        project.packages.some((packageReference) => packageReference.id.toLowerCase() === packageId)
    );

    if (selectedProjects.length === 0) {
      throw new Error("Select at least one project with this package installed before uninstalling.");
    }

    for (const project of selectedProjects) {
      await this.RunDotnet(["remove", project.path, "package", request.packageId]);
    }

    return `Uninstalled ${request.packageId} from ${selectedProjects.length} project(s).`;
  }

  public async ListSources(checkHealth = true): Promise<NugetSource[]> {
    try {
      const { stdout } = await this.RunDotnet(["nuget", "list", "source"]);
      const sources = ParseNugetSources(stdout);

      if (!checkHealth) {
        return sources.map((source) => ({
          ...source,
          healthStatus: "unknown",
          healthMessage: "Skipped on load to keep refresh fast."
        }));
      }

      const sourceHealth = await MapWithConcurrencyLimit(sources, MaxFeedConcurrency, async (source) => ({
        sourceName: source.name,
        ...(await this.CheckSourceHealth(source))
      }));
      const healthBySource = new Map(sourceHealth.map((entry) => [entry.sourceName, entry]));

      return sources.map((source) => ({
        ...source,
        healthStatus: healthBySource.get(source.name)?.healthStatus ?? "unknown",
        healthMessage: healthBySource.get(source.name)?.healthMessage ?? "Source status was not checked."
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Could not read NuGet sources through 'dotnet nuget list source'. ${message}`);
    }
  }

  private GetWorkspaceLoadPerformanceSettings(): WorkspaceLoadPerformanceSettings {
    const config = vscode.workspace.getConfiguration(WorkspaceConfigurationSection);

    return {
      networkChecksOnLoad: config.get<boolean>("networkChecksOnLoad", false)
    };
  }

  private async UpdatePackageVersionInProjectOrCentral(projectPath: string, packageId: string, version: string): Promise<boolean> {
    const updatedInProject = await this.UpdatePackageReferenceVersion(projectPath, packageId, version);

    if (updatedInProject) {
      return true;
    }

    return await this.UpdateCentralPackageVersion(projectPath, packageId, version);
  }

  private async UpdatePackageReferenceVersion(projectPath: string, packageId: string, version: string): Promise<boolean> {
    const projectUri = vscode.Uri.file(projectPath);
    const { text, hasUtf8Bom } = await ReadUtf8TextFile(projectUri);
    const updated = ReplacePackageReferenceVersion(text, packageId, version);

    if (updated === text) {
      return false;
    }

    await WriteUtf8TextFile(projectUri, updated, hasUtf8Bom);
    return true;
  }

  private async UpdateCentralPackageVersion(projectPath: string, packageId: string, version: string): Promise<boolean> {
    let currentDirectory = path.dirname(projectPath);

    while (true) {
      const candidatePath = path.join(currentDirectory, "Directory.Packages.props");
      const candidateUri = vscode.Uri.file(candidatePath);

      try {
        await vscode.workspace.fs.stat(candidateUri);
      } catch {
        const parentDirectory = path.dirname(currentDirectory);

        if (parentDirectory === currentDirectory) {
          return false;
        }

        currentDirectory = parentDirectory;
        continue;
      }

      const { text, hasUtf8Bom } = await ReadUtf8TextFile(candidateUri);
      const updated = ReplaceCentralPackageVersion(text, packageId, version);

      if (updated !== text) {
        await WriteUtf8TextFile(candidateUri, updated, hasUtf8Bom);
        return true;
      }

      const parentDirectory = path.dirname(currentDirectory);

      if (parentDirectory === currentDirectory) {
        return false;
      }

      currentDirectory = parentDirectory;
    }
  }

  private async VerifyPackageApplied(projectIds: string[], packageId: string, expectedVersion?: string): Promise<string[]> {
    const scanResult = await this.scanner.Scan();
    const projectsById = new Map(scanResult.projects.map((project) => [project.id, project]));
    const failures: string[] = [];

    for (const projectId of projectIds) {
      const project = projectsById.get(projectId);

      if (!project) {
        failures.push(`Project id '${projectId}' was not found during verification.`);
        continue;
      }

      const packageReference = project.packages.find((candidate) => candidate.id.toLowerCase() === packageId.toLowerCase());

      if (!packageReference) {
        failures.push(`Project '${project.name}' does not reference package '${packageId}' after operation.`);
        continue;
      }

      if (expectedVersion?.trim() && packageReference.version.toLowerCase() !== expectedVersion.trim().toLowerCase()) {
        failures.push(
          `Project '${project.name}' has '${packageId}' version '${packageReference.version}', expected '${expectedVersion.trim()}'.`
        );
      }
    }

    return failures;
  }

  private async VerifyBulkPackageUpdates(request: BulkInstallPackageRequest): Promise<string[]> {
    const scanResult = await this.scanner.Scan();
    const projectsById = new Map(scanResult.projects.map((project) => [project.id, project]));
    const failures: string[] = [];

    request.items.forEach((item) => {
      const expectedVersion = item.version.trim();

      item.projectIds.forEach((projectId) => {
        const project = projectsById.get(projectId);

        if (!project) {
          failures.push(`Project id '${projectId}' was not found during verification for package '${item.packageId}'.`);
          return;
        }

        const packageReference = project.packages.find((candidate) => candidate.id.toLowerCase() === item.packageId.toLowerCase());

        if (!packageReference) {
          failures.push(`Project '${project.name}' does not reference package '${item.packageId}' after update.`);
          return;
        }

        if (expectedVersion && packageReference.version.toLowerCase() !== expectedVersion.toLowerCase()) {
          failures.push(
            `Project '${project.name}' has '${item.packageId}' version '${packageReference.version}', expected '${expectedVersion}'.`
          );
        }
      });
    });

    return failures;
  }

  private async CheckSourceHealth(source: NugetSource): Promise<Pick<NugetSource, "healthStatus" | "healthMessage">> {
    try {
      if (IsHttpSource(source.url)) {
        await FetchServiceIndex(source.url, SourceHealthTimeoutMs);

        return {
          healthStatus: "ok",
          healthMessage: source.enabled ? "Source is available." : "Source is healthy but disabled."
        };
      }

      await access(source.url);

      return {
        healthStatus: "ok",
        healthMessage: source.enabled ? "Local source path is accessible." : "Local source path is accessible, but source is disabled."
      };
    } catch (error) {
      return {
        healthStatus: "error",
        healthMessage: error instanceof Error ? error.message : "Source health check failed."
      };
    }
  }

  private async ApplyVulnerabilities(
    packageGroups: PackageGroupInfo[],
    projects: NugetWorkspacePayload["projects"]
  ): Promise<void> {
    const vulnerabilityResults = await MapWithConcurrencyLimit(projects, MaxDotnetConcurrency, async (project) => await this.LoadProjectVulnerabilities(project));
    const vulnerabilitiesByPackage = new Map<string, PackageVulnerabilityInfo[]>();

    vulnerabilityResults.flat().forEach((vulnerability) => {
      const key = vulnerability.packageId.toLowerCase();
      const existing = vulnerabilitiesByPackage.get(key) ?? [];
      existing.push({
        projectId: vulnerability.projectId,
        projectName: vulnerability.projectName,
        version: vulnerability.version,
        severity: vulnerability.severity,
        advisoryUrl: vulnerability.advisoryUrl
      });
      vulnerabilitiesByPackage.set(key, existing);
    });

    packageGroups.forEach((packageGroup) => {
      packageGroup.vulnerabilities = vulnerabilitiesByPackage.get(packageGroup.id.toLowerCase()) ?? [];
    });
  }

  private async ApplyLatestVersions(
    packageGroups: PackageGroupInfo[],
    sources: NugetSource[],
    selectedSourceName: string,
    includePrerelease: boolean
  ): Promise<void> {
    const availabilitySources = SelectPackageAvailabilitySources(sources, AllSourcesName);
    const sourceRegistrations = (await MapWithConcurrencyLimit(availabilitySources, MaxFeedConcurrency, async (source) => {
      try {
        return {
          source,
          registrationsBaseUrl: await ResolveRegistrationsBaseUrl(source.url)
        };
      } catch {
        return undefined;
      }
    })).filter((entry): entry is { source: NugetSource; registrationsBaseUrl: string } => Boolean(entry));

    const versionsCache = new Map<string, Promise<string[]>>();

    const loadVersions = (entry: { source: NugetSource; registrationsBaseUrl: string }, packageId: string): Promise<string[]> => {
      const cacheKey = `${entry.source.name}\n${entry.registrationsBaseUrl}\n${packageId.toLowerCase()}\n${includePrerelease ? "prerelease" : "stable"}`;
      const cached = versionsCache.get(cacheKey);

      if (cached) {
        return cached;
      }

      const pending = FetchPackageVersionsFromRegistrationsBaseUrl(entry.registrationsBaseUrl, packageId, includePrerelease);
      versionsCache.set(cacheKey, pending);
      return pending;
    };

    await MapWithConcurrencyLimit(packageGroups, MaxFeedConcurrency, async (packageGroup) => {
      const latestVersionEntries = (await Promise.all(sourceRegistrations.map(async (registration) => {
        try {
          const versions = await loadVersions(registration, packageGroup.id);
          const latestVersion = versions[0];

          if (!latestVersion) {
            return undefined;
          }

          return [registration.source.name, latestVersion] as const;
        } catch {
          return undefined;
        }
      }))).filter((entry): entry is readonly [string, string] => Boolean(entry));

      const latestVersionBySource = Object.fromEntries(latestVersionEntries);
      const availableSourceNames = Object.keys(latestVersionBySource);
      const latestVersionInAllSources = availableSourceNames.reduce<string | undefined>((currentHighest, sourceName) => {
        const candidateVersion = latestVersionBySource[sourceName];

        if (!candidateVersion) {
          return currentHighest;
        }

        if (!currentHighest || CompareVersions(candidateVersion, currentHighest) > 0) {
          return candidateVersion;
        }

        return currentHighest;
      }, undefined);
      const latestVersion = selectedSourceName === AllSourcesName || selectedSourceName.trim().length === 0
        ? latestVersionInAllSources
        : latestVersionBySource[selectedSourceName];

      packageGroup.availableInSelectedSource = selectedSourceName === AllSourcesName || selectedSourceName.trim().length === 0
        ? availableSourceNames.length > 0
        : availableSourceNames.includes(selectedSourceName);
      packageGroup.availableSourceNames = availableSourceNames;
      packageGroup.latestVersion = latestVersion;
      packageGroup.latestVersionBySource = latestVersionBySource;
      packageGroup.latestVersionInAllSources = latestVersionInAllSources;
      packageGroup.hasUpdate = latestVersion ? packageGroup.versions.some((version) => CompareVersions(latestVersion, version) > 0) : false;
      packageGroup.hasUpdateInAllSources = latestVersionInAllSources
        ? packageGroup.versions.some((version) => CompareVersions(latestVersionInAllSources, version) > 0)
        : false;
    });
  }

  private async LoadProjectVulnerabilities(project: NugetWorkspacePayload["projects"][number]): Promise<Array<PackageVulnerabilityInfo & { packageId: string }>> {
    try {
      const { stdout } = await this.RunDotnet(["list", project.path, "package", "--vulnerable", "--include-transitive", "--format", "json"]);
      const parsed = JSON.parse(stdout) as unknown;
      return ExtractVulnerabilities(parsed).map((vulnerability) => ({
        ...vulnerability,
        projectId: project.id,
        projectName: project.name
      }));
    } catch {
      return [];
    }
  }

  private AppendSourceAuthentication(args: string[], request: AddSourceRequest): void {
    if (request.authMode !== "basic") {
      return;
    }

    if (!request.username?.trim() || !request.password) {
      throw new Error("Username and password are required for basic NuGet source authentication.");
    }

    args.push("--username", request.username.trim(), "--password", request.password, "--store-password-in-clear-text");
  }

  private async RunDotnet(args: string[]): Promise<{ stdout: string; stderr: string }> {
    await mkdir(this.dotnetCliHome, { recursive: true });

    return await execFileAsync("dotnet", args, {
      env: {
        ...process.env,
        DOTNET_CLI_HOME: this.dotnetCliHome,
        DOTNET_CLI_UI_LANGUAGE: "en",
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
        DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1"
      },
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 4
    });
  }

  private FormatCommandFailure(context: string, args: string[], error: unknown): string {
    const parts = [context, `Command: dotnet ${args.map(QuoteShellArg).join(" ")}`];
    const details = ExtractDotnetErrorDetails(error);

    if (details) {
      parts.push(details);
    }

    return parts.join("\n");
  }
}

function ExtractDotnetErrorDetails(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown error.";
  }

  const candidate = error as Error & {
    stdout?: string;
    stderr?: string;
    code?: number | string;
    signal?: string;
    cmd?: string;
  };
  const parts: string[] = [];
  const stderr = candidate.stderr?.trim();
  const stdout = candidate.stdout?.trim();

  if (candidate.code !== undefined) {
    parts.push(`Exit code: ${String(candidate.code)}`);
  }

  if (candidate.signal) {
    parts.push(`Signal: ${candidate.signal}`);
  }

  if (stderr) {
    parts.push(`stderr:\n${stderr}`);
  }

  if (stdout) {
    parts.push(`stdout:\n${stdout}`);
  }

  if (parts.length === 0) {
    parts.push(error.message);
  }

  return parts.join("\n");
}

function QuoteShellArg(value: string): string {
  return /[\s"]/u.test(value) ? `"${value.replaceAll("\"", '\\\"')}"` : value;
}

function BuildPackageGroups(packages: NugetWorkspacePayload["projects"][number]["packages"]): PackageGroupInfo[] {
  const grouped = new Map<string, PackageGroupInfo>();

  packages.forEach((packageReference) => {
    const existing = grouped.get(packageReference.id) ?? {
      id: packageReference.id,
      versions: [],
      projects: [],
      vulnerabilities: []
    };

    existing.projects.push(packageReference);

    if (!existing.versions.includes(packageReference.version)) {
      existing.versions.push(packageReference.version);
    }

    grouped.set(packageReference.id, existing);
  });

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      versions: group.versions.sort(CompareVersions),
      isConsolidated: group.versions.length === 1
    }))
    .sort((left, right) => left.id.localeCompare(right.id, undefined, { sensitivity: "base" }));
}

function ParseNugetSources(output: string): NugetSource[] {
  const lines = output.split(/\r?\n/);
  const sources: NugetSource[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const sourceLine = lines[index].match(/^\s*\d+\.\s+(.+?)\s+\[([^\]]+)\]\s*$/i);

    if (!sourceLine) {
      continue;
    }

    const url = lines[index + 1]?.trim() ?? "";
    sources.push({
      name: sourceLine[1].trim(),
      url,
      enabled: !/^(disabled|wyłączone|wylaczone|wyłączono|wylaczono)$/i.test(sourceLine[2].trim())
    });
  }

  return sources;
}

function ExtractVulnerabilities(value: unknown): Array<{
  packageId: string;
  version: string;
  severity: string;
  advisoryUrl: string;
}> {
  const results: Array<{
    packageId: string;
    version: string;
    severity: string;
    advisoryUrl: string;
  }> = [];

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    const record = node as Record<string, unknown>;
    const vulnerabilities = record.vulnerabilities;
    const packageId = String(record.id ?? record.name ?? record.packageId ?? "");
    const version = String(record.resolvedVersion ?? record.version ?? record.requestedVersion ?? "");

    if (packageId && Array.isArray(vulnerabilities)) {
      vulnerabilities.forEach((vulnerability) => {
        if (!vulnerability || typeof vulnerability !== "object") {
          return;
        }

        const vulnerabilityRecord = vulnerability as Record<string, unknown>;
        results.push({
          packageId,
          version,
          severity: String(vulnerabilityRecord.severity ?? "Unknown"),
          advisoryUrl: String(vulnerabilityRecord.advisoryUrl ?? vulnerabilityRecord.url ?? "")
        });
      });
    }

    Object.values(record).forEach(visit);
  };

  visit(value);
  return results;
}

function SelectPackageDetailsSources(sources: NugetSource[], sourceName: string): NugetSource[] {
  const enabledHttpSources = sources.filter((source) => IsSourceUsableForRequests(source) && IsHttpSource(source.url));
  const ordered =
    sourceName === AllSourcesName || sourceName.trim().length === 0
      ? enabledHttpSources
      : [
        ...enabledHttpSources.filter((source) => source.name === sourceName),
        ...enabledHttpSources.filter((source) => source.name !== sourceName)
      ];
  const unique = new Map<string, NugetSource>();

  ordered.forEach((source) => {
    unique.set(`${source.name}\n${source.url}`, source);
  });

  return Array.from(unique.values());
}

function SelectPackageAvailabilitySources(sources: NugetSource[], sourceName: string): NugetSource[] {
  const enabledHttpSources = sources.filter((source) => IsSourceUsableForRequests(source) && IsHttpSource(source.url));

  if (sourceName === AllSourcesName || sourceName.trim().length === 0) {
    return enabledHttpSources;
  }

  return enabledHttpSources.filter((source) => source.name === sourceName);
}

function IsHttpSource(sourceUrl: string): boolean {
  return /^https?:\/\//i.test(sourceUrl.trim());
}

async function SearchSource(sourceUrl: string, query: string, includePrerelease: boolean, skip: number, take: number): Promise<BrowsePackageInfo[]> {
  const serviceIndexUrl = sourceUrl.trim();

  if (!IsHttpSource(serviceIndexUrl)) {
    throw new Error("Browsing is available for HTTP NuGet v3 sources. Local sources are listed in settings but cannot be searched in this view.");
  }

  const serviceIndex = await FetchServiceIndex(serviceIndexUrl);
  const searchService = FindServiceResource(serviceIndex, "searchqueryservice");

  if (!searchService?.["@id"]) {
    throw new Error("Selected NuGet source does not expose a search endpoint.");
  }

  const url = new URL(searchService["@id"]);
  url.searchParams.set("q", query);
  url.searchParams.set("skip", String(skip));
  url.searchParams.set("take", String(take));
  url.searchParams.set("prerelease", includePrerelease ? "true" : "false");
  url.searchParams.set("semVerLevel", "2.0.0");

  const result = await FetchJson<{
    data?: Array<{
      id?: string;
      version?: string;
      description?: string;
      authors?: string | string[];
      totalDownloads?: number;
      verified?: boolean;
      iconUrl?: string;
      versions?: Array<{
        version?: string;
      }>;
    }>;
  }>(url.toString());

  return (result.data ?? []).map((item) => ({
    id: item.id ?? "",
    version: item.version ?? "",
    versions: BuildPackageVersions(item.version, item.versions),
    description: item.description ?? "",
    authors: Array.isArray(item.authors) ? item.authors.join(", ") : item.authors ?? "",
    downloads: item.totalDownloads,
    verified: item.verified ?? false,
    iconUrl: item.iconUrl
  }));
}

async function FetchPackageDetails(sourceUrl: string, packageId: string, version: string, includePrerelease: boolean): Promise<PackageDetailsPayload["details"]> {
  const serviceIndex = await FetchServiceIndex(sourceUrl);
  const registrationsBaseUrl = GetRegistrationsBaseUrl(serviceIndex);

  const registration = await FetchRegistrationLeaf(registrationsBaseUrl, packageId, version);
  const catalogEntry = await ResolveCatalogEntry(registration.catalogEntry);
  const resolvedVersion = catalogEntry.version ?? version;
  const availableVersions = await FetchPackageVersionsFromRegistrationsBaseUrl(registrationsBaseUrl, packageId, includePrerelease);
  const readmeUrl = catalogEntry.readmeUrl || BuildReadmeUrl(FindServiceResource(serviceIndex, "readmeuritemplate")?.["@id"], packageId, resolvedVersion);
  const readme = readmeUrl ? await TryFetchText(readmeUrl) : "";

  return {
    id: catalogEntry.id ?? packageId,
    version: resolvedVersion,
    availableVersions,
    description: catalogEntry.description ?? "",
    authors: Array.isArray(catalogEntry.authors) ? catalogEntry.authors.join(", ") : catalogEntry.authors ?? "",
    license: catalogEntry.licenseExpression || catalogEntry.licenseUrl || "",
    projectUrl: catalogEntry.projectUrl ?? "",
    reportAbuseUrl: `https://www.nuget.org/packages/${encodeURIComponent(packageId)}/${encodeURIComponent(version)}/ReportAbuse`,
    tags: Array.isArray(catalogEntry.tags) ? catalogEntry.tags : (catalogEntry.tags ?? "").split(/\s+/).filter((tag) => tag.length > 0),
    published: catalogEntry.published ?? "",
    readmeUrl: readmeUrl ?? "",
    readme,
    dependencies: NormalizeDependencyGroups(catalogEntry)
  };
}

async function FetchPackageVersions(sourceUrl: string, packageId: string, includePrerelease: boolean): Promise<string[]> {
  return await FetchPackageVersionsFromRegistrationsBaseUrl(await ResolveRegistrationsBaseUrl(sourceUrl), packageId, includePrerelease);
}

async function FetchPackageVersionsFromRegistrationsBaseUrl(registrationsBaseUrl: string, packageId: string, includePrerelease: boolean): Promise<string[]> {
  const normalizedBaseUrl = registrationsBaseUrl.endsWith("/") ? registrationsBaseUrl : `${registrationsBaseUrl}/`;
  const encodedPackageId = encodeURIComponent(packageId.toLowerCase());
  const index = await FetchJson<{
    items?: Array<{
      items?: NugetRegistrationLeaf[];
      "@id"?: string;
    }>;
  }>(`${normalizedBaseUrl}${encodedPackageId}/index.json`);
  const versions = new Set<string>();

  for (const page of index.items ?? []) {
    const pageItems = page.items ?? (page["@id"] ? (await FetchJson<{ items?: NugetRegistrationLeaf[] }>(page["@id"])).items ?? [] : []);

    pageItems.forEach((item) => {
      const version = GetCatalogEntryVersion(item.catalogEntry);

      if (version && (includePrerelease || !IsPrereleaseVersion(version))) {
        versions.add(version);
      }
    });
  }

  return Array.from(versions).sort((left, right) => CompareVersions(right, left));
}

async function ResolveRegistrationsBaseUrl(sourceUrl: string): Promise<string> {
  return GetRegistrationsBaseUrl(await FetchServiceIndex(sourceUrl));
}

function GetRegistrationsBaseUrl(serviceIndex: ServiceIndex): string {
  const registrationsBaseUrl = FindServiceResource(serviceIndex, "registrationsbaseurl")?.["@id"];

  if (!registrationsBaseUrl) {
    throw new Error("Selected NuGet source does not expose a registration endpoint.");
  }

  return registrationsBaseUrl;
}

function IsPrereleaseVersion(version: string): boolean {
  return version.includes("-");
}

async function FetchRegistrationLeaf(registrationsBaseUrl: string, packageId: string, version: string): Promise<NugetRegistrationLeaf> {
  const normalizedBaseUrl = registrationsBaseUrl.endsWith("/") ? registrationsBaseUrl : `${registrationsBaseUrl}/`;
  const encodedPackageId = encodeURIComponent(packageId.toLowerCase());
  const encodedVersion = encodeURIComponent(version.toLowerCase());
  const registrationUrl = `${normalizedBaseUrl}${encodedPackageId}/${encodedVersion}.json`;

  try {
    return await FetchJson(registrationUrl);
  } catch {
    const index = await FetchJson<{
      items?: Array<{
        items?: NugetRegistrationLeaf[];
        "@id"?: string;
      }>;
    }>(`${normalizedBaseUrl}${encodedPackageId}/index.json`);
    const lowerVersion = version.toLowerCase();

    for (const page of index.items ?? []) {
      const pageItems = page.items ?? (page["@id"] ? (await FetchJson<{ items?: NugetRegistrationLeaf[] }>(page["@id"])).items ?? [] : []);
      const match = pageItems.find((item) => GetCatalogEntryVersion(item.catalogEntry)?.toLowerCase() === lowerVersion);

      if (match) {
        return match;
      }
    }

    throw new Error(`Package ${packageId} ${version} was not found in registration index.`);
  }
}

async function ResolveCatalogEntry(catalogEntry: NugetRegistrationLeaf["catalogEntry"]): Promise<NugetCatalogEntry> {
  if (!catalogEntry) {
    return {};
  }

  if (typeof catalogEntry === "string") {
    return await FetchJson<NugetCatalogEntry>(catalogEntry);
  }

  return catalogEntry;
}

function GetCatalogEntryVersion(catalogEntry: NugetRegistrationLeaf["catalogEntry"]): string | undefined {
  return typeof catalogEntry === "object" ? catalogEntry.version : undefined;
}

function NormalizeDependencyGroups(catalogEntry: NugetCatalogEntry): PackageDetailsPayload["details"]["dependencies"] {
  const dependencyGroups = Array.isArray(catalogEntry.dependencyGroups)
    ? catalogEntry.dependencyGroups
    : catalogEntry.dependencies
      ? [{ targetFramework: "Any", dependencies: catalogEntry.dependencies }]
      : [];

  return dependencyGroups
    .map((group) => {
      const groupRecord = IsRecord(group) ? group : {};
      const dependencies = NormalizeDependencies(groupRecord.dependencies);

      return {
        targetFramework: String(groupRecord.targetFramework ?? groupRecord.targetFrameworkName ?? groupRecord.framework ?? "Any"),
        dependencies
      };
    })
    .filter((group) => group.dependencies.length > 0);
}

function NormalizeDependencies(dependencies: unknown): PackageDetailsPayload["details"]["dependencies"][number]["dependencies"] {
  if (!dependencies) {
    return [];
  }

  if (Array.isArray(dependencies)) {
    return dependencies.flatMap((dependency) => NormalizeDependency(dependency));
  }

  if (IsRecord(dependencies)) {
    return Object.entries(dependencies).flatMap(([id, dependency]) => NormalizeDependency(dependency, id));
  }

  return [];
}

function NormalizeDependency(dependency: unknown, fallbackId = ""): PackageDetailsPayload["details"]["dependencies"][number]["dependencies"] {
  if (!IsRecord(dependency)) {
    return [];
  }

  const id = String(dependency.id ?? dependency.packageId ?? fallbackId).trim();

  if (!id) {
    return [];
  }

  return [
    {
      id,
      range: String(dependency.range ?? dependency.versionRange ?? dependency.version ?? "").trim()
    }
  ];
}

function IsRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function FindServiceResource(serviceIndex: ServiceIndex, typeFragment: string): ServiceIndexResource | undefined {
  const loweredTypeFragment = typeFragment.toLowerCase();

  return serviceIndex.resources?.find((resource) => {
    const types = Array.isArray(resource["@type"]) ? resource["@type"] : [resource["@type"] ?? ""];
    return types.some((type) => type.toLowerCase().includes(loweredTypeFragment));
  });
}

function BuildReadmeUrl(template: string | undefined, packageId: string, version: string): string {
  if (!template) {
    return "";
  }

  const lowerId = encodeURIComponent(packageId.toLowerCase());
  const lowerVersion = encodeURIComponent(version.toLowerCase());

  return template
    .replaceAll("{lower_id}", lowerId)
    .replaceAll("{lower_version}", lowerVersion)
    .replaceAll("{id}", encodeURIComponent(packageId))
    .replaceAll("{version}", encodeURIComponent(version));
}

function ScorePackageDetails(details: PackageDetailsPayload["details"]): number {
  return (
    (details.readme.trim().length > 0 ? 1000 : 0) +
    (details.dependencies.length > 0 ? 100 : 0) +
    (details.description.trim().length > 0 ? 10 : 0) +
    (details.authors.trim().length > 0 ? 5 : 0) +
    (details.projectUrl.trim().length > 0 ? 2 : 0) +
    (details.license.trim().length > 0 ? 1 : 0)
  );
}

async function FetchServiceIndex(sourceUrl: string, timeoutMs = FeedRequestTimeoutMs): Promise<ServiceIndex> {
  const serviceIndexUrl = sourceUrl.trim();

  if (!IsHttpSource(serviceIndexUrl)) {
    throw new Error("Package details are available for HTTP NuGet v3 sources.");
  }

  return await FetchJson<ServiceIndex>(serviceIndexUrl, timeoutMs);
}

function BuildPackageVersions(latestVersion: string | undefined, versions: Array<{ version?: string }> | undefined): string[] {
  const allVersions = new Set<string>();

  if (latestVersion) {
    allVersions.add(latestVersion);
  }

  (versions ?? []).forEach((versionInfo) => {
    if (versionInfo.version) {
      allVersions.add(versionInfo.version);
    }
  });

  return Array.from(allVersions).sort((left, right) => CompareVersions(right, left));
}

async function FetchJson<T>(url: string, timeoutMs = FeedRequestTimeoutMs): Promise<T> {
  const response = await FetchWithTimeout(url, timeoutMs);

  if (!response.ok) {
    throw new Error(`NuGet source returned HTTP ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function FetchText(url: string): Promise<string> {
  const response = await FetchWithTimeout(url, FeedRequestTimeoutMs);

  if (!response.ok) {
    throw new Error(`NuGet source returned HTTP ${response.status}.`);
  }

  return await response.text();
}

async function FetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`NuGet source did not respond within ${timeoutMs / 1000} seconds.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function IsSourceUsableForRequests(source: NugetSource): boolean {
  return source.enabled && source.healthStatus !== "error";
}

async function TryFetchText(url: string): Promise<string> {
  try {
    return await FetchText(url);
  } catch {
    return "";
  }
}

async function MapWithConcurrencyLimit<TInput, TResult>(
  items: readonly TInput[],
  concurrencyLimit: number,
  mapItem: (item: TInput, index: number) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrencyLimit, items.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapItem(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

function CompareVersions(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

async function ReadUtf8TextFile(fileUri: vscode.Uri): Promise<{ text: string; hasUtf8Bom: boolean }> {
  const bytes = await vscode.workspace.fs.readFile(fileUri);
  const buffer = Buffer.from(bytes);
  const hasUtf8Bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  const text = new TextDecoder("utf-8").decode(hasUtf8Bom ? buffer.subarray(3) : buffer);

  return { text, hasUtf8Bom };
}

async function WriteUtf8TextFile(fileUri: vscode.Uri, text: string, withUtf8Bom: boolean): Promise<void> {
  const encoded = new TextEncoder().encode(text);

  if (!withUtf8Bom) {
    await vscode.workspace.fs.writeFile(fileUri, encoded);
    return;
  }

  const output = new Uint8Array(encoded.length + 3);
  output[0] = 0xef;
  output[1] = 0xbb;
  output[2] = 0xbf;
  output.set(encoded, 3);
  await vscode.workspace.fs.writeFile(fileUri, output);
}

function ReplacePackageReferenceVersion(xmlText: string, packageId: string, version: string): string {
  const normalizedId = packageId.toLowerCase();
  const blockPattern = /<PackageReference\b[^>]*>([\s\S]*?)<\/PackageReference>/gi;

  let updated = xmlText.replace(blockPattern, (fullMatch) => {
    if (!HasPackageIdInPackageReference(fullMatch, normalizedId)) {
      return fullMatch;
    }

    if (/\sVersion\s*=\s*["'][^"']*["']/i.test(fullMatch)) {
      return fullMatch.replace(/(\sVersion\s*=\s*["'])[^"']*(["'])/i, `$1${EscapeAttribute(version)}$2`);
    }

    if (/<Version\b[^>]*>[\s\S]*?<\/Version>/i.test(fullMatch)) {
      return fullMatch.replace(/(<Version\b[^>]*>)[\s\S]*?(<\/Version>)/i, `$1${EscapeXml(version)}$2`);
    }

    return fullMatch.replace(/\/>\s*$/u, ` Version="${EscapeAttribute(version)}" />`);
  });

  const selfClosingPattern = /<PackageReference\b[^>]*\/\s*>/gi;
  updated = updated.replace(selfClosingPattern, (fullMatch) => {
    if (!HasPackageIdInPackageReference(fullMatch, normalizedId)) {
      return fullMatch;
    }

    if (/\sVersion\s*=\s*["'][^"']*["']/i.test(fullMatch)) {
      return fullMatch.replace(/(\sVersion\s*=\s*["'])[^"']*(["'])/i, `$1${EscapeAttribute(version)}$2`);
    }

    return fullMatch.replace(/\/>\s*$/u, ` Version="${EscapeAttribute(version)}" />`);
  });

  return updated;
}

function ReplaceCentralPackageVersion(xmlText: string, packageId: string, version: string): string {
  const normalizedId = packageId.toLowerCase();
  const pattern = /<PackageVersion\b[^>]*\/\s*>|<PackageVersion\b[^>]*>[\s\S]*?<\/PackageVersion>/gi;

  return xmlText.replace(pattern, (fullMatch) => {
    if (!HasPackageIdInPackageReference(fullMatch, normalizedId, ["Include", "Update"])) {
      return fullMatch;
    }

    if (/\sVersion\s*=\s*["'][^"']*["']/i.test(fullMatch)) {
      return fullMatch.replace(/(\sVersion\s*=\s*["'])[^"']*(["'])/i, `$1${EscapeAttribute(version)}$2`);
    }

    if (/<Version\b[^>]*>[\s\S]*?<\/Version>/i.test(fullMatch)) {
      return fullMatch.replace(/(<Version\b[^>]*>)[\s\S]*?(<\/Version>)/i, `$1${EscapeXml(version)}$2`);
    }

    return fullMatch.replace(/\/>\s*$/u, ` Version="${EscapeAttribute(version)}" />`);
  });
}

function HasPackageIdInPackageReference(xmlElement: string, normalizedPackageId: string, attributeNames = ["Include", "Update", "Remove"]): boolean {
  return attributeNames.some((attributeName) => {
    const match = new RegExp(`\\b${attributeName}\\s*=\\s*["']([^"']+)["']`, "i").exec(xmlElement);
    return match ? match[1].trim().toLowerCase() === normalizedPackageId : false;
  });
}

function EscapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function EscapeAttribute(value: string): string {
  return EscapeXml(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
