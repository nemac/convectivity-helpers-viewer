#!/usr/bin/env node
// `npm run feedback:pull`: download every tester's feedback (and the picture
// of the screen saved with each item) into feedback/ in this repo, which is
// gitignored, so it can be read and worked through on this machine.
//
//   npm run feedback:pull                      the real bucket, into feedback/aws/
//   npm run feedback:pull -- --source local    what was sent to this computer, into feedback/local/
//   FEEDBACK_INBOX_BASE=<url> npm run feedback:pull
//
// Each source has its own folder, so a pull of test items sent to this
// computer never replaces the list from the real bucket. A pull made before
// that (items.json and the item files straight in feedback/) is moved into
// the folders on the next pull, each item by the `source` the server gave it
// in that items.json. A plain pull used to read this computer, so an item
// with no readable source goes to local/: the next aws pull fetches every
// real item into aws/ anyway, while a test item filed under aws/ would pass
// for a tester's. The old items.json goes to aws/ only when every item in it
// is from the bucket, else to local/, as items_before_folders.json, since the
// pull then writes that folder's own items.json. Nothing is deleted; a file
// already in its new folder is left where it was.
//
// It always asks the feedback server on this computer
// (feedback_api/local_server.py on 127.0.0.1:8788, which `npm run dev:local`
// starts): the feedback Lambda function on AWS only takes feedback and reads
// none back. source=aws reads the bucket there with your own AWS login;
// source=local reads feedback_api/local_data/. The default is aws, since the
// real testers' feedback is what gets pulled to work through.
//
// The inbox code is VITE_FEEDBACK_ADMIN_CODE, read from .env.development.local
// (or the environment). It is sent only in the x-feedback-admin header and is
// never printed. The server accepts it only from the localhost origin, so
// this sends the dev server's origin, as the browser on localhost:5190 would.
//
// Written for Node 16, which has no fetch: plain http and https.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const VIEWER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.join(VIEWER, "feedback");
const ORIGIN = "http://localhost:5190";
const INBOX = "http://127.0.0.1:8788";

// The env files Vite reads in dev, later ones winning, read with dotenv's own
// line rule (the same one ondemand_api/envval.py uses in the analysis repo):
// a quoted value is taken from inside its quotes even with a "# note" after
// it, and an unquoted value stops at "#". A wrong reading here would send a
// wrong code, which counts toward the lockout.
const LINE = /^\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?$/gm;
function envValue(name) {
  if (process.env[name]) return process.env[name];
  let val = "";
  for (const f of [".env", ".env.local", ".env.development", ".env.development.local"]) {
    let text;
    try { text = fs.readFileSync(path.join(VIEWER, f), "utf8"); } catch { continue; }
    text = text.replace(/\r\n?/g, "\n");
    for (const m of text.matchAll(LINE)) {
      if (m[1] !== name) continue;
      let v = (m[2] ?? "").trim();
      const q = v[0];
      v = v.replace(/^(['"`])([\s\S]*)\1$/, "$2");
      if (q === '"') v = v.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
      val = v;
    }
  }
  return val;
}

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, { headers: { ...headers, "Accept-Encoding": "gzip" }, timeout: 60_000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let body = Buffer.concat(chunks);
        try {
          if (res.headers["content-encoding"] === "gzip") body = zlib.gunzipSync(body);
        } catch (e) { reject(e); return; }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
  });
}

const WORDS = {
  401: "The inbox code was not accepted. Check VITE_FEEDBACK_ADMIN_CODE in .env.development.local.",
  403: "The feedback server refused this origin. The inbox code works only from localhost:5190.",
  404: "That server has no feedback inbox. Is feedback_api/local_server.py the one on that address?",
  429: "Too many wrong codes from here lately. Wait 10 minutes and try again.",
};

// --source aws|local, or --source=aws|local; aws when not given.
function sourceArg(args) {
  let v = "aws";
  args.forEach((a, i) => {
    if (a === "--source") v = args[i + 1] ?? "";
    else if (a.startsWith("--source=")) v = a.slice("--source=".length);
  });
  if (v !== "aws" && v !== "local") {
    console.error("--source takes aws (the real bucket) or local (feedback sent to this computer).");
    process.exit(2);
  }
  return v;
}

// Item files are named by the server's ids.
const ITEM_FILE = /^([A-Za-z0-9_-]{1,80})\.(json|jpg)$/;

// The layout from before the per-source folders, moved into them (see the
// top of this file). Returns how many files went where.
function migrateOldLayout() {
  let names;
  try { names = fs.readdirSync(ROOT); } catch { return null; }
  const list = names.includes("items.json") ? path.join(ROOT, "items.json") : null;
  const loose = names.filter((n) => n !== "items.json" && ITEM_FILE.test(n)
    && fs.statSync(path.join(ROOT, n)).isFile());
  if (!list && !loose.length) return null;
  // each listed item's source, as local_server.py wrote it
  const from = new Map();
  let listAws = false;
  if (list) {
    try {
      const items = JSON.parse(fs.readFileSync(list, "utf8"));
      if (Array.isArray(items)) {
        for (const x of items) {
          if (x && typeof x.id === "string" && (x.source === "aws" || x.source === "local")) from.set(x.id, x.source);
        }
        listAws = items.length > 0 && items.every((x) => x && from.get(x.id) === "aws");
      }
    } catch { /* unreadable: its items are not told apart */ }
  }
  const moved = { aws: 0, local: 0, kept: 0 };
  const move = (name, to, as = name) => {
    const dir = path.join(ROOT, to);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, as);
    if (fs.existsSync(dest)) { moved.kept++; return; }
    fs.renameSync(path.join(ROOT, name), dest);
    moved[to]++;
  };
  if (list) move("items.json", listAws ? "aws" : "local", "items_before_folders.json");
  for (const n of loose) {
    const id = ITEM_FILE.exec(n)[1];
    move(n, from.get(id) === "aws" ? "aws" : "local");
  }
  return moved;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--aws")) {
    console.error("--aws is now --source aws, which is the default.");
    process.exit(2);
  }
  const source = sourceArg(args);
  const base = (process.env.FEEDBACK_INBOX_BASE || INBOX).replace(/\/+$/, "");
  const q = (path) => `${path}${path.includes("?") ? "&" : "?"}source=${source}`;
  const code = envValue("VITE_FEEDBACK_ADMIN_CODE");
  if (!code) {
    console.error("No inbox code: add VITE_FEEDBACK_ADMIN_CODE to .env.development.local.");
    process.exit(1);
  }
  const headers = { Origin: ORIGIN, "x-feedback-admin": code };

  // The list comes a page at a time; `next` names where the next page starts.
  const items = [];
  let after = null;
  for (let page = 0; page < 1000; page++) {
    let res;
    try {
      res = await get(`${base}${q(`/feedback${after ? `?after=${encodeURIComponent(after)}` : ""}`)}`, headers);
    } catch (e) {
      console.error(`Could not reach the feedback server at ${base}: ${e.message}. `
        + "Start it with npm run dev:local, or python3 feedback_api/local_server.py.");
      process.exit(1);
    }
    if (res.status !== 200) {
      let msg = "";
      try { msg = JSON.parse(res.body.toString("utf8")).error ?? ""; } catch { /* no sentence */ }
      // a 403 says itself what is wrong, and a 502 is the AWS login's own reason
      console.error(((res.status === 403 || res.status === 502) && msg) || WORDS[res.status] || msg
        || `The feedback server answered ${res.status}.`);
      process.exit(1);
    }
    let data;
    try { data = JSON.parse(res.body.toString("utf8")); } catch { data = null; }
    if (!data || !Array.isArray(data.items)) {
      console.error("The feedback list could not be read.");
      process.exit(1);
    }
    items.push(...data.items);
    after = typeof data.next === "string" && /^[0-9a-f]{32}$/.test(data.next) ? data.next : null;
    if (!after) break;
  }
  const moved = migrateOldLayout();
  if (moved && (moved.aws || moved.local)) {
    console.log(`Moved the earlier pull into folders: ${moved.aws} files into feedback/aws/, `
      + `${moved.local} into feedback/local/.`
      + (moved.kept ? ` ${moved.kept} were left in feedback/, as their folder already had them.` : ""));
  }
  const OUT = path.join(ROOT, source);

  // ids become file names, so only plain ones are written
  const safe = items.filter((x) => x && typeof x.id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(x.id));
  safe.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "items.json"), JSON.stringify(safe, null, 2) + "\n");
  let pictures = 0, missing = 0;
  for (const x of safe) {
    fs.writeFileSync(path.join(OUT, `${x.id}.json`), JSON.stringify(x, null, 2) + "\n");
    const jpg = path.join(OUT, `${x.id}.jpg`);
    if (fs.existsSync(jpg)) continue;
    try {
      const r = await get(`${base}${q(`/feedback/${x.id}.jpg`)}`, headers);
      if (r.status === 200 && r.body.length) { fs.writeFileSync(jpg, r.body); pictures++; }
      else missing++;
    } catch { missing++; }
  }
  const done = safe.filter((x) => x.status === "done").length;
  console.log(`Saved ${safe.length} items from ${source === "aws" ? "the feedback bucket" : "this computer"} `
    + `(${safe.length - done} open, ${done} done) to feedback/${source}/items.json, `
    + `with ${pictures} new screenshots${missing ? ` (${missing} items have none)` : ""}.`);
  if (safe.length !== items.length) console.log(`Skipped ${items.length - safe.length} items with unusual ids.`);
}

main();
