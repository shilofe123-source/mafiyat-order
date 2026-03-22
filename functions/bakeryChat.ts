Deno.serve(async (req) => {
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
    const { message, history = [], systemPrompt = "" } = body;

    if (!message) {
      return Response.json({ error: "No message provided" }, { status: 400, headers: corsHeaders });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return Response.json({ error: "API key not configured" }, { status: 500, headers: corsHeaders });
    }

    const messages = [
      ...history,
      { role: "user", content: message }
    ];

    const defaultSystem = `אתה עוזר חכם וחביב של מאפיית השומרון.
תפקידך לייעץ ללקוחות בבחירת מנות ומגשים לאירועים שלהם.
דבר תמיד בעברית, בסגנון חם וידידותי.
הכשרות: מהדרין רבנות קרני שומרון.
בסוף כל ייעוץ הצע לעזור למלא את טופס ההזמנה.
אל תדון בנושאים שאינם קשורים למאפייה ולאוכל.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
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
});
