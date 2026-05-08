import type { TabKey } from "../Types";

export const ALL_SOURCES = "__all__";
export const BROWSE_PAGE_SIZE = 15;

export const APP_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "browse", label: "BROWSE" },
  { key: "installed", label: "INSTALLED" },
  { key: "updates", label: "UPDATES" },
  { key: "consolidated", label: "CONSOLIDATED" },
  { key: "vulnerabilities", label: "VULNERABILITIES" }
];
