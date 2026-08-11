import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
} from "../src/constants";
import { fetchAvailableModels } from "../src/plugin/config/dynamic-models";

const accounts = JSON.parse(
  readFileSync(join(homedir(), ".config/opencode/antigravity-accounts.json"), "utf-8"),
) as { accounts: Array<{ email: string; refreshToken: string }> };

const account = accounts.accounts[0];
console.log(`account: ${account.email}`);

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: account.refreshToken,
    client_id: ANTIGRAVITY_CLIENT_ID,
    client_secret: ANTIGRAVITY_CLIENT_SECRET,
  }),
});
if (!tokenResponse.ok) {
  console.error(`token refresh failed: ${tokenResponse.status} ${await tokenResponse.text()}`);
  process.exit(1);
}
const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };
console.log("token refreshed OK");

const models = await fetchAvailableModels(accessToken);
console.log(`\n${models.length} models from API:`);
for (const m of models) {
  console.log(
    `  ${m.id.padEnd(40)} thinking=${String(m.supportsThinking).padEnd(5)} img=${String(m.supportsImages).padEnd(5)} ctx=${m.maxTokens ?? "-"} out=${m.maxOutputTokens ?? "-"}`,
  );
}
