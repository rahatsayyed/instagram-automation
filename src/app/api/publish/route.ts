import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

async function getGoogleSheetsClient() {
  const credentials = JSON.parse(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "{}"
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return sheets;
}

async function getNextPublishableRow(sheets: any, sheetName: string) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:K`, // Skip header row, columns A-K
  });

  const rows = response.data.values || [];

  // Find first row where:
  // - Creation ID exists (column J)
  // - Published At (IG) is empty (column I)
  // - Error is empty (column K)
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const creationId = row[9] || ""; // Column J (index 9)
    const publishedAt = row[8] || ""; // Column I (index 8)
    const error = row[10] || ""; // Column K (index 10)

    if (creationId && !publishedAt && !error) {
      return {
        rowIndex: i + 2, // +2 because we start from row 2 (skipped header)
        data: {
          timestamp: row[0] || "",
          youtubeUrl: row[1] || "",
          cloudinaryUrl: row[2] || "",
          title: row[3] || "",
          description: row[4] || "",
          thumbnail: row[5] || "",
          tags: row[6] || "",
          instagramCaption: row[7] || "",
          publishedAt: row[8] || "",
          creationId: row[9] || "",
          error: row[10] || "",
        },
      };
    }
  }

  return null;
}

async function updateSheetRow(
  sheets: any,
  sheetName: string,
  rowIndex: number,
  updates: { publishedAt?: string; error?: string }
) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  // Update Published At (IG) (column I)
  if (updates.publishedAt !== undefined) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!I${rowIndex}`,
      valueInputOption: "RAW",
      resource: { values: [[updates.publishedAt]] },
    });
  }

  // Append Error (column K) - append on new line if existing error
  if (updates.error !== undefined) {
    // First, get existing error value
    const existingResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!K${rowIndex}`,
    });

    const existingError = existingResponse.data.values?.[0]?.[0] || "";
    const newError = existingError
      ? `${existingError}\n${updates.error}`
      : updates.error;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!K${rowIndex}`,
      valueInputOption: "RAW",
      resource: { values: [[newError]] },
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get the access token from environment variables
    const ACCESSTOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
    const APP_ID = process.env.APP_ID;

    if (!ACCESSTOKEN || !APP_ID) {
      return NextResponse.json(
        { error: "Instagram access token or APP_ID is not configured" },
        { status: 500 }
      );
    }

    // Get sheet name from request body or use default
    const body = await request.json();
    const sheetName = body.sheetName || "motivational"; // Default category

    // Get Google Sheets client
    const sheets = await getGoogleSheetsClient();

    // Get next publishable row
    const nextRow = await getNextPublishableRow(sheets, sheetName);

    if (!nextRow) {
      return NextResponse.json(
        {
          error: `No publishable rows found in sheet '${sheetName}'`,
          message:
            "Rows must have Creation ID, and empty Published At (IG) and Error values",
        },
        { status: 404 }
      );
    }

    const { rowIndex, data } = nextRow;

    // Build the Facebook API URL
    const apiUrl = `https://graph.facebook.com/v22.0/${APP_ID}/media_publish`;

    // Build query parameters
    const params = new URLSearchParams({
      creation_id: data.creationId,
    });

    // Make the request to Facebook API
    const response = await fetch(`${apiUrl}?${params.toString()}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESSTOKEN}`,
        "Content-Type": "application/json",
      },
    });

    const responseData = await response.json();

    // Handle Facebook API error
    if (!response.ok) {
      const errorMsg = `[${new Date().toISOString()}] PUBLISH: ${
        responseData.error?.message || "Facebook API error"
      } (Code: ${responseData.error?.code || "unknown"})`;
      await updateSheetRow(sheets, sheetName, rowIndex, { error: errorMsg });
      return NextResponse.json(
        {
          error: "Facebook API error",
          details: responseData,
          row: rowIndex,
          sheetName,
          sheetUpdated: true,
        },
        { status: response.status }
      );
    }

    // Update sheet with published timestamp (ISO format)
    const publishedAt = new Date().toISOString();
    await updateSheetRow(sheets, sheetName, rowIndex, { publishedAt });

    return NextResponse.json({
      success: true,
      publishedAt,
      mediaId: responseData.id,
      row: rowIndex,
      sheetName,
      title: data.title,
      youtubeUrl: data.youtubeUrl,
      cloudinaryUrl: data.cloudinaryUrl,
      instagramCaption: data.instagramCaption,
      message: "Publish successful, timestamp saved to sheet",
    });
  } catch (error) {
    console.error("Error calling Facebook API:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}