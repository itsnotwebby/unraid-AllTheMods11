// fetch_latest_server_files.js
// Purpose: Find the latest server pack for the CurseForge modpack,
// then update launch.sh values: SERVER_VERSION + SERVER_FILE_ID.
//
// Required env:
// - CURSEFORGE_API_KEY

import fs from "node:fs";

const PROJECT_ID = 1148445; // All the Mods 11 (your modpack project id)
const BASE = "https://api.curseforge.com/v1";

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function cfFetch(path, apiKey) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-api-key": apiKey, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CurseForge API error ${res.status}: ${body}`);
  }
  return res.json();
}

function parseServerVersionFromFileName(fileName) {
  // Try ServerFiles-0.10.0-beta.zip style
  let m = /^ServerFiles-(.+)\.zip$/i.exec(fileName);
  if (m) return m[1];

  // Fallback: try to extract something version-like (best-effort)
  // e.g. "...-0.10.0-beta..." anywhere
  m = /(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)*)/.exec(fileName);
  return m ? m[1] : null;
}

function replaceOrThrow(haystack, pattern, replacement) {
  if (!pattern.test(haystack)) {
    throw new Error(`Pattern not found in launch.sh: ${pattern}`);
  }
  return haystack.replace(pattern, replacement);
}

function sortNewestFirst(list) {
  return [...list].sort((a, b) => {
    const ad = Date.parse(a.fileDate || "") || 0;
    const bd = Date.parse(b.fileDate || "") || 0;
    if (bd !== ad) return bd - ad;
    return (b.id || 0) - (a.id || 0);
  });
}

// Parses "0.10.0-beta" -> { core: [0,10,0], pre: "beta" }
function parseVersionForCompare(v) {
  const [corePart, ...preParts] = String(v).split("-");
  const core = corePart.split(".").map((n) => {
    const num = parseInt(n, 10);
    return Number.isNaN(num) ? 0 : num;
  });
  const pre = preParts.join("-") || null;
  return { core, pre };
}

// Returns 1 if a > b, -1 if a < b, 0 if equal/unparseable-equal.
// A version WITHOUT a prerelease tag is considered newer than the same
// core version WITH one (e.g. 0.2.1 > 0.2.1-beta), matching semver rules.
function compareVersions(a, b) {
  const pa = parseVersionForCompare(a);
  const pb = parseVersionForCompare(b);

  const len = Math.max(pa.core.length, pb.core.length);
  for (let i = 0; i < len; i++) {
    const na = pa.core[i] || 0;
    const nb = pb.core[i] || 0;
    if (na !== nb) return na > nb ? 1 : -1;
  }

  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1; // a has no prerelease tag, b does -> a is newer
  if (pb.pre === null) return -1;
  return pa.pre > pb.pre ? 1 : -1; // best-effort string compare for differing tags
}

function getCurrentServerVersion(launchContents) {
  const m = /^SERVER_VERSION="?([^"\n]*)"?\s*$/m.exec(launchContents);
  return m ? m[1] : null;
}

async function main() {
  const apiKey = mustGetEnv("CURSEFORGE_API_KEY");

  // 1) Get recent modpack files
  const list = await cfFetch(`/mods/${PROJECT_ID}/files?pageSize=50`, apiKey);
  const files = list?.data ?? [];
  if (!files.length) throw new Error("No files returned for this project.");

  // Debug visibility: uncomment if you need to inspect what CurseForge actually returned
  // console.log(files.map((f) => ({
  //   id: f.id,
  //   fileName: f.fileName,
  //   fileDate: f.fileDate,
  //   serverPackFileId: f.serverPackFileId,
  //   isServerPack: f.isServerPack,
  // })));

  // 2) Primary strategy: trust the ServerFiles-*.zip naming convention directly.
  // This is more reliable than serverPackFileId/isServerPack, which CurseForge
  // doesn't always populate promptly (or sets on an unexpected file entry),
  // causing newer server packs to be silently skipped.
  const serverPacks = files.filter(
    (f) =>
      typeof f?.fileName === "string" &&
      f.fileName.toLowerCase().startsWith("serverfiles-") &&
      f.fileName.toLowerCase().endsWith(".zip")
  );

  let latest;

  if (serverPacks.length) {
    const sorted = sortNewestFirst(serverPacks);
    const top = sorted[0];
    latest = {
      id: top.id,
      fileName: top.fileName,
      serverVersion: parseServerVersionFromFileName(top.fileName),
    };
  } else {
    // 3) Fallback: use serverPackFileId / isServerPack metadata, sorted newest-first.
    const sorted = sortNewestFirst(files);
    const candidate = sorted.find((f) => f?.serverPackFileId || f?.isServerPack);
    if (!candidate) {
      throw new Error(
        "No ServerFiles-*.zip and no serverPackFileId found for this project."
      );
    }

    const serverFileId = candidate.serverPackFileId || candidate.id;

    // If candidate points at a separate server pack file, resolve it directly.
    let serverFile = candidate;
    if (candidate.serverPackFileId) {
      const one = await cfFetch(`/mods/${PROJECT_ID}/files/${serverFileId}`, apiKey);
      serverFile = one?.data;
    }

    if (!serverFile?.id || !serverFile?.fileName) {
      throw new Error("Could not resolve server pack file details from CurseForge.");
    }

    latest = {
      id: serverFile.id,
      fileName: serverFile.fileName,
      serverVersion: parseServerVersionFromFileName(serverFile.fileName),
    };
  }

  if (!latest.serverVersion) {
    throw new Error(`Could not parse SERVER_VERSION from ${latest.fileName}`);
  }

  await updateLaunch(latest);
}

async function updateLaunch(latest) {
  console.log("Latest server pack:", latest);

  const launchPath = "launch.sh";
  const launch = fs.readFileSync(launchPath, "utf8");

  const currentVersion = getCurrentServerVersion(launch);
  if (currentVersion) {
    const cmp = compareVersions(latest.serverVersion, currentVersion);
    if (cmp < 0) {
      throw new Error(
        `Refusing to downgrade: found "${latest.serverVersion}" but launch.sh currently has "${currentVersion}".`
      );
    } else if (cmp === 0) {
      console.log(`Latest version "${latest.serverVersion}" matches current version. Continuing (file id or other fields may still differ).`);
    }
  } else {
    console.warn(`Could not parse current SERVER_VERSION from ${launchPath}; skipping downgrade check.`);
  }

  const updatedLaunch = [
    [/^SERVER_VERSION=.*$/m, `SERVER_VERSION="${latest.serverVersion}"`],
    [/^SERVER_FILE_ID=.*$/m, `SERVER_FILE_ID=${latest.id}`],
  ].reduce((acc, [pat, rep]) => replaceOrThrow(acc, pat, rep), launch);

  const dockerfilePath = "Dockerfile";
  const dockerfile = fs.readFileSync(dockerfilePath, "utf8");

  const updatedDockerfile = replaceOrThrow(
    dockerfile,
    /^LABEL version=.*$/m,
    `LABEL version="${latest.serverVersion}"`
  );

  if (updatedLaunch === launch && updatedDockerfile === dockerfile) {
    console.log("No changes needed.");
    return;
  }

  fs.writeFileSync(launchPath, updatedLaunch, "utf8");
  fs.writeFileSync(dockerfilePath, updatedDockerfile, "utf8");
  console.log(`Updated ${launchPath} -> SERVER_VERSION=${latest.serverVersion}, SERVER_FILE_ID=${latest.id}`);
  console.log(`Updated ${dockerfilePath} -> version=${latest.serverVersion}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
