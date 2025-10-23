import OpenAI from "openai";

export async function generateCaption(title: string): Promise<string> {
  const apiKey = process.env.AI_API_KEY;
  const modelName = process.env.AI_MODEL_NAME || "gpt-4o-mini";
  const baseURL = process.env.AI_BASE_URL;

  if (!apiKey || !baseURL || !modelName) {
    throw new Error(
      "AI_API_KEY, AI_BASE_URL, or AI_MODEL_NAME is not configured"
    );
  }

  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: baseURL,
  });

  const prompt = `Generate an engaging Instagram caption for a reel with the title: "${title}". 
The caption should be:
- Attention-grabbing and creative
- Include relevant emojis
- Be 1-3 sentences long
- Include 3-5 relevant hashtags at the end
- Be suitable for Instagram reels

Only return the caption text, nothing else.`;

  try {
    const response = await client.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    const caption = response.choices[0]?.message?.content?.trim() || "";
    if (!caption) {
      console.error("Failed to generate caption from AI");
      throw new Error("Failed to generate caption from AI");
    }

    return caption;
  } catch (error) {
    console.error("Failed to generate caption from AI", error);
    throw new Error("Failed to generate caption from AI" + error);
  }
}
