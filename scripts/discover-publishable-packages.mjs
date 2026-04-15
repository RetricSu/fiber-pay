import fs from "node:fs";
import path from "node:path";

const outputJson = process.argv.includes("--json");
const workspaceRoot = process.cwd();
const packagesRoot = path.join(workspaceRoot, "packages");

if (!fs.existsSync(packagesRoot)) {
  console.error(`Expected packages directory does not exist: ${packagesRoot}`);
  process.exit(1);
}

if (!fs.statSync(packagesRoot).isDirectory()) {
  console.error(`Expected packages path to be a directory: ${packagesRoot}`);
  process.exit(1);
}

const discovered = fs
  .readdirSync(packagesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const pkgPath = path.join("packages", entry.name, "package.json");
    const fullPath = path.join(workspaceRoot, pkgPath);

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`Failed to parse package manifest ${pkgPath}: ${detail}`);
      process.exit(1);
    }

    if (typeof pkg.name !== "string") {
      return null;
    }

    if (!pkg.name.startsWith("@fiber-pay/")) {
      return null;
    }

    if (pkg.private === true) {
      return null;
    }

    return {
      name: pkg.name,
      version: pkg.version,
      path: pkgPath,
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.name.localeCompare(b.name));

if (discovered.length === 0) {
  console.error("No publishable @fiber-pay/* packages found under packages/*");
  process.exit(1);
}

if (outputJson) {
  process.stdout.write(`${JSON.stringify(discovered)}\n`);
  process.exit(0);
}

for (const pkg of discovered) {
  process.stdout.write(`${pkg.name}\n`);
}
