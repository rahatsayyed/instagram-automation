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

async function getNextPublishableRow(sheets: any) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME || "Sheet1";

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:G`, // Skip header row
  });

  const rows = response.data.values || [];

  // Find first row where "Creation ID" exists, "Published At" is empty, and "Error" is empty
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const creationId = row[5] || ""; // Column F (index 5)
    const publishedAt = row[4] || ""; // Column E (index 4)
    const error = row[6] || ""; // Column G (index 6)

    if (creationId && !publishedAt && !error) {
      return {
        rowIndex: i + 2, // +2 because we start from row 2 (skipped header)
        data: {
          name: row[0] || "",
          caption: row[1] || "",
          link: row[2] || "",
          transcript: row[3] || "",
          publishedAt: row[4] || "",
          creationId: row[5] || "",
          error: row[6] || "",
        },
      };
    }
  }

  return null;
}

async function updateSheetRow(
  sheets: any,
  rowIndex: number,
  updates: { publishedAt?: string; error?: string }
) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME || "Sheet1";

  // Update Published At (column E)
  if (updates.publishedAt) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!E${rowIndex}`,
      valueInputOption: "RAW",
      resource: { values: [[updates.publishedAt]] },
    });
  }

  // Update Error (column G)
  if (updates.error) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!G${rowIndex}`,
      valueInputOption: "RAW",
      resource: { values: [[updates.error]] },
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

    // Get Google Sheets client
    const sheets = await getGoogleSheetsClient();

    // Get next publishable row
    const nextRow = await getNextPublishableRow(sheets);

    if (!nextRow) {
      return NextResponse.json(
        {
          error:
            "No publishable rows found (rows must have Creation ID and no Published At or Error values)",
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
      const errorMsg = `PUBLISH: ${responseData.error?.message || "Facebook API error"}`;
      await updateSheetRow(sheets, rowIndex, { error: errorMsg });
      return NextResponse.json(
        {
          error: "Facebook API error",
          details: responseData,
          row: rowIndex,
          sheetUpdated: true,
        },
        { status: response.status }
      );
    }

    // Update sheet with published timestamp
    const publishedAt = new Date().toISOString();
    await updateSheetRow(sheets, rowIndex, { publishedAt });

    return NextResponse.json({
      success: true,
      publishedAt,
      mediaId: responseData.id,
      row: rowIndex,
      name: data.name,
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