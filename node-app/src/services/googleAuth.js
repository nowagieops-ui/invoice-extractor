const { google } = require("googleapis");
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = require("../config");
const tokenStore = require("./tokenStore");

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

class ReconnectRequiredError extends Error {
  constructor(accountEmail, cause) {
    super(`Google account access for ${accountEmail} needs to be reconnected.`);
    this.name = "ReconnectRequiredError";
    this.accountEmail = accountEmail;
    this.cause = cause;
  }
}

function assertConfigured() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error(
      "Google OAuth is not configured — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI."
    );
  }
}

function newOAuth2Client() {
  assertConfigured();
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

function getAuthUrl(state) {
  const client = newOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

// Exchanges an OAuth callback `code` for tokens, identifies the connected
// account via a userinfo call, and persists the refresh token. Returns the
// connected email address.
async function exchangeCode(code) {
  const client = newOAuth2Client();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. This usually means the account already granted " +
        "access before without prompt=consent taking effect - try disconnecting any prior grant " +
        "at myaccount.google.com/permissions and reconnecting."
    );
  }
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  if (!data.email) {
    throw new Error("Could not determine the connected account's email address.");
  }
  tokenStore.saveToken(data.email, tokens);
  tokenStore.setActiveAccount(data.email);
  return data.email;
}

function looksLikeInvalidGrant(err) {
  const msg = (err && (err.message || "")).toLowerCase();
  const responseData = err && err.response && err.response.data;
  return (
    msg.includes("invalid_grant") ||
    (responseData && responseData.error === "invalid_grant")
  );
}

// Returns a ready `gmail` API client for the given account, using its stored
// refresh token. Throws ReconnectRequiredError if the token is missing,
// undecryptable, or Google reports it as invalid/revoked.
async function clientForAccount(email) {
  const stored = tokenStore.loadToken(email);
  if (!stored || !stored.refresh_token) {
    throw new ReconnectRequiredError(email, new Error("No stored token"));
  }

  const client = newOAuth2Client();
  client.setCredentials({ refresh_token: stored.refresh_token });

  try {
    // Force a refresh now (rather than lazily on first Gmail call) so a
    // revoked/invalid grant surfaces as ReconnectRequiredError immediately,
    // not as a confusing raw error mid-scan.
    await client.getAccessToken();
  } catch (err) {
    if (looksLikeInvalidGrant(err)) {
      throw new ReconnectRequiredError(email, err);
    }
    throw err;
  }

  return { oauth2Client: client, gmail: google.gmail({ version: "v1", auth: client }) };
}

async function disconnect(email) {
  const stored = tokenStore.loadToken(email);
  if (stored && stored.refresh_token) {
    try {
      const client = newOAuth2Client();
      await client.revokeToken(stored.refresh_token);
    } catch (_) {
      // best-effort — still remove the local copy even if Google's revoke call fails
    }
  }
  tokenStore.deleteToken(email);
  if (tokenStore.getActiveAccount() === email) {
    tokenStore.clearActiveAccount();
  }
}

module.exports = {
  SCOPES,
  ReconnectRequiredError,
  getAuthUrl,
  exchangeCode,
  clientForAccount,
  disconnect,
};
