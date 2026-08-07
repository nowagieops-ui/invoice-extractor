# Invoice Extractor – Hostinger Deployment Guide

## What this app does
1. You upload a PDF invoice (or connect your Outlook inbox)
2. AI reads and extracts: supplier, invoice number, dates, amounts, VAT, PO number, etc.
3. Data is saved to a downloadable Excel spreadsheet (invoices.xlsx)

---

## Hostinger Setup (VPS or Business Hosting)

### Option A – Hostinger VPS (recommended)

1. **SSH into your VPS**
   ```
   ssh root@your-server-ip
   ```

2. **Upload the project**
   ```
   scp -r invoice-extractor/ root@your-server-ip:/var/www/
   ```

3. **Install Python & dependencies**
   ```bash
   apt update && apt install python3 python3-pip -y
   cd /var/www/invoice-extractor
   pip3 install -r requirements.txt
   ```

4. **Set your environment variables**
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-your-key-here"
   export SECRET_KEY="some-random-string-for-sessions"
   ```
   Or add to `/etc/environment` to persist across reboots.

5. **Run with Gunicorn**
   ```bash
   gunicorn -w 2 -b 0.0.0.0:5000 app:app --daemon
   ```

6. **Point your domain** – In Hostinger hPanel, point your domain to your VPS IP.
   Optionally set up Nginx as a reverse proxy on port 80/443.

---

### Option B – Hostinger Shared Hosting (Python via Passenger)

1. Upload the project files via hPanel File Manager or FTP
2. In hPanel → Hosting → Python, set:
   - Python version: 3.10+
   - Application root: `/home/user/invoice-extractor`
   - Application URL: your domain
   - Startup file: `app.py`
3. Set environment variables in hPanel → Advanced → PHP Config (or .env file)
4. Install packages via SSH: `pip3 install --user -r requirements.txt`

---

## Environment Variables

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | Your key from aistudio.google.com/apikey |
| `SECRET_KEY` | Any random string (for session security) |

---

## Getting your Gemini API Key (free)
1. Go to https://aistudio.google.com/apikey
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy and set as `GEMINI_API_KEY`

---

## Outlook / Microsoft 365 Notes

- Use IMAP with `outlook.office365.com` on port 993
- If your account has MFA enabled, you must use an **App Password**:
  1. Go to https://account.microsoft.com/security
  2. Advanced Security → App Passwords → Create
  3. Use that password in the app (not your normal password)
- The app marks emails as "read" after processing them so they won't be duplicated

---

## File locations

| Path | Purpose |
|---|---|
| `uploads/` | Temporary PDF storage |
| `output/invoices.xlsx` | The growing Excel file |

---

## Excel columns captured

1. Date Processed
2. Invoice Number
3. Invoice Date
4. Supplier Name
5. Supplier Email
6. Description
7. Net Amount
8. VAT/Tax
9. Total Amount
10. Currency
11. PO Number
12. Due Date
13. Source File
14. Email Subject
