// ../../selva.config.ts
import { defineConfig } from "@selvajs/platform";
import * as local from "@selvajs/local-provider";
import * as supa from "@selvajs/supabase-provider";

// ../header-auth-provider/dist/HeaderAuthProvider.js
import * as path2 from "node:path";
import { ProviderError as ProviderError2 } from "@selvajs/platform";

// ../header-auth-provider/dist/users.js
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ProviderError } from "@selvajs/platform";
var empty = () => ({ users: [] });
var LAST_LOGIN_DEBOUNCE_MS = 6e4;
async function readFile2(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT")
      return empty();
    throw err;
  }
}
async function writeFile2(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, "	"), "utf-8");
  await fs.rename(tmp, filePath);
}
function createAllowlistStore(filePath) {
  const norm = (upn) => upn.trim().toLowerCase();
  return {
    async findByUpn(upn) {
      const { users } = await readFile2(filePath);
      const key = norm(upn);
      return users.find((u) => u.upn === key) ?? null;
    },
    async findById(id) {
      const { users } = await readFile2(filePath);
      return users.find((u) => u.id === id) ?? null;
    },
    async listUsers() {
      const { users } = await readFile2(filePath);
      return users;
    },
    async createUser(upn) {
      const file = await readFile2(filePath);
      const key = norm(upn);
      if (file.users.some((u) => u.upn === key)) {
        throw new ProviderError(`User with UPN "${upn}" already exists`, 409);
      }
      const entry = {
        id: randomUUID(),
        upn: key,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      file.users.push(entry);
      await writeFile2(filePath, file);
      return entry;
    },
    async materializeFromHeaders(id, fields) {
      const file = await readFile2(filePath);
      const user = file.users.find((u) => u.id === id);
      if (!user)
        return;
      let dirty = false;
      if (!user.email && fields.email) {
        user.email = fields.email;
        dirty = true;
      }
      if (!user.displayName && fields.displayName) {
        user.displayName = fields.displayName;
        dirty = true;
      }
      if (dirty)
        await writeFile2(filePath, file);
    },
    async setDisabled(id, disabled) {
      const file = await readFile2(filePath);
      const user = file.users.find((u) => u.id === id);
      if (!user)
        throw new ProviderError(`User "${id}" not found`, 404);
      user.disabled = disabled;
      await writeFile2(filePath, file);
    },
    async touchLastLogin(id) {
      const file = await readFile2(filePath);
      const user = file.users.find((u) => u.id === id);
      if (!user)
        return;
      const now = Date.now();
      if (user.lastLoginAt) {
        const prev = Date.parse(user.lastLoginAt);
        if (Number.isFinite(prev) && now - prev < LAST_LOGIN_DEBOUNCE_MS)
          return;
      }
      user.lastLoginAt = new Date(now).toISOString();
      await writeFile2(filePath, file);
    },
    async deleteUser(id) {
      const file = await readFile2(filePath);
      const before = file.users.length;
      file.users = file.users.filter((u) => u.id !== id);
      if (file.users.length === before)
        throw new ProviderError(`User "${id}" not found`, 404);
      await writeFile2(filePath, file);
    }
  };
}

// ../header-auth-provider/dist/HeaderAuthProvider.js
var DEFAULT_HEADERS = {
  upn: "SELVA-UserPrincipalName",
  email: "SELVA-Email",
  displayName: "SELVA-DisplayName"
};
function toAuthUser(u) {
  return {
    id: u.id,
    email: u.email,
    metadata: { upn: u.upn, displayName: u.displayName },
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    disabled: u.disabled
  };
}
var HeaderProxyAuth = class {
  users;
  headers;
  bootstrapPolicy;
  constructor(users, headers, bootstrapPolicy) {
    this.users = users;
    this.headers = headers;
    this.bootstrapPolicy = bootstrapPolicy;
  }
  setBootstrapPolicy(policy) {
    this.bootstrapPolicy = policy ?? void 0;
  }
  async identifyFromHeaders(headers) {
    const upn = headers.get(this.headers.upn);
    if (!upn || !upn.trim())
      return null;
    const email = headers.get(this.headers.email)?.trim() || void 0;
    const displayName = headers.get(this.headers.displayName)?.trim() || void 0;
    let entry = await this.users.findByUpn(upn);
    if (!entry && this.bootstrapPolicy) {
      const allowed = await this.bootstrapPolicy({ upn, email });
      if (allowed) {
        try {
          entry = await this.users.createUser(upn);
        } catch {
          entry = await this.users.findByUpn(upn);
        }
      }
    }
    if (!entry || entry.disabled)
      return null;
    if (!entry.email && email || !entry.displayName && displayName) {
      await this.users.materializeFromHeaders(entry.id, { email, displayName }).catch(() => {
      });
      if (email && !entry.email)
        entry.email = email;
      if (displayName && !entry.displayName)
        entry.displayName = displayName;
    }
    await this.users.touchLastLogin(entry.id).catch(() => {
    });
    return toAuthUser(entry);
  }
};
var HeaderAuthProvider = class _HeaderAuthProvider {
  users;
  headers;
  name = "Header (Forward Auth)";
  proxyAuth;
  constructor(config) {
    this.users = createAllowlistStore(config.allowlistFilePath);
    this.headers = { ...DEFAULT_HEADERS, ...config.headers };
    this.proxyAuth = new HeaderProxyAuth(this.users, this.headers, config.bootstrapAllowlistPolicy);
  }
  /**
   * Late-bind a bootstrap-allowlist policy. Useful when the policy needs
   * runtime state the platform layer owns (e.g. `hasInstanceAdmin`) and
   * therefore can't be wired up at provider construction time. Pass `null`
   * to clear.
   */
  setBootstrapAllowlistPolicy(policy) {
    this.proxyAuth.setBootstrapPolicy(policy);
  }
  static fromEnv(env) {
    const dir = env.HEADER_AUTH_DATA_DIR ?? env.DATA_PATH;
    if (!dir) {
      throw new Error("Missing required env var: HEADER_AUTH_DATA_DIR (or DATA_PATH as fallback). This directory holds header-allowlist.json \u2014 the pre-provisioned UPN list.");
    }
    return new _HeaderAuthProvider({
      allowlistFilePath: path2.join(dir, "header-allowlist.json"),
      headers: {
        upn: env.HEADER_AUTH_UPN_HEADER ?? DEFAULT_HEADERS.upn,
        email: env.HEADER_AUTH_EMAIL_HEADER ?? DEFAULT_HEADERS.email,
        displayName: env.HEADER_AUTH_DISPLAY_NAME_HEADER ?? DEFAULT_HEADERS.displayName
      }
    });
  }
  /**
   * No tokens are issued by this provider — identity rides on every request
   * via the trusted-proxy headers. Always returns null; the hook layer
   * falls through to `proxyAuth.identifyFromHeaders`.
   */
  async verifyToken(_token) {
    return null;
  }
  async getUser(id) {
    const u = await this.users.findById(id);
    return u ? toAuthUser(u) : null;
  }
  async listUsers(opts) {
    const all = await this.users.listUsers();
    const limit = Math.min(Math.max(1, opts?.limit ?? 25), 200);
    const offset = opts?.cursor ? parseInt(opts.cursor, 10) || 0 : 0;
    const slice = all.slice(offset, offset + limit).map(toAuthUser);
    const nextOffset = offset + slice.length;
    return {
      items: slice,
      nextCursor: nextOffset < all.length ? String(nextOffset) : void 0
    };
  }
  /**
   * Allowlist a UPN. Admin POST `/admin/api/users` with `{ email }`; the
   * email IS the UPN for M365 / Entra deployments where they match. For
   * other IdPs, document the UPN format in your README/onboarding.
   */
  async createUser(upn) {
    return toAuthUser(await this.users.createUser(upn));
  }
  async deleteUser(id) {
    const target = await this.users.findById(id);
    if (!target)
      return "not_found";
    try {
      await this.users.deleteUser(id);
      return "ok";
    } catch (err) {
      if (err instanceof ProviderError2 && err.statusCode === 404)
        return "not_found";
      throw err;
    }
  }
  async disableUser(id) {
    const target = await this.users.findById(id);
    if (!target)
      return "not_found";
    try {
      await this.users.setDisabled(id, true);
      return "ok";
    } catch (err) {
      if (err instanceof ProviderError2 && err.statusCode === 404)
        return "not_found";
      throw err;
    }
  }
  async touchLastLogin(id) {
    await this.users.touchLastLogin(id);
  }
};

// ../../selva.config.ts
function envBool(env, key) {
  const v = env[key]?.toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}
function pickAuth(env) {
  const choice = (env.SELVA_AUTH_PROVIDER ?? "local").toLowerCase();
  switch (choice) {
    case "local":
      return local.LocalAuthProvider.fromEnv(env);
    case "supabase":
      return supa.SupabaseAuthProvider.fromEnv(env);
    case "header":
      return HeaderAuthProvider.fromEnv(env);
    default:
      throw new Error(
        `Unknown SELVA_AUTH_PROVIDER="${choice}". Expected: local | supabase | header.`
      );
  }
}
function pickData(env) {
  const choice = (env.SELVA_DATA_PROVIDER ?? "local").toLowerCase();
  switch (choice) {
    case "local":
      return local.LocalDataProvider.fromEnv(env);
    case "supabase":
      return supa.SupabaseDataProvider.fromEnv(env);
    default:
      throw new Error(
        `Unknown SELVA_DATA_PROVIDER="${choice}". Expected: local | supabase.`
      );
  }
}
function pickStorage(env) {
  const choice = (env.SELVA_STORAGE_PROVIDER ?? "local").toLowerCase();
  switch (choice) {
    case "local":
      return local.LocalStorageProvider.fromEnv(env);
    case "supabase":
      return supa.SupabaseStorageProvider.fromEnv(env);
    default:
      throw new Error(
        `Unknown SELVA_STORAGE_PROVIDER="${choice}". Expected: local | supabase.`
      );
  }
}
function pickTenancy(env) {
  const choice = (env.SELVA_TENANCY ?? "single").toLowerCase();
  if (choice !== "single" && choice !== "multi") {
    throw new Error(`Unknown SELVA_TENANCY="${choice}". Expected: single | multi.`);
  }
  return choice;
}
var selva_config_default = defineConfig((env) => ({
  tenancy: pickTenancy(env),
  flags: {
    ALLOW_CROSS_ORG_PUBLIC: envBool(env, "SELVA_FLAG_ALLOW_CROSS_ORG_PUBLIC"),
    ALLOW_ORG_COMPUTE_OVERRIDE: envBool(env, "SELVA_FLAG_ALLOW_ORG_COMPUTE_OVERRIDE"),
    ALLOW_ORG_CREATION: envBool(env, "SELVA_FLAG_ALLOW_ORG_CREATION"),
    ENABLE_SHARING: envBool(env, "SELVA_FLAG_ENABLE_SHARING")
  },
  branding: {
    name: env.SELVA_BRAND_NAME,
    copyrightName: env.SELVA_BRAND_COPYRIGHT_NAME,
    tagline: env.SELVA_BRAND_TAGLINE,
    description: env.SELVA_BRAND_DESCRIPTION
  },
  auth: pickAuth(env),
  data: pickData(env),
  storage: pickStorage(env)
}));
export {
  selva_config_default as default
};
