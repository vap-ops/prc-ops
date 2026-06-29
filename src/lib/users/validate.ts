// Spec 220 (G63) — narrow an untrusted role string to a real user_role before it
// reaches set_user_role. USER_ROLE_LABEL is the role SSOT (one entry per enum
// value); its keys are exactly the valid roles. The enum-typed RPC param is the
// authoritative guard — this is the friendly early reject + a typed narrowing.

import type { UserRole } from "@/lib/db/enums";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";

export function isUserRole(v: string): v is UserRole {
  return Object.prototype.hasOwnProperty.call(USER_ROLE_LABEL, v);
}
