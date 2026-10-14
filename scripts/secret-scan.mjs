/**
 * Finds secret material in built files (the desktop bundle). No shell, no grep: it walks the
 * folder in Node, so it behaves the same on Windows.
 *
 * What counts as a secret -- actual key material, not the words:
 *   - a full secret key `sb_secret_…` (the bare prefix is in supabase-js itself, as a string it
 *     compares against, and is not a key);
 *   - a JWT whose payload says `"role":"service_role"` (legacy service-role keys);
 *   - the literal value of any key passed in `known` (the service-role key from the env files).
 *
 *   node scripts/secret-scan.mjs <folder>     exit 1 and list the files if anything is found
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_KEY = /sb_secret_[A-Za-z0-9_-]{16,}/;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;

function isServiceRoleJwt(payload) {
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    return /"role"\s*:\s*"service_role"/.test(json);
  } catch {
    return false;
  }
}

/** Why `text` contains secret material, or null. */
export function findSecret(text, known = []) {
  if (SECRET_KEY.test(text)) return "secret key (sb_secret_…)";
  for (const m of text.matchAll(JWT)) {
    if (isServiceRoleJwt(m[1])) return "service-role JWT";
  }
  for (const k of known) {
    if (k && k.length >= 20 && text.includes(k)) return "the configured service-role key";
  }
  return null;
}

/** Every file under `dir` that contains secret material, with the reason. */
export function scanFolder(dir, known = []) {
  const hits = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const reason = findSecret(readFileSync(p, "latin1"), known);
        if (reason) hits.push({ file: p, reason });
      }
    }
  };
  walk(dir);
  return hits;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/secret-scan.mjs <folder>");
    process.exit(2);
  }
  const hits = scanFolder(dir, [process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? ""]);
  for (const h of hits) console.error(`${h.file}: ${h.reason}`);
  process.exit(hits.length ? 1 : 0);
}
