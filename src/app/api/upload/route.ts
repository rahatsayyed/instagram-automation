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

async function getNextUnprocessedRow(sheets: any, sheetName: string) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:K`, // Skip header row, columns A-K
  });

  const rows = response.data.values || [];

  // Find first row where:
  // - Cloudinary URL exists (column C)
  // - Instagram Caption is empty or exists (column H)
  // - Published At (IG) is empty (column I)
  // - Creation ID is empty (column J)
  // - Error is empty (column K)
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cloudinaryUrl = row[2] || ""; // Column C (index 2)
    const publishedAt = row[8] || ""; // Column I (index 8)
    const creationId = row[9] || ""; // Column J (index 9)
    const error = row[10] || ""; // Column K (index 10)

    if (cloudinaryUrl && !publishedAt && !creationId && !error) {
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
  updates: { caption?: string; creationId?: string; error?: string }
) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  // Update Instagram Caption (column H)
  if (updates.caption !== undefined) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!H${rowIndex}`,
      valueInputOption: "RAW",
      resource: { values: [[updates.caption]] },
    });
  }

  // Update Creation ID (column J)
  if (updates.creationId !== undefined) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!J${rowIndex}`,
      valueInputOption: "RAW",
      resource: { values: [[updates.creationId]] },
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
    // const body = await request.json();
    const sheetName = process.env.GOOGLE_SHEET_NAME || "motivational"; // Default category

    // Get Google Sheets client
    const sheets = await getGoogleSheetsClient();

    // Get next unprocessed row
    const nextRow = await getNextUnprocessedRow(sheets, sheetName);

    if (!nextRow) {
      return NextResponse.json(
        {
          error: `No unprocessed rows found in sheet '${sheetName}'`,
          message:
            "All videos are either already uploaded or have errors. Add new videos or clear errors.",
        },
        { status: 404 }
      );
    }

    const { rowIndex, data } = nextRow;

    // Validate required fields from sheet
    if (!data.cloudinaryUrl) {
      const errorMsg = `[${new Date().toISOString()}] UPLOAD: Missing Cloudinary URL`;
      await updateSheetRow(sheets, sheetName, rowIndex, { error: errorMsg });
      return NextResponse.json(
        { error: errorMsg, row: rowIndex, sheetName },
        { status: 400 }
      );
    }

    // Check if title exists
    if (!data.title) {
      const errorMsg = `[${new Date().toISOString()}] UPLOAD: Missing video title`;
      await updateSheetRow(sheets, sheetName, rowIndex, { error: errorMsg });
      return NextResponse.json(
        { error: errorMsg, row: rowIndex, sheetName },
        { status: 400 }
      );
    }

    // Generate caption if not present
    let caption = data.instagramCaption;
    let captionGenerated = false;

    if (!caption) {
      try {
        caption = await generateCaption(data.title, data.description);
        captionGenerated = true;

        // Update the caption in the sheet
        await updateSheetRow(sheets, sheetName, rowIndex, { caption });
      } catch (aiError) {
        const errorMsg = `[${new Date().toISOString()}] UPLOAD: Failed to generate caption - ${
          aiError instanceof Error ? aiError.message : "Unknown AI error"
        }`;
        await updateSheetRow(sheets, sheetName, rowIndex, { error: errorMsg });
        return NextResponse.json(
          {
            error: "Failed to generate caption",
            details:
              aiError instanceof Error ? aiError.message : "Unknown error",
            row: rowIndex,
            sheetName,
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
      cover_url: data.cloudinaryUrl.replace(/\.[^/.]+$/, ".jpg"),
      video_url: data.cloudinaryUrl,
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
      const errorMsg = `[${new Date().toISOString()}] UPLOAD: ${
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

    // Update sheet with creation_id
    const creationId = responseData.id;
    await updateSheetRow(sheets, sheetName, rowIndex, { creationId });

    return NextResponse.json({
      success: true,
      creationId,
      row: rowIndex,
      sheetName,
      title: data.title,
      youtubeUrl: data.youtubeUrl,
      cloudinaryUrl: data.cloudinaryUrl,
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