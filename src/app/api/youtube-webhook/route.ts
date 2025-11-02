import { google } from "googleapis";
import { NextRequest, NextResponse } from "next/server";

const VPS_URL = process.env.VPS_URL!;
const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY!;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID!;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || "Sheet1";

// Parse service account key safely
const serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY);

// Setup Google Sheets client
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: serviceAccount.client_email,
    private_key: serviceAccount.private_key,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// Helper: Append a row to the Google Sheet
async function appendToSheet(row: (string | null)[]) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: SHEET_NAME,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}

// Helper: Extract video details from PubSub payload
function extractVideoData(xmlBody: string) {
  const videoIdMatch = xmlBody.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
  const titleMatch = xmlBody.match(/<title>([^<]+)<\/title>/);
  const descMatch = xmlBody.match(/<media:description>([^<]*)<\/media:description>/);
  const thumbMatch = xmlBody.match(/<media:thumbnail url='([^']+)'/);
  const pubMatch = xmlBody.match(/<published>([^<]+)<\/published>/);

  const videoId = videoIdMatch?.[1] || "";
  const title = titleMatch?.[1] || "";
  const description = descMatch?.[1] || "";
  const thumbnail = thumbMatch?.[1] || "";
  const publishedAt = pubMatch?.[1] || "";

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const shortUrl = `https://www.youtube.com/shorts/${videoId}`;

  return { videoId, title, description, thumbnail, publishedAt, url, shortUrl };
}

// Helper: Check if it's a Short (simple heuristic)
function isShort(videoId: string, title: string, description: string) {
  return (
    /shorts/i.test(title) ||
    /shorts/i.test(description) ||
    videoId.length === 11 // typical YouTube videoId
  );
}

// Handle YouTube Hub Verification (GET)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const challenge = searchParams.get("hub.challenge");
  const topic = searchParams.get("hub.topic");

  if (mode === "subscribe" && challenge) {
    console.log(`✅ Verified subscription for topic: ${topic}`);
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Invalid verification", { status: 400 });
}

// Handle Notifications (POST)
export async function POST(req: NextRequest) {
  try {
    const xmlBody = await req.text();
    const { videoId, title, description, thumbnail, publishedAt, url, shortUrl } =
      extractVideoData(xmlBody);

    if (!videoId) return NextResponse.json({ error: "No video ID" }, { status: 400 });

    // Check if it's a YouTube Short
    if (!isShort(videoId, title, description)) {
      console.log(`Skipping non-short video: ${title}`);
      return NextResponse.json({ skipped: true });
    }

    // Append initial data to Google Sheet
    const timestamp = new Date().toISOString();
    const row = [
      timestamp, // Timestamp
      shortUrl, // YouTube Video URL
      "", // Cloudinary URL (to be filled later)
      title,
      description,
      thumbnail,
      "", // Tags
      "", // Instagram Caption
      publishedAt,
      "", // Creation ID
      "", // Error
    ];
    await appendToSheet(row);

    // Trigger VPS processing
    await fetch(VPS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl: shortUrl, title, description }),
    });

    console.log(`✅ Short added & VPS triggered: ${shortUrl}`);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("❌ Webhook error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
