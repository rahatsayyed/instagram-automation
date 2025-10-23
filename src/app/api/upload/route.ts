import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { generateCaption } from "@/libs/utils";

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

async function getNextUnprocessedRow(sheets: any) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME || "Sheet1";

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:F`, // Skip header row
  });

  const rows = response.data.values || [];

  // Find first row where both "Published At" (column D) and "Error" (column F) are empty
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const publishedAt = row[3] || ""; // Column D (index 3)
    const error = row[5] || ""; // Column F (index 5)

    if (!publishedAt && !error) {
      return {
        rowIndex: i + 2, // +2 because we start from row 2 (skipped header)
        data: {
          name: row[0] || "",
          caption: row[1] || "",
          link: row[2] || "",
          publishedAt: row[3] || "",
          creationId: row[4] || "",
          error: row[5] || "",
        },
      };
    }
  }

  return null;
}

async function updateSheetRow(
  sheets: any,
  rowIndex: number,
  updates: { caption?: string; creationId?: string; error?: string }
) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME || "Sheet1";

  // Update Caption (column B)
  if (updates.caption) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!B${rowIndex}`,
      valueInputOption: "RAW",
      resource: { values: [[updates.caption]] },
    });
  }

  // Update Creation ID (column E)
  if (updates.creationId) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!E${rowIndex}`,
      valueInputOption: "RAW",
      resource: { values: [[updates.creationId]] },
    });
  }

  // Update Error (column F)
  if (updates.error) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!F${rowIndex}`,
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

    // Get next unprocessed row
    const nextRow = await getNextUnprocessedRow(sheets);

    if (!nextRow) {
      return NextResponse.json(
        { error: "No unprocessed rows found in the sheet" },
        { status: 404 }
      );
    }

    const { rowIndex, data } = nextRow;

    // Validate required fields from sheet
    if (!data.link) {
      const errorMsg = "UPLOAD: Missing video link in sheet";
      await updateSheetRow(sheets, rowIndex, { error: errorMsg });
      return NextResponse.json(
        { error: errorMsg, row: rowIndex },
        { status: 400 }
      );
    }

    // Check if name/title exists
    if (!data.name) {
      const errorMsg = "UPLOAD: Missing name/title in sheet";
      await updateSheetRow(sheets, rowIndex, { error: errorMsg });
      return NextResponse.json(
        { error: errorMsg, row: rowIndex },
        { status: 400 }
      );
    }

    // Generate caption if not present
    let caption = data.caption;
    let captionGenerated = false;

    if (!caption) {
      try {
        caption = await generateCaption(data.name);
        captionGenerated = true;
        
        // Update the caption in the sheet
        await updateSheetRow(sheets, rowIndex, { caption });
      } catch (aiError) {
        const errorMsg = `UPLOAD: Failed to generate caption - ${
          aiError instanceof Error ? aiError.message : "Unknown AI error"
        }`;
        await updateSheetRow(sheets, rowIndex, { error: errorMsg });
        return NextResponse.json(
          {
            error: "Failed to generate caption",
            details: aiError instanceof Error ? aiError.message : "Unknown error",
            row: rowIndex,
          },
          { status: 500 }
        );
      }
    }

    // Build the Facebook API URL
    const apiUrl = `https://graph.facebook.com/v23.0/${APP_ID}/media`;

    // Build query parameters
    const params = new URLSearchParams({
      media_type: "REELS",
      caption: caption,
      cover_url: data.link.replace(/\.[^/.]+$/, ".jpg"),
      video_url: data.link,
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
      const errorMsg = `UPLOAD: ${
        responseData.error?.message || "Facebook API error"
      }`;
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

    // Update sheet with creation_id
    const creationId = responseData.id;
    await updateSheetRow(sheets, rowIndex, { creationId });

    return NextResponse.json({
      success: true,
      creationId,
      row: rowIndex,
      name: data.name,
      captionGenerated,
      caption: captionGenerated ? caption : undefined,
      message: captionGenerated 
        ? "Caption generated by AI, upload successful, creation ID saved to sheet"
        : "Upload successful, creation ID saved to sheet",
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