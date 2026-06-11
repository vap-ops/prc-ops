// Link validation for purchase-request attachments (spec 23 / spec 16
// §4 contract — mirrors the DB's pra_url_shape CHECK so the user gets
// Thai copy instead of a constraint violation). Pure module.

export type AttachmentLinkResult = { ok: true; value: string } | { ok: false; error: string };

const LINK_SCHEME_ERROR = "ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://";
const MAX_URL_LENGTH = 2048;

export function validateAttachmentLink(input: string): AttachmentLinkResult {
  const value = input.trim();
  if (value.length === 0 || !/^https?:\/\//i.test(value)) {
    return { ok: false, error: LINK_SCHEME_ERROR };
  }
  if (value.length > MAX_URL_LENGTH) {
    return { ok: false, error: LINK_SCHEME_ERROR };
  }
  return { ok: true, value };
}
