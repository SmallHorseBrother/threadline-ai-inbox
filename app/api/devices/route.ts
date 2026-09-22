import { env } from "cloudflare:workers";
import {
  BOARD_NAMESPACE,
  requireSiteViewer,
  siteViewerId,
} from "@/lib/server/site-auth";
import { refreshSourceAvailability } from "@/lib/server/task-store";

export const dynamic = "force-dynamic";

type DeviceRow = {
  id: string;
  device_name: string;
  account_alias: string;
  created_at: string;
  last_seen_at: string | null;
  last_sync_at: string | null;
  agent_version: string | null;
  record_count: number;
  revoked_at: string | null;
};

function runtimeValue(key: string): string | undefined {
  const value = (env as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function randomSecret(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicDevice(row: DeviceRow) {
  return {
    id: row.id,
    deviceName: row.device_name,
    accountAlias: row.account_alias,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    lastSyncAt: row.last_sync_at,
    agentVersion: row.agent_version,
    recordCount: row.record_count,
    revokedAt: row.revoked_at,
  };
}

async function listDevices() {
  const result = await env.DB.prepare(
    `SELECT id, device_name, account_alias, created_at, last_seen_at, last_sync_at,
            agent_version, record_count, revoked_at
     FROM device_sources
     WHERE user_id = ?
     ORDER BY revoked_at IS NOT NULL, COALESCE(last_seen_at, created_at) DESC`,
  )
    .bind(BOARD_NAMESPACE)
    .all<DeviceRow>();
  return result.results.map(publicDevice);
}

export async function GET(request: Request) {
  const unauthorized = requireSiteViewer(request);
  if (unauthorized) return unauthorized;
  return Response.json({ devices: await listDevices() });
}

export async function POST(request: Request) {
  const unauthorized = requireSiteViewer(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json()) as {
    action?: "create" | "revoke";
    id?: string;
    deviceName?: string;
    accountAlias?: string;
    reuseExisting?: boolean;
  };

  if (body.action === "revoke" && typeof body.id === "string") {
    const now = new Date().toISOString();
    const result = await env.DB.prepare(
      "UPDATE device_sources SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    )
      .bind(now, body.id, BOARD_NAMESPACE)
      .run();
    if (!result.meta.changes) {
      return Response.json({ error: "Device not found" }, { status: 404 });
    }
    await env.DB.prepare(
      "UPDATE task_source_presence SET is_present = 0 WHERE source_id = ?",
    )
      .bind(body.id)
      .run();
    await refreshSourceAvailability(BOARD_NAMESPACE);
    return Response.json({ devices: await listDevices() });
  }

  if (body.action === "create") {
    const deviceName = body.deviceName?.trim() || "";
    const accountAlias = body.accountAlias?.trim() || "";
    if (deviceName.length < 2 || deviceName.length > 48 || /[\u0000-\u001f]/.test(deviceName)) {
      return Response.json({ error: "设备名称需要 2–48 个可见字符" }, { status: 400 });
    }
    if (!['账号1', '账号2'].includes(accountAlias)) {
      return Response.json({ error: "请选择账号1或账号2" }, { status: 400 });
    }

    const siteUrl = runtimeValue("THREADLINE_SITE_URL") ?? new URL(request.url).origin;
    const sitesAuthorization = runtimeValue("THREADLINE_SITES_BYPASS_TOKEN") ?? "";

    const existing = body.reuseExisting === true
      ? await env.DB.prepare(
          `SELECT id, device_name, account_alias, created_at, last_seen_at, last_sync_at,
                  agent_version, record_count, revoked_at
           FROM device_sources
           WHERE user_id = ? AND device_name = ? AND account_alias = ? AND revoked_at IS NULL
           ORDER BY created_at DESC LIMIT 1`,
        )
          .bind(BOARD_NAMESPACE, deviceName, accountAlias)
          .first<DeviceRow>()
      : null;
    const id = existing?.id ?? crypto.randomUUID();
    const deviceToken = `tlv1_${randomSecret()}`;
    const tokenHash = await hashToken(deviceToken);
    const createdAt = new Date().toISOString();
    if (existing) {
      await env.DB.prepare(
        `UPDATE device_sources
         SET token_hash = ?, created_by = ?, created_at = ?
         WHERE id = ? AND user_id = ?`,
      )
        .bind(tokenHash, siteViewerId(request), createdAt, id, BOARD_NAMESPACE)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO device_sources (
          id, user_id, device_name, account_alias, token_hash, created_by, created_at, record_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      )
        .bind(
          id,
          BOARD_NAMESPACE,
          deviceName,
          accountAlias,
          tokenHash,
          siteViewerId(request),
          createdAt,
        )
        .run();
    }

    return Response.json({
      device: {
        id,
        deviceName,
        accountAlias,
        createdAt,
        lastSeenAt: existing?.last_seen_at ?? null,
        lastSyncAt: existing?.last_sync_at ?? null,
        agentVersion: existing?.agent_version ?? null,
        recordCount: existing?.record_count ?? 0,
        revokedAt: null,
      },
      pairing: {
        version: 1,
        site_url: siteUrl,
        upload_path: "/api/device-sync",
        agent_path: "/agent/codex_task_sync.py",
        sites_authorization: sitesAuthorization,
        device_token: deviceToken,
        device_id: id,
        device_name: deviceName,
        account_alias: accountAlias,
      },
      devices: await listDevices(),
    });
  }

  return Response.json({ error: "Unsupported action" }, { status: 400 });
}
