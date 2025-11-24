import { HfInference } from "@huggingface/inference";
const hf = new HfInference(process.env.HUGGINGFACE_TOKEN);
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();




const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_KEY,
});

export const generateAIInsight = async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt)
      return res.status(400).json({ success: false, message: "Prompt required" });

    // Call OpenAI model
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Or "gpt-4o" for more advanced
      messages: [
        {
          role: "system",
          content: "You are an AI assistant that gives event and attendance insights.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const aiResponse = completion.choices[0].message.content;

    res.json({ success: true, insight: aiResponse });
  } catch (error) {
    console.error("AI Insight Error:", error);
    res.status(500).json({ success: false, message: "AI generation failed" });
  }
};





export const generateEventSummary = async (req, res) => {
  try {
    const { title, description, location, hours, participants } = req.body;

    const input = `
      Event Title: ${title}
      Description: ${description}
      Location: ${location}
      Duration: ${hours} hours
      Participants: ${participants.join(", ")}
      Generate a short, professional event summary for NSS.
    `;

    // ✅ Use the correct method for BART
    const result = await hf.summarization({
      model: "facebook/bart-large-cnn",
      inputs: input,
      parameters: { max_length: 200, min_length: 60 },
    });

    res.json({
      success: true,
      summary: result.summary_text || result[0]?.summary_text || "No summary generated",
    });
  } catch (error) {
    console.error("AI Summary Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate summary",
    });
  }
};
