// 00bx Kiro Gateway - Authentication Manager

import { join } from "node:path";
import { homedir, platform } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { getKiroRefreshUrl, TOKEN_REFRESH_THRESHOLD } from "./config.js";
import { getMachineFingerprint } from "./utils.js";

interface DbTokenData {
  refresh_token?: string;
  profile_arn?: string;
  region?: string;
}

export class KiroAuthManager {
  private refreshToken: string | null = null;
  private profileArn: string | null = null;
  private region: string;
  private accessToken: string | null = null;
  private expiresAt: number | null = null; // unix timestamp ms
  private refreshUrl: string;
  private kiroDbPath: string | null = null;
  private _fingerprint: string;
  private refreshPromise: Promise<void> | null = null;

  constructor(region = "us-east-1") {
    this.region = region;
    this.refreshUrl = getKiroRefreshUrl(region);
    this._fingerprint = getMachineFingerprint();

    // Auto-detect kiro-cli SQLite DB
    this.kiroDbPath = this.findKiroDb();

    // Load credentials from DB
    if (this.kiroDbPath) {
      this.syncFromKiroDb();
    }
  }

  private findKiroDb(): string | null {
    const home = homedir();
    const candidates: string[] = [];

    const os = platform();
    if (os === "darwin") {
      candidates.push(
        join(home, "Library", "Application Support", "kiro-cli", "data.sqlite3"),
      );
    }
    // Linux
    candidates.push(join(home, ".config", "kiro-cli", "data.sqlite3"));
    // Windows
    if (os === "win32") {
      candidates.push(
        join(home, "AppData", "Roaming", "kiro-cli", "data.sqlite3"),
      );
    }

    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  private readTokenFromDb(): DbTokenData | null {
    if (!this.kiroDbPath) return null;

    // Try multiple SQLite strategies for cross-runtime compatibility
    // Strategy 1: bun:sqlite (works in Bun — which OpenCode uses)
    // Strategy 2: better-sqlite3 (works in Node.js)
    // Strategy 3: sqlite3 CLI (universal fallback)

    const keys = ["kirocli:social:token", "codewhisperer:odic:token"];

    // Strategy 1: bun:sqlite
    try {
      // Dynamic import of bun:sqlite — only works in Bun runtime
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Database: BunDatabase } = require("bun:sqlite");
      const db = new BunDatabase(this.kiroDbPath, { readonly: true });
      try {
        for (const key of keys) {
          const row = db.prepare("SELECT value FROM auth_kv WHERE key=?").get(key) as { value: string } | undefined;
          if (row) {
            const data = JSON.parse(row.value) as DbTokenData;
            if (data.refresh_token) return data;
          }
        }
      } finally {
        db.close();
      }
      return null;
    } catch {
      // Not running in Bun, try next strategy
    }

    // Strategy 2: better-sqlite3 (Node.js native addon)
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require("better-sqlite3");
      const db = new Database(this.kiroDbPath, { readonly: true, timeout: 5000 });
      try {
        for (const key of keys) {
          const row = db.prepare("SELECT value FROM auth_kv WHERE key=?").get(key) as { value: string } | undefined;
          if (row) {
            const data = JSON.parse(row.value) as DbTokenData;
            if (data.refresh_token) return data;
          }
        }
      } finally {
        db.close();
      }
      return null;
    } catch {
      // better-sqlite3 not available or failed, try CLI
    }

    // Strategy 3: sqlite3 CLI (universal fallback)
    try {
      for (const key of keys) {
        const result = execSync(
          `sqlite3 "${this.kiroDbPath}" "SELECT value FROM auth_kv WHERE key='${key}';"`,
          { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
        ).trim();
        if (result) {
          const data = JSON.parse(result) as DbTokenData;
          if (data.refresh_token) return data;
        }
      }
    } catch {
      // sqlite3 CLI not available either
    }

    return null;
  }

  private syncFromKiroDb(): boolean {
    const dbData = this.readTokenFromDb();
    if (!dbData?.refresh_token) return false;

    if (dbData.refresh_token === this.refreshToken) return false;

    // Account changed or first load
    this.refreshToken = dbData.refresh_token;
    this.accessToken = null;
    this.expiresAt = null;

    if (dbData.profile_arn) this.profileArn = dbData.profile_arn;
    if (dbData.region && dbData.region !== this.region) {
      this.region = dbData.region;
      this.refreshUrl = getKiroRefreshUrl(this.region);
    }

    return true;
  }

  private isTokenExpiringSoon(): boolean {
    if (!this.expiresAt) return true;
    return Date.now() + TOKEN_REFRESH_THRESHOLD * 1000 >= this.expiresAt;
  }

  private async refreshTokenRequest(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error("Kiro refresh token not found. Is Kiro CLI installed and logged in?");
    }

    const res = await fetch(this.refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `KiroGateway-${this._fingerprint.slice(0, 16)}`,
      },
      body: JSON.stringify({ refreshToken: this.refreshToken }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Token refresh failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      accessToken?: string;
      refreshToken?: string;
      expiresIn?: number;
      profileArn?: string;
    };

    if (!data.accessToken) {
      throw new Error("Token refresh response missing accessToken");
    }

    this.accessToken = data.accessToken;
    if (data.refreshToken) this.refreshToken = data.refreshToken;
    if (data.profileArn) this.profileArn = data.profileArn;

    const expiresIn = data.expiresIn ?? 3600;
    this.expiresAt = Date.now() + (expiresIn - 60) * 1000;
  }

  async getAccessToken(): Promise<string> {
    // Check if account changed in kiro-cli
    this.syncFromKiroDb();

    if (this.accessToken && !this.isTokenExpiringSoon()) {
      return this.accessToken;
    }

    // Serialize concurrent refresh calls
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshTokenRequest().finally(() => {
        this.refreshPromise = null;
      });
    }
    await this.refreshPromise;

    if (!this.accessToken) {
      throw new Error("Failed to obtain access token");
    }
    return this.accessToken;
  }

  async forceRefresh(): Promise<string> {
    this.syncFromKiroDb();
    this.accessToken = null;
    this.expiresAt = null;
    return this.getAccessToken();
  }

  getProfileArn(): string | null {
    return this.profileArn;
  }

  getRegion(): string {
    return this.region;
  }

  get fingerprint(): string {
    return this._fingerprint;
  }
}
