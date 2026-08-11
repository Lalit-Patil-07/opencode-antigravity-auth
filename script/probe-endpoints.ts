import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET, getAntigravityHeaders } from "../src/constants";

const accounts = JSON.parse(
  readFileSync(join(homedir(), ".config/opencode/antigravity-accounts.json"), "utf-8"),
) as { accounts: Array<{ email: string; refreshToken: string }> };

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: accounts.accounts[0].refreshToken,
    client_id: ANTIGRAVITY_CLIENT_ID,
    client_secret: ANTIGRAVITY_CLIENT_SECRET,
  }),
});
const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };

const targets = [
  ["prod", "https://cloudcode-pa.googleapis.com"],
  ["daily", "https://daily-cloudcode-pa.sandbox.googleapis.com"],
  ["clients5", "https://clients5.google.com/ai"],
];

for (const [label, base] of targets) {
  const res = await fetch(`${base}/v1internal:fetchAvailableModels`, {
    method: "POST",
    headers: {
      ...getAntigravityHeaders(),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const text = await res.text();
  writeFileSync(`/tmp/models-${label}.json`, text);
  const ids = Object.keys(JSON.parse(text).models ?? {});
  console.log(`${label} ${base} -> ${res.status}, ${ids.length} models:`);
  for (const id of ids) {
    const entry = JSON.parse(text).models[id];
    const interesting = {
      displayName: entry.displayName,
      supportsThinking: entry.supportsThinking,
      supportsImages: entry.supportsImages,
      maxTokens: entry.maxTokens,
      maxOutputTokens: entry.maxOutputTokens,
    };
    console.log(`  ${id.padEnd(45)} ${JSON.stringify(interesting)}`);
  }
}
