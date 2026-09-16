// Refreshing AWS credential provider for long-running Bedrock jobs.
//
// Problem: the AWS SDK caches the credentials it resolves at process start. A
// background job (e.g. `ada credentials update` on a loop) rewrites
// ~/.aws/credentials, but the running Node process never re-reads it, so a long
// run dies when the original temporary token expires.
//
// Fix: return a credential *provider* that re-reads the file, stamped with a
// short `expiration`. The SDK's credential memoization re-invokes the provider
// once the value nears expiry, so the process transparently picks up whatever
// the refresher last wrote to disk. No secrets in code.
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CRED_PATH =
  process.env.AWS_SHARED_CREDENTIALS_FILE || join(homedir(), ".aws", "credentials");
const PROFILE = process.env.AWS_PROFILE || "default";
const TTL_MS = Number(process.env.AWS_CREDS_TTL_MS || 10 * 60 * 1000); // re-read cadence

function parseProfile(text, profile) {
  const out = {};
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      cur = line.slice(1, -1).trim();
      continue;
    }
    if (cur !== profile) continue;
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

export function refreshingIniCredentials() {
  return async () => {
    const creds = parseProfile(readFileSync(CRED_PATH, "utf-8"), PROFILE);
    if (!creds.aws_access_key_id) {
      throw new Error(`No credentials for profile [${PROFILE}] in ${CRED_PATH}`);
    }
    return {
      accessKeyId: creds.aws_access_key_id,
      secretAccessKey: creds.aws_secret_access_key,
      sessionToken: creds.aws_session_token,
      // Force the SDK to re-invoke this provider (re-read the file) periodically.
      expiration: new Date(Date.now() + TTL_MS),
    };
  };
}
