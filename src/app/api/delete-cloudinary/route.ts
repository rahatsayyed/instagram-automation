import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import cloudinary from "cloudinary";

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

async function getPublishedRows(sheets: any, sheetName: string) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:K`, // Skip header row, columns A-K
  });
  const rows = response.data.values || [];
  const publishedRows = [];
  // Find all rows where:
  // - Published At (IG) is not empty (column I)
  // - Cloudinary URL exists (column C)
  // - Optionally, no error (column K), but we'll process regardless
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cloudinaryUrl = row[2] || ""; // Column C (index 2)
    const publishedAt = row[8] || ""; // Column I (index 8)
    const error = row[10] || ""; // Column K (index 10)
    if (publishedAt && cloudinaryUrl) {
      publishedRows.push({
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
      });
    }
  }
  return publishedRows;
}

function extractPublicId(cloudinaryUrl: string): string | null {
  // Regex to extract public_id from standard Cloudinary URL
  // Matches after /upload/ (optionally skipping /v123...), captures until before .extension
  const match = cloudinaryUrl.match(/\/upload(?:\/v\d+)?\/([^\.\/]+(?:\/[^\.\/]+)*)\.\w+$/);
  return match ? match[1] : null;
}

export async function GET(request: NextRequest) {
  try {
    // Validate Cloudinary config
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return NextResponse.json(
        { error: "Cloudinary configuration is not set" },
        { status: 500 }
      );
    }

    const sheetName = process.env.GOOGLE_SHEET_NAME || "motivational"; // Default category

    // Get Google Sheets client
    const sheets = await getGoogleSheetsClient();

    // Get all published rows
    const publishedRows = await getPublishedRows(sheets, sheetName);
    if (publishedRows.length === 0) {
      return NextResponse.json(
        {
          success: true,
          message: `No published rows with Cloudinary URLs found in sheet '${sheetName}'`,
          deletedCount: 0,
        },
        { status: 200 }
      );
    }

    const results = [];
    let deletedCount = 0;

    for (const { rowIndex, data } of publishedRows) {
      const publicId = extractPublicId(data.cloudinaryUrl);
      if (!publicId) {
        results.push({
          rowIndex,
          title: data.title,
          cloudinaryUrl: data.cloudinaryUrl,
          status: "skipped",
          reason: "Could not extract public_id from URL",
        });
        continue;
      }

      try {
        const deleteResult = await cloudinary.v2.uploader.destroy(publicId);
        if (deleteResult.result === "ok" || deleteResult.result === "not found") {
          deletedCount++;
          results.push({
            rowIndex,
            title: data.title,
            publicId,
            cloudinaryUrl: data.cloudinaryUrl,
            status: "deleted",
            deleteResult,
          });
          // Optionally: Update sheet to clear cloudinaryUrl (column C)
          // await sheets.spreadsheets.values.update({
          //   spreadsheetId: process.env.GOOGLE_SHEET_ID,
          //   range: `${sheetName}!C${rowIndex}`,
          //   valueInputOption: "RAW",
          //   resource: { values: [[""]] },
          // });
        } else {
          throw new Error(`Delete failed: ${deleteResult.result}`);
        }
      } catch (deleteError) {
        console.error(`Failed to delete ${publicId}:`, deleteError);
        results.push({
          rowIndex,
          title: data.title,
          publicId,
          cloudinaryUrl: data.cloudinaryUrl,
          status: "error",
          error: deleteError instanceof Error ? deleteError.message : "Unknown delete error",
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Cleanup completed for sheet '${sheetName}'`,
      totalRowsProcessed: publishedRows.length,
      deletedCount,
      results,
    });
  } catch (error) {
    console.error("Error in cleanup endpoint:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}