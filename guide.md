# Google Sheets Integration Setup Guide

## 1. Create a Google Cloud Project & Service Account

### Step 1: Create Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Name it (e.g., "Instagram Automation")
4. Click "Create"

### Step 2: Enable Google Sheets API
1. In your project, go to "APIs & Services" → "Library"
2. Search for "Google Sheets API"
3. Click on it and click "Enable"

### Step 3: Create Service Account
1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "Service Account"
3. Fill in details:
   - **Service account name**: `instagram-sheets-bot` (or any name)
   - **Service account ID**: Auto-generated
4. Click "Create and Continue"
5. Skip role assignment (click "Continue")
6. Click "Done"

### Step 4: Generate Service Account Key
1. Click on the service account you just created
2. Go to "Keys" tab
3. Click "Add Key" → "Create new key"
4. Select **JSON** format
5. Click "Create" - this downloads a JSON file
6. **Save this file securely** - this is your `GOOGLE_SERVICE_ACCOUNT_KEY`

The JSON file looks like this:
```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "instagram-sheets-bot@your-project.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  ...
}
```

## 2. Setup Google Sheet

### Step 1: Create or Open Your Sheet
1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new sheet or open existing one
3. **Important**: Copy the Sheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
   ```

### Step 2: Setup Column Headers (Row 1)
Add these exact headers in the first row:
```
A: Name
B: Caption  
C: Link
D: Published At
E: Creation ID
F: Error
```

### Step 3: Share Sheet with Service Account
1. Click the "Share" button in your Google Sheet
2. Paste the **client_email** from your service account JSON file
   - It looks like: `instagram-sheets-bot@your-project.iam.gserviceaccount.com`
3. Give it **Editor** access
4. Uncheck "Notify people"
5. Click "Share"

## 3. Environment Variables Setup

Create/update your `.env.local` file:

```bash
# Instagram/Facebook API
INSTAGRAM_ACCESS_TOKEN=your_instagram_access_token
APPID=your_instagram_business_account_id

# Google Sheets Configuration
GOOGLE_SHEET_ID=your_sheet_id_from_url
GOOGLE_SHEET_NAME=Sheet1

# Service Account Key (entire JSON as string)
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"...","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...@....iam.gserviceaccount.com",...}
```

### Notes:
- **GOOGLE_SHEET_ID**: The long ID from your sheet URL
- **GOOGLE_SHEET_NAME**: The tab name (usually "Sheet1")
- **GOOGLE_SERVICE_ACCOUNT_KEY**: The entire JSON file content as a single-line string

## 4. Install Required Package

```bash
npm install googleapis
```

## 5. Sheet Data Flow

### Upload API (`/api/instagram/upload`)
- Finds first row where **Published At** AND **Error** are empty
- Reads **Caption** and **Link** from that row
- Calls Instagram API to create media container
- Updates **Creation ID** column (E) with response
- If error occurs, updates **Error** column (F) with "UPLOAD: error message"

### Publish API (`/api/instagram/publish`)
- Finds first row where **Creation ID** exists AND **Published At** is empty AND **Error** is empty
- Reads **Creation ID** from that row
- Calls Instagram API to publish the reel
- Updates **Published At** column (D) with timestamp
- If error occurs, updates **Error** column (F) with "PUBLISH: error message"

## 6. Example Sheet Data

| Name | Caption | Link | Published At | Creation ID | Error |
|------|---------|------|--------------|-------------|-------|
| Video 1 | Check this out! | https://example.com/video1.mp4 | 2025-10-23T10:30:00Z | 123456789 | |
| Video 2 | Amazing content | https://example.com/video2.mp4 | | 987654321 | |
| Video 3 | New reel | https://example.com/video3.mp4 | | | |
| Video 4 | Failed upload | https://example.com/video4.mp4 | | | UPLOAD: Invalid video format |
| Video 5 | Next to process | https://example.com/video5.mp4 | | | |

**In this example:**
- Row 2 (Video 1): Fully published ✅
- Row 3 (Video 2): Ready to publish (has Creation ID)
- Row 4 (Video 3): Will be selected by upload API
- Row 5 (Video 4): Skipped due to error
- Row 6 (Video 5): Next in queue after Video 3

## 7. API Usage

### Upload
```bash
curl -X POST http://localhost:3000/api/instagram/upload \
  -H "Content-Type: application/json"
```

### Publish
```bash
curl -X POST http://localhost:3000/api/instagram/publish \
  -H "Content-Type: application/json"
```

Both APIs automatically read from and update the Google Sheet!