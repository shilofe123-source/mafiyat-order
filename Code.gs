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

// ─── המפתח נשמר ב-Script Properties — לא חשוף בקוד המקור ─────────────────────
// להגדרה: בעורך Apps Script → Project Settings → Script Properties → הוסף GEMINI_API_KEY
const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");

// ─── doPost ───────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // ── ניתוח תמונה עם Gemini Vision (legacy) ──────────────────────────────
    if (data.action === "analyzeImage") {
      if (!GEMINI_API_KEY) {
        return jsonResponse({ status: "no_key" });
      }
      const description = callGeminiVision(data.base64, data.mimeType);
      return jsonResponse({ status: "success", description });
    }

    // ── חילוץ הזמנה מתמונה/PDF עם Gemini ───────────────────────────────────
    if (data.action === "extractOrder") {
      if (!GEMINI_API_KEY) {
        return jsonResponse({ status: "no_key" });
      }
      const order = extractOrderFromImage(data.base64, data.mimeType);
      return jsonResponse({
        status: order._error ? "extraction_error" : "success",
        order: order,
        debug: order._error ? { error: order._error, detail: order._detail || "" } : undefined
      });
    }

    // ── שמירת הזמנה לגיליון ───────────────────────────────────────────────────
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("הזמנות") || ss.getSheets()[0];

    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "חותמת זמן קבלה", "תאריך הזמנה", "שם לקוח", "טלפון",
        "סוג אירוע", "מספר אורחים", "פריטים", 'סה"כ לפני הנחה',
        "הנחה", "סכום סופי", "הערות", "אושר בתאריך", "מזהה הזמנה", "שעת איסוף"
      ]);
    }

    const rowData = [
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
      data.approvedAt   || "",
      data.orderId      || "",
      data.pickupTime   || ""
    ];

    // ── מצב עורך: חפש והחלף שורה קיימת לפי מזהה הזמנה (עמודה M) ────────────
    if (data.editorMode === true && data.orderId) {
      const lastRow = sheet.getLastRow();
      var found = false;
      for (var r = lastRow; r >= 2; r--) {
        var idCell = sheet.getRange(r, 13).getValue();
        if (String(idCell).trim() === String(data.orderId).trim()) {
          sheet.getRange(r, 1, 1, 14).setValues([rowData]);
          found = true;
          break;
        }
      }
      if (!found) {
        sheet.appendRow(rowData);
      }
    } else {
      sheet.appendRow(rowData);
    }

    // -- [EMAIL] שליחת PDF למייל — ניתן להסרה בהמשך (למעבר לוואטסאפ) --
    if (data.pdfBase64 && data.emailTo) {
      try {
        var pdfBlob = Utilities.newBlob(
          Utilities.base64Decode(data.pdfBase64),
          "application/pdf",
          data.pdfFilename || "הזמנה.pdf"
        );
        MailApp.sendEmail({
          to: data.emailTo,
          subject: "הזמנה חדשה — " + (data.customerName || "לקוח") + " — מאפיית השומרון",
          body: "שלום בת חן,\n\nהתקבלה הזמנה חדשה:\n"
            + "לקוח: " + (data.customerName || "") + "\n"
            + "טלפון: " + (data.phone || "") + "\n"
            + "תאריך: " + (data.orderDate || "") + "\n"
            + "שעת איסוף: " + (data.pickupTime || "") + "\n"
            + "סכום: " + (data.finalPrice || 0) + " ש\"ח\n\n"
            + "PDF מצורף.\n\n— מערכת הזמנות מאפיית השומרון",
          attachments: [pdfBlob]
        });
      } catch (emailErr) {
        Logger.log("Email send error: " + emailErr.toString());
      }
    }
    // -- [/EMAIL] --

    // עדכון גיליון סיכום
    updateSummary(data.customerName, data.finalPrice || ((data.totalPrice || 0) - (data.discount || 0)), data.editorMode === true);

    return jsonResponse({ status: "success" });

  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

// ─── חילוץ הזמנה מתמונה ──────────────────────────────────────────────────────
function extractOrderFromImage(base64Image, mimeType) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY;

  const productList = [
    "id:1 שיפודי מוצרלה 180₪", "id:2 פלטת גבינות קשות 380₪",
    "id:3 מגש מאפים טריים 100₪", "id:4 פוקצ'ינות 140₪",
    "id:5 כריכוני ביס 180₪", "id:6 מגש פחזניות 180₪",
    "id:7 פלטת פירות העונה 250₪", "id:8 רול טורטיה 180₪",
    "id:9 מגש מתוקים 295₪", "id:10 מיני פיצה מרגריטה 140₪",
    "id:11 בוריקיטס 180₪", "id:12 מיני קיש 195₪",
    "id:13 כריכוני קרואסון חמאה 140₪", "id:14 סושי טורטיה 195₪",
    "id:15 אנטיפסטי 195₪", "id:16 מגש מיני ג'חנון 180₪",
    "id:17 בוריקיטס סביח 180₪", "id:18 פריקסה 195₪",
    "id:19 שקשוקה 180₪", "id:20 פסטה 120₪",
    "id:21 סלטים טריים 165₪", "id:22 מגש כדורי שוקולד 180₪",
    "id:23 פלטת ירקות טריים 160₪", "id:24 מיני לחם שום 120₪",
    "id:25 עוגות בחושות 170₪", "id:26 מגש קוקיז חמאה 180₪",
    "id:27 ביצים מקושקשות 180₪"
  ].join(", ");

  const prompt = 'בתמונה הזו יש הזמנה (צילום מסך וואטסאפ, רשימה כתובה ביד, PDF, או כל פורמט אחר). '
    + 'זהה את המוצרים והכמויות, והתאם אותם לרשימת המוצרים הבאה: ' + productList + '. '
    + 'החזר JSON בלבד (ללא markdown, ללא הסברים) בפורמט הבא: '
    + '{"items":[{"id":1,"qty":2}],"customerName":"...","phone":"...","date":"...","event":"...","guests":"","notes":"..."} '
    + 'אם לא ניתן לזהות שדה מסוים, השאר אותו כמחרוזת ריקה. items חייב להכיל לפחות פריט אחד.';

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType || "image/jpeg", data: base64Image } }
      ]
    }],
    generationConfig: { maxOutputTokens: 2048, temperature: 0.1 }
  };

  const response = UrlFetchApp.fetch(url, {
    method: "POST",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    Logger.log("Gemini HTTP error: " + responseCode + " | " + responseText.substring(0, 300));
    return { items: [], _error: "gemini_http_" + responseCode, _detail: responseText.substring(0, 200) };
  }

  try {
    const result = JSON.parse(responseText);

    // בדיקת שגיאת API
    if (result.error) {
      Logger.log("Gemini API error: " + JSON.stringify(result.error));
      return { items: [], _error: "gemini_api_error", _detail: result.error.message || JSON.stringify(result.error).substring(0, 200) };
    }

    // בדיקת candidates
    if (!result.candidates || !result.candidates[0]) {
      return { items: [], _error: "no_candidates", _detail: JSON.stringify(result).substring(0, 200) };
    }

    // בדיקת חסימת תוכן
    if (result.candidates[0].finishReason === "SAFETY") {
      return { items: [], _error: "blocked_by_safety" };
    }

    if (!result.candidates[0].content) {
      return { items: [], _error: "no_content", _detail: JSON.stringify(result.candidates[0]).substring(0, 200) };
    }

    var text = result.candidates[0].content.parts[0].text;
    text = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    // חיפוש JSON בתוך הטקסט אם יש טקסט נוסף
    var jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(text);
  } catch (parseErr) {
    Logger.log("JSON parse error: " + parseErr.toString() + " | Response: " + responseText.substring(0, 500));
    return { items: [], _error: "parse_fail", _detail: parseErr.toString() };
  }
}

// ─── Gemini Vision (תיאור תמונה) ─────────────────────────────────────────────
function callGeminiVision(base64Image, mimeType) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY;

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

// ─── עדכון גיליון סיכום ──────────────────────────────────────────────────────
function updateSummary(customerName, finalPrice, isEditorMode) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var summary = ss.getSheetByName("סיכום");
  if (!summary) return;

  // מחיקת עמודה שלישית אם קיימת (חד-פעמי)
  if (summary.getLastColumn() >= 3) {
    summary.deleteColumn(3);
  }

  // הוספת כותרות אם הגיליון ריק
  if (summary.getLastRow() === 0) {
    summary.appendRow(["שם לקוח", "סכום הזמנה"]);
  }

  // מצב עורך: חיפוש והחלפת שורה קיימת לפי שם לקוח
  if (isEditorMode && customerName) {
    var lastRow = summary.getLastRow();
    for (var r = lastRow; r >= 2; r--) {
      if (String(summary.getRange(r, 1).getValue()).trim() === String(customerName).trim()) {
        summary.getRange(r, 2).setValue(finalPrice);
        return;
      }
    }
  }

  // הזמנה חדשה או לא נמצאה שורה קיימת
  summary.appendRow([customerName, finalPrice]);
}

// ─── עזר ─────────────────────────────────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
