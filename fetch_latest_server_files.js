// fetch_latest_server_files.js
// Purpose: Find the latest server pack for the CurseForge modpack,
// then update launch.sh values: SERVER_VERSION + SERVER_FILE_ID.
//
// Required env:
// - CURSEFORGE_API_KEY

import fs from "node:fs";

const PROJECT_ID = 1356598; // All the Mons (your modpack project id)
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

async function main() {
  const apiKey = mustGetEnv("CURSEFORGE_API_KEY");

  // 1) Get recent modpack files
  const list = await cfFetch(`/mods/${PROJECT_ID}/files?pageSize=50`, apiKey);
  const files = list?.data ?? [];
  if (!files.length) throw new Error("No files returned for this project.");

  // Prefer newest by fileDate, then highest id
  files.sort((a, b) => {
    const ad = Date.parse(a.fileDate || "") || 0;
    const bd = Date.parse(b.fileDate || "") || 0;
    if (bd !== ad) return bd - ad;
    return (b.id || 0) - (a.id || 0);
  });

  // 2) Find the newest file that has a server pack pointer
  // CurseForge commonly uses serverPackFileId on modpack file entries
  const candidate = files.find((f) => f?.serverPackFileId || f?.isServerPack);
  if (!candidate) {
    // If none have serverPackFileId, we can still try direct ServerFiles-*.zip naming
    const direct = files.find(
      (f) =>
        typeof f?.fileName === "string" &&
        f.fileName.toLowerCase().startsWith("serverfiles-") &&
        f.fileName.toLowerCase().endsWith(".zip")
    );
    if (!direct) {
      throw new Error(
        "No ServerFiles-*.zip and no serverPackFileId found for this project."
      );
    }
    // Direct server pack file found
    const latest = {
      id: direct.id,
      fileName: direct.fileName,
      serverVersion: parseServerVersionFromFileName(direct.fileName),
    };
    if (!latest.serverVersion) {
      throw new Error(`Could not parse SERVER_VERSION from ${latest.fileName}`);
    }
    return updateLaunch(latest);
  }

  // 3) Resolve server pack file id
  const serverFileId = candidate.serverPackFileId || candidate.id;

  // If candidate is the server pack itself (isServerPack true), use it directly
  let serverFile = candidate;
  if (candidate.serverPackFileId) {
    const one = await cfFetch(`/mods/${PROJECT_ID}/files/${serverFileId}`, apiKey);
    serverFile = one?.data;
  }

  if (!serverFile?.id || !serverFile?.fileName) {
    throw new Error("Could not resolve server pack file details from CurseForge.");
  }

  const latest = {
    id: serverFile.id,
    fileName: serverFile.fileName,
    serverVersion: parseServerVersionFromFileName(serverFile.fileName),
  };

  if (!latest.serverVersion) {
    throw new Error(`Could not parse SERVER_VERSION from ${latest.fileName}`);
  }

  await updateLaunch(latest);
}

async function updateLaunch(latest) {
  console.log("Latest server pack:", latest);

  const launchPath = "launch.sh";
  const launch = fs.readFileSync(launchPath, "utf8");

  const updated = [
    [/^SERVER_VERSION=.*$/m, `SERVER_VERSION="${latest.serverVersion}"`],
    [/^SERVER_FILE_ID=.*$/m, `SERVER_FILE_ID=${latest.id}`],
  ].reduce((acc, [pat, rep]) => replaceOrThrow(acc, pat, rep), launch);

  if (updated === launch) {
    console.log("No changes needed.");
    return;
  }

  fs.writeFileSync(launchPath, updated, "utf8");
  console.log(`Updated ${launchPath} -> SERVER_VERSION=${latest.serverVersion}, SERVER_FILE_ID=${latest.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});