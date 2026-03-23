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
      return jsonResponse({ status: "success", order: order });
    }

    // ── שמירת הזמנה לגיליון ───────────────────────────────────────────────────
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("הזמנות") || ss.getSheets()[0];

    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "חותמת זמן קבלה", "תאריך הזמנה", "שם לקוח", "טלפון",
        "סוג אירוע", "מספר אורחים", "פריטים", 'סה"כ לפני הנחה',
        "הנחה", "סכום סופי", "הערות", "אושר בתאריך", "מזהה הזמנה"
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
      data.orderId      || ""
    ];

    // ── מצב עורך: חפש והחלף שורה קיימת לפי מזהה הזמנה (עמודה M) ────────────
    if (data.editorMode === true && data.orderId) {
      const lastRow = sheet.getLastRow();
      var found = false;
      for (var r = lastRow; r >= 2; r--) {
        var idCell = sheet.getRange(r, 13).getValue();
        if (String(idCell).trim() === String(data.orderId).trim()) {
          sheet.getRange(r, 1, 1, 13).setValues([rowData]);
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
    "id:1 מגש כריכוני ביס 180₪", "id:2 מיני פיתה סביח 180₪",
    "id:3 כריכוני קרואסון חמאה 140₪", "id:4 חצאי טורטיה (12) 105₪",
    "id:5 חצאי טורטיה (24) 195₪", "id:6 מיני טורטיה 195₪",
    "id:7 בוריקיטס 180₪", "id:8 בוריקיטס סביח 180₪",
    "id:9 פריקסה 195₪", "id:10 מגש מיני קיש 195₪",
    "id:11 מגש פיצוניות 160₪", "id:12 פוקצ'ינות 160₪",
    "id:13 מיני לחם שום 120₪", "id:14 מגש מאפים טריים 100₪",
    "id:15 פסטה 120₪", "id:16 מגש שקשוקה 180₪",
    "id:17 מגש מיני גחנון 180₪", "id:18 מגש מקושקשת 180₪",
    "id:19 פלטת גבינות קשות 380₪", "id:20 פלטת ירקות שוק 160₪",
    "id:21 שיפודי מוצרלה 180₪", "id:22 אנטיפסטי 195₪",
    "id:23 סלטים טריים (קיסר) 120₪", "id:24 סלטים טריים 165₪",
    "id:25 פלטת פירות העונה 250₪", "id:26 מגש מתוקים 295₪",
    "id:27 מגש כדורי שוקולד 180₪", "id:28 מגש קוקיז חמאה 180₪",
    "id:29 מגש פחזניות 180₪", "id:30 מגש עוגות בחושות 170₪"
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
    generationConfig: { maxOutputTokens: 1024 }
  };

  const response = UrlFetchApp.fetch(url, {
    method: "POST",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());
  if (result.candidates && result.candidates[0]) {
    var text = result.candidates[0].content.parts[0].text;
    // ניקוי markdown wrapping
    text = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(text);
  }
  return { items: [], customerName: "", phone: "", date: "", event: "", guests: "", notes: "" };
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
