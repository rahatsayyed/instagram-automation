import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    // Get the access token from environment variables
    const ACCESSTOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
    const APP_ID = process.env.APPID;

    if (!ACCESSTOKEN || !APP_ID) {
      return NextResponse.json(
        { error: "Instafram access token or APP_ID is not configured" },
        { status: 500 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { video_url, caption } = body;

    // Validate required fields
    if ( !video_url || !caption) {
      return NextResponse.json(
        { error: "Missing required fields: caption and video_url are required" },
        { status: 400 }
      );
    }

    // Build the Facebook API URL
    const apiUrl = `https://graph.facebook.com/v23.0/${APP_ID}/media`;

    // Build query parameters
    const params = new URLSearchParams({
      media_type: "REELS",
      caption: caption,
      cover_url: video_url.replace(/\.[^/.]+$/, ".jpg"),
      video_url: video_url,
    });

    // Make the request to Facebook API
    const response = await fetch(`${apiUrl}?${params.toString()}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESSTOKEN}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    // Return the response from Facebook API
    if (!response.ok) {
      return NextResponse.json(
        { error: "Facebook API error", details: data },
        { status: response.status }
      );
    }

    return NextResponse.json(data, { status: 200 });
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
