# Google OAuth Setup

Calendar Bridge connects to Google Calendar using OAuth 2.0 with PKCE. This guide walks you through creating credentials in Google Cloud Console and connecting them to the plugin.

> **Read-only access only.** Calendar Bridge requests only the `calendar.readonly` scope. It cannot create, modify, or delete calendar events.

---

## Prerequisites

- A Google account with access to the calendars you want to sync.
- A Google Cloud project (free tier is sufficient).

---

## Step 1: Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/).
2. Click the project selector at the top, then **New Project**.
3. Enter a project name (e.g. `obsidian-calendar-bridge`) and click **Create**.

---

## Step 2: Enable the Google Calendar API

1. In your project, go to **APIs & Services → Library**.
2. Search for **Google Calendar API**.
3. Click it and press **Enable**.

---

## Step 3: Configure the OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Select **External** user type and click **Create**.
3. Fill in the required fields:
   - **App name**: anything (e.g. `Obsidian Calendar Bridge`)
   - **User support email**: your email
   - **Developer contact information**: your email
4. Click **Save and Continue**.
5. On the **Scopes** step, click **Add or Remove Scopes**.
6. Find and select **`https://www.googleapis.com/auth/calendar.readonly`**, then click **Update**.
7. Click **Save and Continue** through the remaining steps.
8. On the **Test users** step, add your Google account email as a test user, then click **Save and Continue**.

> **Note**: While your app is in "Testing" mode, only added test users can authorize it. This is fine for personal use.

---

## Step 4: Create OAuth Credentials

1. Go to **APIs & Services → Credentials**.
2. Click **+ Create Credentials → OAuth client ID**.
3. For **Application type**, select **Desktop app**.
4. Enter a name (e.g. `Obsidian Desktop Client`) and click **Create**.
5. In the confirmation dialog, click **Download JSON**.

This downloads a `credentials.json` file containing your `client_id` (and optionally `client_secret`).

---

## Step 5: Connect Credentials in the Plugin

1. Open **Settings → Calendar Bridge → Sources → Add source**.
2. Select **Google Calendar** as the source type.
3. Click **Load credentials file** and select the `credentials.json` you downloaded.
4. The plugin reads the `client_id` from the file. The filename is shown for reference.
5. Click **Authorize** to start the OAuth flow.

---

## Step 6: Authorize in Browser

After clicking **Authorize**:

1. A browser window opens showing the Google authorization page.
2. Sign in with the Google account whose calendars you want to access.
3. Review the permissions (read-only calendar access) and click **Allow**.
4. Google redirects to a localhost callback URL that the plugin intercepts.
5. The plugin stores the access and refresh tokens locally. They are never sent anywhere except Google's OAuth servers.

---

## Step 7: Select Calendars

After authorization, return to **Settings → Calendar Bridge → Sources**. Your Google account's calendars now appear in the **Selected calendars** list.

Check the calendars you want to include in sync. Only selected calendars contribute events.

---

## Token Refresh

Access tokens expire after 1 hour. Calendar Bridge automatically refreshes them using the stored refresh token. You should not need to re-authorize unless:

- You revoke access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
- The refresh token is deleted or corrupted (rare).

If re-authorization is needed, click **Authorize** again in the source settings.

---

## Revoking Access

To disconnect Calendar Bridge from Google:

1. Go to [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
2. Find your app and click **Remove access**.
3. In Calendar Bridge settings, delete the Google Calendar source.

---

## Privacy

Calendar Bridge:
- Requests only `calendar.readonly` scope.
- Stores tokens in Obsidian's local plugin data (`.obsidian/plugins/obsidian-calendar-bridge/data.json`).
- Never sends token data to any server other than Google's OAuth endpoints.
- Never logs `client_secret`, `access_token`, or `refresh_token`.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| "Access blocked: App is not verified" | Add your Google account as a test user in the OAuth consent screen (Step 3). |
| "redirect_uri_mismatch" | Make sure you selected **Desktop app** as the application type, not Web application. |
| Authorize button opens browser but nothing happens | Check firewall rules — the plugin opens a local port for the OAuth callback. |
| Authorization expired / tokens lost | Click **Authorize** again to re-authenticate. |

For more issues, see [Troubleshooting](troubleshooting.md).
