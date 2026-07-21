/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : authService.ts
 * Created at  : 2026-07-05
 * Author      : jeefo
 * Purpose     : Accounts, login sessions and role/case access control.
 * Description : Passwords are scrypt-hashed (node crypto, no extra deps) and
 *               stored "salt:hash". Login mints an opaque bearer token kept in
 *               the sessions table; the GraphQL context resolves that token to
 *               the calling user on every request. Case access: ADMINs see all
 *               cases; DETECTIVEs see cases they own or were granted via
 *               case_members.
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import crypto from "crypto";
import type {Knex} from "knex";
import type {CaseFile, CaseMember, User, UserRole} from "../models/types";

// Sessions live for 30 days; long enough for a shift-based workflow without
// re-login every visit, short enough that a leaked token eventually dies.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthUser {
  id       : number;
  username : string;
  fullName : string | null;
  role     : UserRole;
  active   : boolean;
}

function toAuthUser(u: User): AuthUser {
  return {id: u.id, username: u.username, fullName: u.fullName,
    role: u.role, active: !!u.active};
}

export class AuthService {
  private readonly db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  // --- password hashing --------------------------------------------------
  static hashPassword(pw: string): string {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
    return `${salt}:${hash}`;
  }

  static verifyPassword(pw: string, stored: string): boolean {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const test = crypto.scryptSync(pw, salt, 64).toString("hex");
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(test, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // --- sessions ----------------------------------------------------------
  // Resolve a bearer token to its (still-active) user, or null.
  async userForToken(token: string | null): Promise<AuthUser | null> {
    if (!token) return null;
    const s = await this.db<{userId: number; expiresAt: string}>("sessions")
      .where({token}).first();
    if (!s) return null;
    if (new Date(s.expiresAt).getTime() < Date.now()) {
      await this.db("sessions").where({token}).delete();
      return null;
    }
    const u = await this.db<User>("users").where({id: s.userId}).first();
    if (!u || !u.active) return null;
    return toAuthUser(u);
  }

  // Verify credentials and mint a session token. Throws on bad login so the
  // resolver can surface a clear message. `deviceId` is the client's stored
  // device fingerprint; DETECTIVE accounts are locked to it (see below).
  async login(username: string, password: string, deviceId?: string | null):
    Promise<{token: string; user: AuthUser}> {
    const u = await this.db<User>("users")
      .where({username: username.trim()}).first();
    if (!u || !AuthService.verifyPassword(password, u.passwordHash)) {
      throw new Error("Нэвтрэх нэр эсвэл нууц үг буруу байна");
    }
    if (!u.active) throw new Error("Энэ бүртгэл идэвхгүй болсон байна");

    // Device lock — DETECTIVEs only. A stolen password from another machine is
    // useless because that machine's deviceId isn't the one bound to the
    // account. Admins are exempt so the boss can log in from any machine.
    if (u.role === "DETECTIVE") {
      await this.enforceDevice(u.id, deviceId ?? null);
    }

    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    await this.db("sessions").insert({
      token, userId: u.id,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    });
    return {token, user: toAuthUser(u)};
  }

  // First login with no bound device registers this one; afterwards the
  // presented deviceId must match the binding, else access is denied until the
  // boss resets it.
  private async enforceDevice(userId: number, deviceId: string | null):
    Promise<void> {
    if (!deviceId) {
      throw new Error("Төхөөрөмжийн танигдах ID алга байна — хуудсаа " +
        "сэргээгээд дахин оролдоно уу");
    }
    const now = new Date().toISOString();
    const devices = await this.db<{id: number; deviceId: string}>(
      "user_devices").where({userId});
    if (devices.length === 0) {
      await this.db("user_devices").insert({
        userId, deviceId, createdAt: now, lastSeenAt: now});
      return;
    }
    const match = devices.find((d) => d.deviceId === deviceId);
    if (!match) {
      throw new Error("Энэ бүртгэл өөр төхөөрөмжид холбогдсон байна. " +
        "Даргадаа хандаж төхөөрөмжийн холболтыг шинэчлүүлнэ үү.");
    }
    await this.db("user_devices").where({id: match.id})
      .update({lastSeenAt: now});
  }

  // Whether a detective currently has a device bound (drives the admin UI).
  async hasBoundDevice(userId: number): Promise<boolean> {
    const row = await this.db("user_devices").where({userId}).first();
    return !!row;
  }

  // Boss action: forget a user's device binding so they can re-register from a
  // new computer on next login. Live sessions are killed too.
  async resetDevices(userId: number): Promise<boolean> {
    await this.db("user_devices").where({userId}).delete();
    await this.db("sessions").where({userId}).delete();
    return true;
  }

  async logout(token: string | null): Promise<boolean> {
    if (!token) return false;
    await this.db("sessions").where({token}).delete();
    return true;
  }

  // --- user management (ADMIN) -------------------------------------------
  async listUsers(): Promise<AuthUser[]> {
    const rows = await this.db<User>("users").orderBy("id", "asc");
    return rows.map(toAuthUser);
  }

  async createUser(input: {
    username: string; password: string; fullName?: string; role?: UserRole;
  }): Promise<AuthUser> {
    const username = input.username.trim();
    if (!username) throw new Error("Нэвтрэх нэр хоосон байна");
    if (!input.password || input.password.length < 6) {
      throw new Error("Нууц үг дор хаяж 6 тэмдэгт байх ёстой");
    }
    const exists = await this.db<User>("users").where({username}).first();
    if (exists) throw new Error("Ийм нэвтрэх нэртэй хэрэглэгч бүртгэлтэй байна");
    const now = new Date().toISOString();
    const [id] = await this.db("users").insert({
      username,
      fullName: input.fullName?.trim() || null,
      passwordHash: AuthService.hashPassword(input.password),
      role: input.role === "ADMIN" ? "ADMIN" : "DETECTIVE",
      active: true,
      createdAt: now, updatedAt: now,
    });
    const u = await this.db<User>("users").where({id: Number(id)}).first();
    return toAuthUser(u!);
  }

  async setActive(userId: number, active: boolean): Promise<AuthUser> {
    await this.db("users").where({id: userId})
      .update({active, updatedAt: new Date().toISOString()});
    // Deactivating a user kills their live sessions so access stops at once.
    if (!active) await this.db("sessions").where({userId}).delete();
    const u = await this.db<User>("users").where({id: userId}).first();
    if (!u) throw new Error("Хэрэглэгч олдсонгүй");
    return toAuthUser(u);
  }

  async resetPassword(userId: number, password: string): Promise<boolean> {
    if (!password || password.length < 6) {
      throw new Error("Нууц үг дор хаяж 6 тэмдэгт байх ёстой");
    }
    await this.db("users").where({id: userId}).update({
      passwordHash: AuthService.hashPassword(password),
      updatedAt: new Date().toISOString(),
    });
    // Force re-login with the new password.
    await this.db("sessions").where({userId}).delete();
    return true;
  }

  // --- per-user active case ---------------------------------------------
  async setActiveCase(userId: number, caseFileId: number | null):
    Promise<void> {
    await this.db("users").where({id: userId})
      .update({activeCaseId: caseFileId, updatedAt: new Date().toISOString()});
  }

  async getActiveCaseId(userId: number): Promise<number | null> {
    const u = await this.db<User>("users").where({id: userId})
      .first("activeCaseId");
    return u?.activeCaseId ?? null;
  }

  // --- case access control ----------------------------------------------
  // The set of case ids a user may open. ADMIN → all; DETECTIVE → owned +
  // granted (case_members). Returns null for "no restriction" (admin).
  async accessibleCaseIds(user: AuthUser): Promise<Set<number> | null> {
    if (user.role === "ADMIN") return null;
    const owned = await this.db<CaseFile>("case_files")
      .where({ownerUserId: user.id}).select("id");
    const member = await this.db<CaseMember>("case_members")
      .where({userId: user.id}).select("caseFileId");
    return new Set<number>([
      ...owned.map((c) => c.id),
      ...member.map((m) => m.caseFileId),
    ]);
  }

  async canAccessCase(user: AuthUser, caseFileId: number): Promise<boolean> {
    const ids = await this.accessibleCaseIds(user);
    return ids === null || ids.has(caseFileId);
  }

  async grantAccess(caseFileId: number, userId: number): Promise<boolean> {
    const exists = await this.db<CaseMember>("case_members")
      .where({caseFileId, userId}).first();
    if (exists) return true;
    await this.db("case_members").insert({
      caseFileId, userId, createdAt: new Date().toISOString()});
    return true;
  }

  async revokeAccess(caseFileId: number, userId: number): Promise<boolean> {
    await this.db("case_members").where({caseFileId, userId}).delete();
    // If that case was the user's open case, close it for them.
    await this.db("users")
      .where({id: userId, activeCaseId: caseFileId})
      .update({activeCaseId: null});
    return true;
  }

  // The detectives explicitly granted access to a case (owner excluded — they
  // always have it). Used by the admin access-control panel.
  async caseMembers(caseFileId: number): Promise<AuthUser[]> {
    const rows = await this.db<User>("users")
      .join("case_members", "case_members.userId", "users.id")
      .where("case_members.caseFileId", caseFileId)
      .select("users.*");
    return rows.map(toAuthUser);
  }
}
