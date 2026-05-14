import { expect, type Page, test } from "@playwright/test";

type WebviewMessage = {
    type: string;
    payload?: unknown;
};

function createWorkspaceLoadedPayload(options: { isConsolidated: boolean; requestId?: number }) {
    const versions = options.isConsolidated ? ["2.0.0"] : ["1.0.0", "2.0.0"];

    return {
        solutionPath: "Test.sln",
        workspaceSettings: {
            useAllProjects: false,
            solutionPath: "Test.sln",
            availableSolutions: ["Test.sln"]
        },
        projects: [
            {
                id: "api",
                name: "ApiService",
                path: "c:/repo/src/ApiService/ApiService.csproj",
                relativePath: "src/ApiService/ApiService.csproj",
                packages: [
                    {
                        id: "Critical.Package",
                        version: versions[0],
                        projectId: "api",
                        projectName: "ApiService",
                        projectPath: "c:/repo/src/ApiService/ApiService.csproj",
                        relativeProjectPath: "src/ApiService/ApiService.csproj"
                    }
                ]
            }
        ],
        installedPackages: [
            {
                id: "Critical.Package",
                versions,
                projects: [
                    {
                        id: "Critical.Package",
                        version: versions[0],
                        projectId: "api",
                        projectName: "ApiService",
                        projectPath: "c:/repo/src/ApiService/ApiService.csproj",
                        relativeProjectPath: "src/ApiService/ApiService.csproj"
                    }
                ],
                availableInSelectedSource: true,
                availableSourceNames: ["nuget.org"],
                hasUpdate: false,
                isConsolidated: options.isConsolidated,
                vulnerabilities: [
                    {
                        projectId: "api",
                        projectName: "ApiService",
                        version: versions[0],
                        severity: "High",
                        advisoryUrl: "https://example.test/advisory"
                    }
                ]
            }
        ],
        sources: [
            {
                name: "broken",
                url: "https://broken-source.example/v3/index.json",
                enabled: true,
                healthStatus: "error",
                healthMessage: "Source health check failed"
            },
            {
                name: "nuget.org",
                url: "https://api.nuget.org/v3/index.json",
                enabled: true,
                healthStatus: "ok",
                healthMessage: "Source is available"
            }
        ],
        errors: [],
        options: {
            selectedSourceName: "nuget.org",
            includePrerelease: false
        },
        status: "success",
        message: "Workspace loaded.",
        requestId: options.requestId
    };
}

async function dispatchWebviewMessage(page: Page, message: WebviewMessage) {
    await page.evaluate((nextMessage) => {
        window.dispatchEvent(new MessageEvent("message", { data: nextMessage }));
    }, message);
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        const stateStore = { value: undefined as unknown };

        Object.defineProperty(window, "acquireVsCodeApi", {
            value: () => ({
                getState: () => stateStore.value,
                setState: (nextState: unknown) => {
                    stateStore.value = nextState;
                },
                postMessage: (message: { type: string }) => {
                    if (message.type === "ready") {
                        window.dispatchEvent(
                            new MessageEvent("message", {
                                data: {
                                    type: "workspaceLoaded",
                                    payload: {
                                        solutionPath: "Test.sln",
                                        workspaceSettings: {
                                            useAllProjects: false,
                                            solutionPath: "Test.sln",
                                            availableSolutions: ["Test.sln"]
                                        },
                                        projects: [
                                            {
                                                id: "api",
                                                name: "ApiService",
                                                path: "c:/repo/src/ApiService/ApiService.csproj",
                                                relativePath: "src/ApiService/ApiService.csproj",
                                                packages: [
                                                    {
                                                        id: "Critical.Package",
                                                        version: "1.0.0",
                                                        projectId: "api",
                                                        projectName: "ApiService",
                                                        projectPath: "c:/repo/src/ApiService/ApiService.csproj",
                                                        relativeProjectPath: "src/ApiService/ApiService.csproj"
                                                    }
                                                ]
                                            }
                                        ],
                                        installedPackages: [
                                            {
                                                id: "Critical.Package",
                                                versions: ["1.0.0"],
                                                projects: [
                                                    {
                                                        id: "Critical.Package",
                                                        version: "1.0.0",
                                                        projectId: "api",
                                                        projectName: "ApiService",
                                                        projectPath: "c:/repo/src/ApiService/ApiService.csproj",
                                                        relativeProjectPath: "src/ApiService/ApiService.csproj"
                                                    }
                                                ],
                                                availableInSelectedSource: false,
                                                availableSourceNames: [],
                                                hasUpdate: false,
                                                isConsolidated: true,
                                                vulnerabilities: [
                                                    {
                                                        projectId: "api",
                                                        projectName: "ApiService",
                                                        version: "1.0.0",
                                                        severity: "High",
                                                        advisoryUrl: "https://example.test/advisory"
                                                    }
                                                ]
                                            }
                                        ],
                                        sources: [
                                            {
                                                name: "broken",
                                                url: "https://broken-source.example/v3/index.json",
                                                enabled: true,
                                                healthStatus: "error",
                                                healthMessage: "Source health check failed"
                                            },
                                            {
                                                name: "nuget.org",
                                                url: "https://api.nuget.org/v3/index.json",
                                                enabled: true,
                                                healthStatus: "ok",
                                                healthMessage: "Source is available"
                                            }
                                        ],
                                        errors: [],
                                        options: {
                                            selectedSourceName: "broken",
                                            includePrerelease: false
                                        },
                                        status: "success",
                                        message: "Workspace loaded."
                                    }
                                }
                            })
                        );
                        return;
                    }

                    if (message.type === "refresh") {
                        return;
                    }
                }
            })
        });
    });

    await page.goto("/");
});

test("operation log opens only on Logs click", async ({ page }) => {
    await dispatchWebviewMessage(page, {
        type: "error",
        payload: {
            message: "Bulk package update failed.",
            details: "Operation log\nFailed to update package in project."
        }
    });

    await expect(page.locator(".operationErrorPanel")).toHaveCount(0);

    const logsButton = page.getByRole("button", { name: "Logs" });
    await expect(logsButton).toBeVisible();

    await logsButton.click();
    await expect(page.locator(".operationErrorPanel")).toBeVisible();
    await expect(page.locator(".operationErrorPanel pre")).toContainText("Failed to update package in project.");

    await page.getByRole("button", { name: "Hide logs" }).click();
    await expect(page.locator(".operationErrorPanel")).toHaveCount(0);
});

test("vulnerabilities remain visible even when selected source is broken", async ({ page }) => {
    await page.getByRole("button", { name: "VULNERABILITIES" }).click();

    await expect(page.getByText("Critical.Package")).toBeVisible();
    await expect(page.getByText("No vulnerabilities found.")).toHaveCount(0);
});

test("consolidated list updates when workspaceLoaded has no requestId during pending refresh", async ({ page }) => {
    await dispatchWebviewMessage(page, {
        type: "workspaceLoaded",
        payload: createWorkspaceLoadedPayload({ isConsolidated: false })
    });

    await page.getByRole("button", { name: "CONSOLIDATED" }).click();
    await expect(page.getByText("Critical.Package")).toBeVisible();

    await page.locator(".refreshButton").click();

    await dispatchWebviewMessage(page, {
        type: "workspaceLoaded",
        payload: createWorkspaceLoadedPayload({ isConsolidated: true })
    });

    await expect(page.getByText("Critical.Package")).toHaveCount(0);
    await expect(page.getByText("No consolidation needed.")).toBeVisible();
});

test("updates stay visible for project packages when EF Design reference is present", async ({ page }) => {
    await dispatchWebviewMessage(page, {
        type: "workspaceLoaded",
        payload: {
            solutionPath: "TestProj.slnx",
            workspaceSettings: {
                useAllProjects: false,
                solutionPath: "TestProj.slnx",
                availableSolutions: ["TestProj.slnx"]
            },
            projects: [
                {
                    id: "madonna-api",
                    name: "TestProj.Api",
                    path: "c:/repo/src/TestProj.Api/TestProj.Api.csproj",
                    relativePath: "src/TestProj.Api/TestProj.Api.csproj",
                    packages: [
                        {
                            id: "Microsoft.EntityFrameworkCore.Design",
                            version: "10.0.8",
                            projectId: "madonna-api",
                            projectName: "TestProj.Api",
                            projectPath: "c:/repo/src/TestProj.Api/TestProj.Api.csproj",
                            relativeProjectPath: "src/TestProj.Api/TestProj.Api.csproj"
                        },
                        {
                            id: "Microsoft.AspNetCore.OpenApi",
                            version: "10.0.8",
                            projectId: "madonna-api",
                            projectName: "TestProj.Api",
                            projectPath: "c:/repo/src/TestProj.Api/TestProj.Api.csproj",
                            relativeProjectPath: "src/TestProj.Api/TestProj.Api.csproj"
                        }
                    ]
                }
            ],
            installedPackages: [
                {
                    id: "Microsoft.EntityFrameworkCore.Design",
                    versions: ["10.0.8"],
                    projects: [
                        {
                            id: "Microsoft.EntityFrameworkCore.Design",
                            version: "10.0.8",
                            projectId: "madonna-api",
                            projectName: "TestProj.Api",
                            projectPath: "c:/repo/src/TestProj.Api/TestProj.Api.csproj",
                            relativeProjectPath: "src/TestProj.Api/TestProj.Api.csproj"
                        }
                    ],
                    availableInSelectedSource: true,
                    availableSourceNames: ["nuget.org"],
                    latestVersionBySource: { "nuget.org": "10.0.9" },
                    latestVersionInAllSources: "10.0.9",
                    hasUpdate: true,
                    hasUpdateInAllSources: true,
                    isConsolidated: true,
                    vulnerabilities: []
                },
                {
                    id: "Microsoft.AspNetCore.OpenApi",
                    versions: ["10.0.8"],
                    projects: [
                        {
                            id: "Microsoft.AspNetCore.OpenApi",
                            version: "10.0.8",
                            projectId: "madonna-api",
                            projectName: "TestProj.Api",
                            projectPath: "c:/repo/src/TestProj.Api/TestProj.Api.csproj",
                            relativeProjectPath: "src/TestProj.Api/TestProj.Api.csproj"
                        }
                    ],
                    availableInSelectedSource: true,
                    availableSourceNames: ["nuget.org"],
                    latestVersionBySource: { "nuget.org": "10.0.9" },
                    latestVersionInAllSources: "10.0.9",
                    hasUpdate: true,
                    hasUpdateInAllSources: true,
                    isConsolidated: true,
                    vulnerabilities: []
                }
            ],
            sources: [
                {
                    name: "nuget.org",
                    url: "https://api.nuget.org/v3/index.json",
                    enabled: true,
                    healthStatus: "ok",
                    healthMessage: "Source is available"
                }
            ],
            errors: [],
            options: {
                selectedSourceName: "nuget.org",
                includePrerelease: false
            },
            status: "success",
            message: "Workspace loaded."
        }
    });

    await page.getByRole("button", { name: "UPDATES" }).click();

    await expect(page.getByText("Microsoft.EntityFrameworkCore.Design")).toBeVisible();
    await expect(page.getByText("Microsoft.AspNetCore.OpenApi")).toBeVisible();
    await expect(page.getByText("No updates found.")).toHaveCount(0);
});
