import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const packagePaths = [
  "packages/client/package.json",
  "packages/core/package.json",
  "packages/sdk/package.json",
  "packages/server/package.json",
  "packages/qme/package.json"
];

const packages = packagePaths.map((packagePath) => {
  const json = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  return { path: packagePath, json };
});

const versions = new Set(packages.map((pkg) => pkg.json.version));
assert.equal(versions.size, 1, `Publishable package versions differ: ${[...versions].join(", ")}`);

const version = packages[0].json.version;
const publishableNames = new Set(packages.map((pkg) => pkg.json.name));

for (const pkg of packages) {
  for (const [dependency, dependencyVersion] of Object.entries(pkg.json.dependencies ?? {})) {
    if (publishableNames.has(dependency)) {
      assert.equal(
        dependencyVersion,
        version,
        `${pkg.path} depends on ${dependency}@${dependencyVersion}, expected ${version}`
      );
    }
  }
}

console.log(`Release package versions are aligned at ${version}.`);
