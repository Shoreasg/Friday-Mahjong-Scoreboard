/**
 * End-to-end check for the local Docker Compose stack. Run it from inside
 * the web container, where it can reach both services exactly the way a
 * browser would:
 *
 *   docker compose exec web pnpm --filter @workspace/scripts run smoke
 *
 * See docs/local-development.md#verifying-your-setup.
 */
import { execFileSync } from "node:child_process";

const webPort = process.env["PORT"] ?? "5173";
const apiPort = process.env["API_PORT"] ?? "5000";
const webBase = `http://localhost:${webPort}`;
const apiBase = `http://api:${apiPort}`;

let failed = false;

function pass(message: string): void {
  console.log(`✓ ${message}`);
}

function fail(message: string): void {
  failed = true;
  console.error(`✗ ${message}`);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function checkApiHealth(): Promise<void> {
  const res = await fetch(`${apiBase}/api/healthz`);
  const body = res.ok ? await readJson(res) : null;
  const status =
    body && typeof body === "object" ? (body as Record<string, unknown>)["status"] : undefined;
  if (res.ok && status === "ok") {
    pass("API health endpoint is up");
  } else {
    fail(`API health check failed (HTTP ${res.status})`);
  }
}

async function checkWebRoot(): Promise<void> {
  const res = await fetch(`${webBase}/`);
  const text = res.ok ? await res.text() : "";
  if (res.ok && text.toLowerCase().includes("<!doctype html")) {
    pass("Web app is serving the SPA document");
  } else {
    fail(`Web root did not look like the SPA document (HTTP ${res.status})`);
  }
}

async function fetchSessionsDirect(): Promise<unknown[]> {
  const res = await fetch(`${apiBase}/api/sessions`);
  const body = res.ok ? await readJson(res) : null;
  if (res.ok && Array.isArray(body) && body.length > 0) {
    pass(`Sessions endpoint returned ${body.length} row(s) directly from the API`);
    return body;
  }
  fail(`Sessions endpoint returned no rows directly from the API (HTTP ${res.status}) — did the seed run?`);
  return [];
}

async function checkProxy(direct: unknown[]): Promise<void> {
  const res = await fetch(`${webBase}/api/sessions`, {
    headers: { Origin: webBase },
  });
  const proxied = res.ok ? await readJson(res) : null;
  if (res.ok && JSON.stringify(proxied) === JSON.stringify(direct)) {
    pass("Sessions fetched through the web app's proxy match the API directly — proxy and trusted-origin check both work");
  } else {
    fail(`Proxied sessions request did not match the direct response (HTTP ${res.status})`);
  }
}

async function checkSeedIsIdempotent(beforeCount: number): Promise<void> {
  try {
    execFileSync("pnpm", ["--filter", "@workspace/db", "run", "seed"], {
      stdio: "inherit",
    });
  } catch (error) {
    fail(`Could not re-run the seed: ${(error as Error).message}`);
    return;
  }

  const res = await fetch(`${apiBase}/api/sessions`);
  const after = res.ok ? await readJson(res) : null;
  if (res.ok && Array.isArray(after) && after.length === beforeCount) {
    pass(`Re-running the seed left the row count at ${beforeCount} — idempotent`);
  } else {
    const afterCount = Array.isArray(after) ? after.length : "unknown";
    fail(`Row count changed after re-running the seed: ${beforeCount} -> ${afterCount}`);
  }
}

async function main(): Promise<void> {
  await checkApiHealth();
  await checkWebRoot();
  const direct = await fetchSessionsDirect();
  await checkProxy(direct);

  console.log("\nRe-running the seed to confirm idempotency...");
  await checkSeedIsIdempotent(direct.length);

  if (failed) {
    console.error("\nSmoke check FAILED.");
    process.exitCode = 1;
    return;
  }
  console.log("\nAll smoke checks passed.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
