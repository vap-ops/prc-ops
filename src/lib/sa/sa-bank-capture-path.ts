// Spec 298 U2 — the walled capture object key for an SA-photographed passbook.
// Lives under `sa-bank-capture/` (the sa_add_project_worker_with_bank RPC gates on
// split_part(path,'/',1)='sa-bank-capture'); no worker id and no PII in the path
// (the worker doesn't exist at upload time — the RPC binds the key to the created
// worker's capture row). The extension is sanitized so a crafted filename can't
// escape the key. The uploaded object is unreadable back to the SA (deny-by-default
// SELECT on the folder); only the service-role admin client reads it (U3).

export function saBankCapturePath(ext: string): string {
  const year = new Date().getUTCFullYear();
  const safeExt = /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toLowerCase() : "jpg";
  return `sa-bank-capture/${year}/${crypto.randomUUID()}.${safeExt}`;
}
