/**
 * מאפיית השומרון — Google Apps Script
 *
 * הגדרות פריסה (Deploy):
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * עמודות בגיליון "הזמנות":
 *   A: חותמת זמן קבלה  B: תאריך הזמנה  C: שם לקוח  D: טלפון
 *   E: סוג אירוע  F: מספר אורחים  G: פריטים  H: סה"כ לפני הנחה
 *   I: הנחה  J: סכום סופי  K: הערות  L: אושר בתאריך
 */

// ─── המפתח נשמר כאן בצד-שרת — לא חשוף למשתמשים ────────────────────────────
const GEMINI_API_KEY = "AIzaSyA_ya_X9zo9ytxCZCL37lPyz2HToKnKHbs";

// ─── doPost ───────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // ── ניתוח תמונה עם Gemini Vision ──────────────────────────────────────────
    if (data.action === "analyzeImage") {
      if (!GEMINI_API_KEY) {
        return jsonResponse({ status: "no_key" });
      }
      const description = callGeminiVision(data.base64, data.mimeType);
      return jsonResponse({ status: "success", description });
    }

    // ── שמירת הזמנה לגיליון ───────────────────────────────────────────────────
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("הזמנות") || ss.getSheets()[0];

    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "חותמת זמן קבלה", "תאריך הזמנה", "שם לקוח", "טלפון",
        "סוג אירוע", "מספר אורחים", "פריטים", 'סה"כ לפני הנחה',
        "הנחה", "סכום סופי", "הערות", "אושר בתאריך"
      ]);
    }

    sheet.appendRow([
      new Date(),
      data.orderDate    || "",
      data.customerName || "",
      data.phone        || "",
      data.event        || "",
      data.guests       || "",
      data.items        || "",
      data.totalPrice   || 0,
      data.discount     || 0,
      data.finalPrice   || 0,
      data.notes        || "",
      data.approvedAt   || ""
    ]);

    return jsonResponse({ status: "success" });

  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

// ─── Gemini Vision ────────────────────────────────────────────────────────────
function callGeminiVision(base64Image, mimeType) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + GEMINI_API_KEY;

  const payload = {
    contents: [{
      parts: [
        { text: "תאר את התמונה הזו בקצרה בעברית (משפט אחד)." },
        { inline_data: { mime_type: mimeType || "image/jpeg", data: base64Image } }
      ]
    }],
    generationConfig: { maxOutputTokens: 100 }
  };

  const response = UrlFetchApp.fetch(url, {
    method: "POST",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());
  if (result.candidates && result.candidates[0]) {
    return result.candidates[0].content.parts[0].text;
  }
  return "תמונה נטענה";
}

// ─── GET — בדיקת חיות ────────────────────────────────────────────────────────
function doGet(e) {
  return jsonResponse({ status: "ok", message: "מאפיית השומרון — Apps Script פעיל" });
}

// ─── עזר ─────────────────────────────────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
