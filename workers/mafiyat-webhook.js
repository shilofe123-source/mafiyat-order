// Worker 2: mafiyat-webhook
// מקבל הודעות WhatsApp נכנסות ומעביר ל-mafiyat-chat
//
// Secrets נדרשים ב-Cloudflare Dashboard:
//   WHATSAPP_ACCESS_TOKEN
//   WHATSAPP_PHONE_NUMBER_ID
//   BAKERY_CHAT_URL  ← ה-URL של mafiyat-chat Worker
//
// לאחר פריסה: עדכן את Webhook URL ב-Meta Developers לכתובת ה-Worker הזה

const VERIFY_TOKEN = "mafiyat_hashomron_2026";

export default {
  async fetch(req, env, ctx) {
    // אימות Webhook ע"י Meta (GET)
    if (req.method === "GET") {
      const url = new URL(req.url);
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");

      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }
      return new Response("Forbidden", { status: 403 });
    }

    if (req.method === "POST") {
      try {
        const body = await req.json();
        const entry = body?.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;

        if (!messages || messages.length === 0) {
          return new Response("OK", { status: 200 });
        }

        const msg = messages[0];
        const from = msg.from;
        const text = msg.text?.body;

        if (!text) return new Response("OK", { status: 200 });

        // מעבד ברקע — מחזיר 200 מיד ל-Meta כדי למנוע Timeout וניסיונות חוזרים
        async function processAndReply() {
          try {
            const FUNCTION_URL = env.BAKERY_CHAT_URL;
            const aiRes = await fetch(FUNCTION_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: text, history: [] }),
            });

            const aiData = await aiRes.json();
            const reply = aiData.response || "מצטערים, אירעה שגיאה. נסה שוב.";

            const WHATSAPP_TOKEN = env.WHATSAPP_ACCESS_TOKEN;
            const PHONE_NUMBER_ID = env.WHATSAPP_PHONE_NUMBER_ID;

            if (WHATSAPP_TOKEN && PHONE_NUMBER_ID) {
              await fetch(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  messaging_product: "whatsapp",
                  to: from,
                  type: "text",
                  text: { body: reply },
                }),
              });
            }
          } catch (e) {
            console.error("Error processing message:", e);
          }
        }

        ctx.waitUntil(processAndReply());

        return new Response("OK", { status: 200 });
      } catch (error) {
        console.error("Webhook error:", error);
        return new Response("Error", { status: 500 });
      }
    }

    return new Response("Method not allowed", { status: 405 });
  }
};
