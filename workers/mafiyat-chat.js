// Worker 1: mafiyat-chat
// מקבל הודעות מה-frontend ומעביר לאנתרופיק API
//
// Secrets נדרשים ב-Cloudflare Dashboard:
//   ANTHROPIC_API_KEY

export default {
  async fetch(req, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const body = await req.json().catch(() => ({}));
      const { message, history = [], systemPrompt = "", image } = body;

      if (!message && !image) {
        return Response.json({ error: "No message provided" }, { status: 400, headers: corsHeaders });
      }

      const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
      if (!ANTHROPIC_API_KEY) {
        return Response.json({ error: "API key not configured" }, { status: 500, headers: corsHeaders });
      }

      let userContent = message;
      if (image && image.base64 && image.mimeType) {
        const isPdf = image.mimeType === "application/pdf";
        const contentParts = [
          isPdf
            ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: image.base64 } }
            : { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.base64 } }
        ];
        if (message) {
          contentParts.push({ type: "text", text: message });
        }
        userContent = contentParts;
      }

      const messages = [
        ...history,
        { role: "user", content: userContent }
      ];

      const defaultSystem = `אתה עוזר חכם וחביב של מאפיית השומרון.\nתפקידך לייעץ ללקוחות בבחירת מנות ומגשים לאירועים שלהם.\nדבר תמיד בעברית, בסגנון חם וידידותי.\nהכשרות: מהדרין רבנות קרני שומרון.\nבסוף כל ייעוץ הצע לעזור למלא את טופס ההזמנה.\nאל תדון בנושאים שאינם קשורים למאפייה ולאוכל.`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: systemPrompt || defaultSystem,
          messages: messages,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("Anthropic error:", err);
        return Response.json({ error: "AI service error", details: err }, { status: 502, headers: corsHeaders });
      }

      const data = await res.json();
      const reply = data.content?.[0]?.text || "מצטער, לא הצלחתי לענות. נסה שוב.";

      return Response.json({ response: reply }, { headers: corsHeaders });

    } catch (error) {
      console.error("Error:", error);
      return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
    }
  }
};
