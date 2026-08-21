// Replaces IMAP search/fetch/MIME-walking entirely. Gmail's `q` search
// syntax (same as the web UI search box) already covers all mail by
// default, excluding only Spam/Trash - no "[Gmail]/All Mail" special-case
// needed the way the old IMAP version required.

function buildQuery({ senderFilter, dateFrom }) {
  const parts = [];
  if (senderFilter && senderFilter.trim()) {
    parts.push(`from:${senderFilter.trim()}`);
  }
  if (dateFrom && dateFrom.trim()) {
    // dateFrom arrives as YYYY-MM-DD (HTML date input); Gmail wants YYYY/MM/DD.
    parts.push(`after:${dateFrom.trim().replace(/-/g, "/")}`);
  }
  return parts.join(" ");
}

// Returns up to `limit` message ids matching the query. Gmail's list API
// caps maxResults at 500/page (per current docs) - pages via nextPageToken
// if more are needed. Ordering is assumed newest-first (Gmail's normal
// behavior) but this isn't a documented guarantee we're confident in -
// worth a real-mailbox check before relying on "first N = most recent N".
async function searchMessageIds(gmail, { senderFilter, dateFrom, limit }) {
  const q = buildQuery({ senderFilter, dateFrom });
  const ids = [];
  let pageToken;

  while (ids.length < limit) {
    const { data } = await gmail.users.messages.list({
      userId: "me",
      q: q || undefined,
      maxResults: Math.min(limit - ids.length, 500),
      pageToken,
    });
    for (const m of data.messages || []) ids.push(m.id);
    pageToken = data.nextPageToken;
    if (!pageToken || !data.messages || data.messages.length === 0) break;
  }

  return ids.slice(0, limit);
}

// Recursively walks a Gmail message payload's MIME tree for PDF parts.
function findPdfParts(payload, out = []) {
  if (!payload) return out;
  const filename = payload.filename || "";
  if (filename.toLowerCase().endsWith(".pdf") && payload.body && payload.body.attachmentId) {
    out.push({ filename, attachmentId: payload.body.attachmentId });
  }
  if (payload.parts) {
    for (const part of payload.parts) findPdfParts(part, out);
  }
  return out;
}

function headerValue(headers, name) {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

// One call regardless of attachment count. Returns { id, subject, from,
// pdfParts: [{filename, attachmentId}] }.
async function getMessage(gmail, id) {
  const { data } = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  return {
    id: data.id,
    subject: headerValue(data.payload.headers, "Subject"),
    from: headerValue(data.payload.headers, "From"),
    pdfParts: findPdfParts(data.payload),
  };
}

// One call per PDF part. Returns a Buffer of the decoded attachment bytes.
async function getAttachmentBytes(gmail, messageId, attachmentId) {
  const { data } = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });
  return Buffer.from(data.data, "base64url");
}

module.exports = { searchMessageIds, getMessage, getAttachmentBytes };
