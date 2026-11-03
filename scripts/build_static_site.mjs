import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputArg = process.argv.indexOf("--out");
const dist = outputArg >= 0 ? path.resolve(process.argv[outputArg + 1]) : path.join(root, "dist");
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const readJsonl = file => fs.readFileSync(path.join(root, file), "utf8")
  .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));

if (fs.existsSync(dist)) throw new Error(`Output already exists; choose a new --out directory: ${dist}`);
fs.mkdirSync(path.join(dist, "data"), { recursive: true });
fs.mkdirSync(path.join(dist, "docs"), { recursive: true });

fs.copyFileSync(path.join(root, "frontend", "index.html"), path.join(dist, "index.html"));
fs.cpSync(path.join(root, "frontend"), path.join(dist, "frontend"), {
  recursive: true,
  filter: source => {
    const relative = path.relative(path.join(root, "frontend"), source);
    return !relative.startsWith("data") && relative !== "index.html";
  }
});
fs.copyFileSync(path.join(root, "docs", "FINAL_PROJECT_REPORT.md"), path.join(dist, "docs", "FINAL_PROJECT_REPORT.md"));

const chunks = {
  core: {
    chapters: readJson("data/processed/chapters.json"),
    people: readJson("data/extracted/characters.json"),
    places: readJson("data/extracted/places.json"),
    times: readJsonl("data/extracted/time_expressions.jsonl"),
    build: readJson("outputs/logs/build_manifest.json"),
    analysis: readJson("outputs/analysis/analysis_summary.json"),
    eventGeo: readJson("outputs/geojson/event_candidates_resolved.geojson"),
    bufferGeo: readJson("outputs/geojson/battlefield_buffers.geojson"),
    trackGeo: readJson("outputs/geojson/character_narrative_tracks.geojson")
  },
  events: {
    events: readJsonl("data/extracted/event_candidates.jsonl"),
    kdeGeo: readJson("outputs/geojson/war_candidate_kde.geojson")
  },
  mentions: {
    characterMentions: readJsonl("data/extracted/character_mentions.jsonl"),
    placeMentions: readJsonl("data/extracted/place_mentions.jsonl")
  },
  geocodes: {
    geocodes: readJsonl("data/extracted/geocoding_results.jsonl")
  },
  "basemap-admin": {
    adminProvince: readJson("frontend/data/basemap/china_admin_2024/province.geojson"),
    adminCity: readJson("frontend/data/basemap/china_admin_2024/city.geojson")
  },
  "basemap-county": {
    adminCounty: readJson("frontend/data/basemap/china_admin_2024/county.geojson")
  },
  "basemap-world": {
    countries: readJson("frontend/data/basemap/countries.geojson"),
    rivers: readJson("frontend/data/basemap/rivers.geojson"),
    lakes: readJson("frontend/data/basemap/lakes.geojson")
  }
};

for (const [name, payload] of Object.entries(chunks)) {
  const file = path.join(dist, "data", `${name}.json`);
  const body = JSON.stringify(payload);
  fs.writeFileSync(file, body, "utf8");
  console.log(`${name.padEnd(16)} ${(Buffer.byteLength(body) / 1048576).toFixed(2)} MB`);
}

const files = [];
(function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
})(dist);
const bytes = files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
console.log(`dist: ${files.length} files, ${(bytes / 1048576).toFixed(2)} MB`);
