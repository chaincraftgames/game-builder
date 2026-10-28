import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Represents the versions of the various ChainCraft packages.
 */
export interface Versions {
  authoring: string;
  gamedef: string;
  compiler: string;
  runtime: string;
}

/**
 * The path to this package's own package.json file.
 */
const OWN_PACKAGE_JSON = fileURLToPath(new URL("../package.json", import.meta.url));

/**
 * Reads the version string from a package.json file.
 */
function readVersion(packageJsonPath: string): string {
  return (JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string }).version;
}

/**
 * Finds the version of a dependency by locating its package.json file.
 */
function findDependencyVersion(name: string): string {
  let dir = dirname(OWN_PACKAGE_JSON);
  for (;;) {
    const candidate = join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) return readVersion(candidate);
    const parent = dirname(dir);
    if (parent === dir) return "unknown";
    dir = parent;
  }
}

/**
 * Returns the versions of the various ChainCraft packages.
 */
export function getVersions(): Versions {
  return {
    authoring: readVersion(OWN_PACKAGE_JSON),
    gamedef: findDependencyVersion("@chaincraft/gamedef"),
    compiler: findDependencyVersion("@chaincraft/compiler"),
    runtime: findDependencyVersion("@chaincraft/runtime"),
  };
}
