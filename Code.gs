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

// ─── מפתחות נשמרים ב-Script Properties — לא חשופים בקוד המקור ────────────────
// להגדרה: בעורך Apps Script → Project Settings → Script Properties
//   GEMINI_API_KEY, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID
const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
const WA_TOKEN = PropertiesService.getScriptProperties().getProperty("WHATSAPP_TOKEN");
const WA_PHONE_ID = PropertiesService.getScriptProperties().getProperty("WHATSAPP_PHONE_ID");
const WA_API = "https://graph.facebook.com/v21.0/" + WA_PHONE_ID;

// ─── WhatsApp: מספרי טלפון קבועים ─────────────────────────────────────────────
const PHONES = { uri: "972524767233", batchen: "972542031448" };

// ─── WhatsApp: רישום שגיאות לגיליון "errors" ──────────────────────────────────
function logError(context, error) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("errors");
    if (!sheet) {
      sheet = ss.insertSheet("errors");
      sheet.appendRow(["timestamp", "context", "error", "detail"]);
    }
    var detail = typeof error === "object" ? JSON.stringify(error).substring(0, 500) : String(error).substring(0, 500);
    sheet.appendRow([new Date(), context, String(error).substring(0, 200), detail]);
  } catch (e) {
    Logger.log("logError failed: " + e.toString());
  }
}

// ─── WhatsApp: העלאת מדיה (שלב 1) ────────────────────────────────────────────
function uploadWhatsAppMedia(pdfBlob) {
  var url = WA_API + "/media";
  var boundary = "----FormBoundary" + Utilities.getUuid();
  var payload = Utilities.newBlob("").getBytes();

  var fileBytes = pdfBlob.getBytes();
  var header = "--" + boundary + "\r\n"
    + 'Content-Disposition: form-data; name="messaging_product"\r\n\r\nwhatsapp\r\n'
    + "--" + boundary + "\r\n"
    + 'Content-Disposition: form-data; name="type"\r\n\r\napplication/pdf\r\n'
    + "--" + boundary + "\r\n"
    + 'Content-Disposition: form-data; name="file"; filename="' + pdfBlob.getName() + '"\r\n'
    + "Content-Type: application/pdf\r\n\r\n";
  var footer = "\r\n--" + boundary + "--\r\n";

  payload = [].concat(
    Utilities.newBlob(header).getBytes(),
    fileBytes,
    Utilities.newBlob(footer).getBytes()
  );

  var response = UrlFetchApp.fetch(url, {
    method: "POST",
    headers: { "Authorization": "Bearer " + WA_TOKEN },
    contentType: "multipart/form-data; boundary=" + boundary,
    payload: payload,
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var body = JSON.parse(response.getContentText());
  if (code !== 200 || !body.id) {
    logError("uploadWhatsAppMedia", { code: code, body: body });
    return null;
  }
  return body.id;
}

// ─── WhatsApp: שליחת PDF (שלב 2) ─────────────────────────────────────────────
function sendWhatsAppDocument(phone, mediaId, filename, caption) {
  var url = WA_API + "/messages";
  var payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "document",
    document: { id: mediaId, filename: filename, caption: caption }
  };

  var response = UrlFetchApp.fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + WA_TOKEN,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code !== 200) {
    var body = response.getContentText();
    logError("sendWhatsAppDocument to " + phone, { code: code, body: body });
    return false;
  }
  return true;
}

// ─── WhatsApp: שליחת הודעת טקסט ───────────────────────────────────────────────
function sendWhatsAppText(phone, text) {
  var url = WA_API + "/messages";
  var payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: { body: text }
  };

  var response = UrlFetchApp.fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + WA_TOKEN,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code !== 200) {
    logError("sendWhatsAppText to " + phone, { code: code, body: response.getContentText() });
    return false;
  }
  return true;
}

// ─── WhatsApp: שליחת הודעת template ───────────────────────────────────────────
function sendWhatsAppTemplate(phone, templateName, params) {
  var url = WA_API + "/messages";
  var components = [];
  if (params && params.length > 0) {
    components.push({
      type: "body",
      parameters: params.map(function(p) { return { type: "text", text: p }; })
    });
  }
  var payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: { name: templateName, language: { code: "he" }, components: components }
  };

  var response = UrlFetchApp.fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + WA_TOKEN,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code !== 200) {
    logError("sendWhatsAppTemplate " + templateName + " to " + phone, { code: code, body: response.getContentText() });
    return false;
  }
  return true;
}

// ─── WhatsApp: שליחת PDF להזמנה (upload + send לשני המספרים) ──────────────────
function sendOrderPdfViaWhatsApp(pdfBase64, filename, caption, customerPhone) {
  if (!WA_TOKEN || !WA_PHONE_ID) {
    logError("sendOrderPdfViaWhatsApp", "Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_ID in Script Properties");
    return { success: false, error: "missing_config" };
  }

  var pdfBlob = Utilities.newBlob(Utilities.base64Decode(pdfBase64), "application/pdf", filename);
  var mediaId = uploadWhatsAppMedia(pdfBlob);
  if (!mediaId) {
    return { success: false, error: "upload_failed" };
  }

  var results = {};
  results.uri = sendWhatsAppDocument(PHONES.uri, mediaId, filename, caption);
  results.batchen = sendWhatsAppDocument(PHONES.batchen, mediaId, filename, caption);
  if (customerPhone) {
    results.customer = sendWhatsAppDocument(customerPhone, mediaId, filename, caption);
  }

  return { success: results.uri || results.batchen, results: results };
}

// ─── Email: שליחת מייל לבת חן ────────────────────────────────────────────────
function sendOrderEmail(data, pdfBase64, filename) {
  try {
    var subject = "הזמנה חדשה — " + (data.customerName || "לקוח") + " — " + (data.orderDate || "");
    var body = "הזמנה חדשה התקבלה במערכת\n\n"
      + "שם לקוח: " + (data.customerName || "") + "\n"
      + "טלפון: " + (data.phone || "") + "\n"
      + "תאריך הזמנה: " + (data.orderDate || "") + "\n"
      + "שעת איסוף: " + (data.pickupTime || "") + "\n"
      + "סוג אירוע: " + (data.event || "") + "\n"
      + "מספר אורחים: " + (data.guests || "") + "\n"
      + "פריטים: " + (data.items || "") + "\n"
      + "סכום סופי: " + (data.finalPrice || 0) + ' ש"ח\n'
      + "הערות: " + (data.notes || "") + "\n";

    var options = { to: "12bathen@gmail.com", subject: subject, body: body };
    if (pdfBase64) {
      var pdfBlob = Utilities.newBlob(Utilities.base64Decode(pdfBase64), "application/pdf", filename || "הזמנה.pdf");
      options.attachments = [pdfBlob];
    }
    MailApp.sendEmail(options);
    return true;
  } catch (e) {
    logError("sendOrderEmail", e.toString());
    return false;
  }
}

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

    // ── יצירת קוד תשלום ─────────────────────────────────────────────────────
    if (data.action === "generatePaymentCode") {
      var result = generatePaymentCode(data.orderId);
      return jsonResponse(result);
    }

    // ── אימות קוד תשלום ─────────────────────────────────────────────────────
    if (data.action === "validatePaymentCode") {
      var result = validatePaymentCode(data.code);
      if (!result.success && result.error === "invalid_code") {
        recordFailedAttempt(data.code);
      }
      return jsonResponse(result);
    }

    // ── שמירת משוב ──────────────────────────────────────────────────────────
    if (data.action === "saveFeedback") {
      var result = saveFeedback(data);
      return jsonResponse(result);
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

    // ── העתקה לגליון הזמנות מעודכן ─────────────────────────────────────────
    try { copyToRollingOrders(rowData); } catch(copyErr) { logError("doPost copyToRolling", copyErr.toString()); }

    // ── שליחת PDF בוואטסאפ לאורי ובת חן ──────────────────────────────────────
    var waResult;
    if (data.pdfBase64 && data.action !== "extractOrder") {
      try {
        var waCaption = "הזמנה חדשה — " + (data.customerName || "לקוח")
          + "\nתאריך: " + (data.orderDate || "")
          + "\nשעת איסוף: " + (data.pickupTime || "")
          + "\nסכום: " + (data.finalPrice || 0) + ' ש"ח';
        var customerPhone = data.phone ? data.phone.replace(/[\s\-()]/g, "").replace(/^0/, "972") : null;
        waResult = sendOrderPdfViaWhatsApp(
          data.pdfBase64,
          data.pdfFilename || "הזמנה.pdf",
          waCaption,
          customerPhone
        );
        if (!waResult.success) {
          logError("doPost WhatsApp send", waResult);
        }
      } catch (waErr) {
        logError("doPost WhatsApp exception", waErr.toString());
      }
    }

    // שמירת PDF בתיקיית החודש בדרייב
    if (data.pdfBase64) {
      try {
        savePdfToDrive(data.pdfBase64, data.pdfFilename || "הזמנה.pdf", data.orderDate);
      } catch (driveErr) {
        logError("doPost Drive save", driveErr.toString());
      }
    }

    // ── שליחת מייל לבת חן ──────────────────────────────────────────────────
    var emailResult = false;
    if (data.pdfBase64) {
      try {
        emailResult = sendOrderEmail(data, data.pdfBase64, data.pdfFilename || "הזמנה.pdf");
      } catch (emailErr) {
        logError("doPost email", emailErr.toString());
      }
    }

    // עדכון גיליון סיכום
    updateSummary(data.customerName, data.finalPrice || ((data.totalPrice || 0) - (data.discount || 0)), data.editorMode === true);

    // ── עדכון גליון כמויות ──────────────────────────────────────────────────
    try { updateQuantitiesSheet(data); } catch(qtyErr) { logError("doPost quantities", qtyErr.toString()); }

    return jsonResponse({
      status: "success",
      notifications: {
        whatsapp: !!(typeof waResult !== 'undefined' && waResult && waResult.success),
        email: emailResult
      }
    });

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
    "id:27 ביצים מקושקשות 180₪",
    "id:28 סלט שוק 120₪", "id:29 סלט קיסר 120₪",
    "id:30 סלט קינואה 165₪", "id:31 סלט הבית 165₪",
    "id:32 סלט פסטה 165₪", "id:33 סלט סביח 165₪"
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

// ─── תזכורות יומיות + משוב (טריגר יומי בשעה 12:00) ──────────────────────────
// הרצה חד-פעמית: setupDailyTrigger()
function setupDailyTrigger() {
  // מחיקת טריגרים קיימים
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "sendDailyAutomations") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendDailyAutomations")
    .timeBased()
    .atHour(12)
    .everyDays(1)
    .inTimezone("Asia/Jerusalem")
    .create();
}

function sendDailyAutomations() {
  // ניקוי כמויות שפג תוקפן
  try { cleanExpiredQuantities(); } catch(cleanErr) { logError("dailyAutomations cleanQuantities", cleanErr.toString()); }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("הזמנות");
  if (!sheet || sheet.getLastRow() < 2) return;

  var today = new Date();
  var tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  var yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

  var fmtD = function(d) { return Utilities.formatDate(d, "Asia/Jerusalem", "dd/MM/yyyy"); };
  var tomorrowStr = fmtD(tomorrow);
  var yesterdayStr = fmtD(yesterday);

  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var orderDate = String(row[1]).trim();   // B: תאריך הזמנה
    var customerName = String(row[2]).trim(); // C: שם לקוח
    var phone = String(row[3]).trim();        // D: טלפון
    var items = String(row[6]).trim();        // G: פריטים
    var pickupTime = String(row[13]).trim();  // N: שעת איסוף

    // ── תזכורת לבת חן — יום לפני ההזמנה ──
    if (orderDate === tomorrowStr) {
      // נסה template קודם, אם לא מאושר — שלח טקסט רגיל
      var reminderOk = sendWhatsAppTemplate(PHONES.batchen, "order_reminder", [customerName, items.substring(0, 100), pickupTime || "לא צוין"]);
      if (!reminderOk) {
        sendWhatsAppText(PHONES.batchen,
          "תזכורת הזמנה למחר:\n"
          + "לקוח: " + customerName + "\n"
          + "פריטים: " + items.substring(0, 200) + "\n"
          + "שעת איסוף: " + (pickupTime || "לא צוין")
        );
      }
    }

    // ── משוב ללקוח — יום אחרי ההזמנה ──
    if (orderDate === yesterdayStr && phone) {
      var surveyUrl = "https://shilofe123-source.github.io/mafiyat-order/survey.html?order=" + encodeURIComponent(String(row[12]).trim());
      var feedbackOk = sendWhatsAppTemplate(phone, "feedback_survey", [customerName, surveyUrl]);
      if (!feedbackOk) {
        sendWhatsAppText(phone,
          "שלום " + customerName + ",\n"
          + "תודה שהזמנתם ממאפיית השומרון!\n"
          + "נשמח לשמוע את דעתכם:\n" + surveyUrl
        );
      }
    }
  }
}

// ─── Payment: יצירת קוד חד-פעמי ──────────────────────────────────────────────
function generatePaymentCode(orderId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("הזמנות");
  if (!sheet) return { success: false, error: "no_sheet" };

  // חיפוש ההזמנה לפי orderId (עמודה M = 13)
  var data = sheet.getDataRange().getValues();
  for (var r = data.length - 1; r >= 1; r--) {
    if (String(data[r][12]).trim() === String(orderId).trim()) {
      var code = String(Math.floor(100000 + Math.random() * 900000));
      var now = new Date();

      // עמודה O (15) = payment code, P (16) = code timestamp, Q (17) = payment status, R (18) = attempts
      var rowNum = r + 1;
      // הרחב כותרות אם צריך
      if (sheet.getLastColumn() < 18) {
        var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        var needed = ["קוד תשלום", "זמן יצירת קוד", "סטטוס תשלום", "ניסיונות כושלים"];
        for (var c = headers.length; c < 18; c++) {
          sheet.getRange(1, c + 1).setValue(needed[c - 14] || "");
        }
      }

      sheet.getRange(rowNum, 15).setValue(code);
      sheet.getRange(rowNum, 16).setValue(now.toISOString());
      sheet.getRange(rowNum, 17).setValue("pending");
      sheet.getRange(rowNum, 18).setValue(0);

      // שליחת קוד ללקוח בוואטסאפ
      var customerPhone = String(data[r][3]).trim();
      var customerName = String(data[r][2]).trim();
      var paymentUrl = "https://shilofe123-source.github.io/mafiyat-order/payment.html?code=" + code;
      if (customerPhone) {
        sendWhatsAppText(customerPhone,
          "שלום " + customerName + ",\n"
          + "הזמנתך אושרה! הקוד שלך לתשלום: " + code + "\n"
          + "לתשלום: " + paymentUrl
        );
      }

      return { success: true, code: code, phone: customerPhone };
    }
  }
  return { success: false, error: "order_not_found" };
}

// ─── Payment: אימות קוד ──────────────────────────────────────────────────────
function validatePaymentCode(code) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("הזמנות");
  if (!sheet) return { success: false, error: "no_sheet" };

  var data = sheet.getDataRange().getValues();
  for (var r = data.length - 1; r >= 1; r--) {
    if (String(data[r][14]).trim() === String(code).trim()) {
      var rowNum = r + 1;

      // בדיקת brute-force: 5 ניסיונות מקסימום
      var attempts = Number(data[r][17]) || 0;
      if (attempts >= 5) {
        return { success: false, error: "locked" };
      }

      // בדיקת תוקף: 2 שעות
      var codeTime = new Date(data[r][15]);
      var now = new Date();
      if (now.getTime() - codeTime.getTime() > 2 * 60 * 60 * 1000) {
        return { success: false, error: "expired" };
      }

      // בדיקה אם כבר שולם
      if (String(data[r][16]).trim() === "paid") {
        return { success: false, error: "already_paid" };
      }

      return {
        success: true,
        order: {
          orderId: String(data[r][12]),
          customerName: String(data[r][2]),
          items: String(data[r][6]),
          totalPrice: data[r][7],
          discount: data[r][8],
          finalPrice: data[r][9],
          date: String(data[r][1]),
          pickupTime: String(data[r][13])
        }
      };
    }
  }

  // קוד לא נמצא — נרשום ניסיון כושל (אם יש orderId תואם בפרמטר)
  return { success: false, error: "invalid_code" };
}

// ─── Payment: רישום ניסיון כושל ───────────────────────────────────────────────
function recordFailedAttempt(code) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("הזמנות");
  if (!sheet) return;

  var data = sheet.getDataRange().getValues();
  for (var r = data.length - 1; r >= 1; r--) {
    if (String(data[r][14]).trim() === String(code).trim()) {
      var attempts = (Number(data[r][17]) || 0) + 1;
      sheet.getRange(r + 1, 18).setValue(attempts);
      return;
    }
  }
}

// ─── Survey: שמירת משוב ──────────────────────────────────────────────────────
function saveFeedback(feedbackData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("feedback");
  if (!sheet) {
    sheet = ss.insertSheet("feedback");
    sheet.appendRow(["timestamp", "orderId", "customerName", "overall", "food", "service", "comment"]);
  }
  sheet.appendRow([
    new Date(),
    feedbackData.orderId || "",
    feedbackData.customerName || "",
    feedbackData.overall || 0,
    feedbackData.food || 0,
    feedbackData.service || 0,
    feedbackData.comment || ""
  ]);
  return { success: true };
}

// ─── Google Drive: תיקיות חודשיות ושמירת PDF ─────────────────────────────────

/**
 * מחפשת או יוצרת את תיקיית האב "מאפית השומרון" בדרייב.
 * שומרת את ה-ID ב-Script Properties למציאה מהירה.
 */
function getOrCreateRootFolder() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty("DRIVE_ROOT_FOLDER_ID");
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) { /* folder deleted, recreate */ }
  }
  var folders = DriveApp.getFoldersByName("מאפית השומרון");
  if (folders.hasNext()) {
    var folder = folders.next();
    props.setProperty("DRIVE_ROOT_FOLDER_ID", folder.getId());
    return folder;
  }
  var folder = DriveApp.createFolder("מאפית השומרון");
  props.setProperty("DRIVE_ROOT_FOLDER_ID", folder.getId());
  return folder;
}

/**
 * מחפשת או יוצרת תיקיית חודש (לדוגמה "4.26") בתוך תיקיית האב.
 */
function getOrCreateMonthFolder(parentFolder, monthYear) {
  var subs = parentFolder.getFoldersByName(monthYear);
  if (subs.hasNext()) return subs.next();
  return parentFolder.createFolder(monthYear);
}

/**
 * הרצה חד-פעמית מהעורך — יוצרת 12 תיקיות חודשיות (4.26 עד 3.27).
 */
function setupMonthlyFolders() {
  var root = getOrCreateRootFolder();
  var months = [
    "4.26", "5.26", "6.26", "7.26", "8.26", "9.26",
    "10.26", "11.26", "12.26", "1.27", "2.27", "3.27"
  ];
  for (var i = 0; i < months.length; i++) {
    getOrCreateMonthFolder(root, months[i]);
  }
  Logger.log("נוצרו 12 תיקיות חודשיות בהצלחה");
}

/**
 * שומרת PDF בתיקיית החודש המתאימה בדרייב.
 * @param {string} pdfBase64 - קובץ PDF מקודד ב-base64
 * @param {string} filename - שם הקובץ
 * @param {string} orderDate - תאריך ההזמנה בפורמט dd.mm.yyyy או yyyy-mm-dd
 */
function savePdfToDrive(pdfBase64, filename, orderDate) {
  var month, year;
  if (orderDate && orderDate.includes(".")) {
    // פורמט dd.mm.yyyy
    var parts = orderDate.split(".");
    month = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10) % 100; // 2026 → 26
  } else if (orderDate && orderDate.includes("-")) {
    // פורמט yyyy-mm-dd
    var parts = orderDate.split("-");
    month = parseInt(parts[1], 10);
    year = parseInt(parts[0], 10) % 100;
  } else {
    // ברירת מחדל — החודש הנוכחי
    var now = new Date();
    month = now.getMonth() + 1;
    year = now.getFullYear() % 100;
  }
  var monthYear = month + "." + year;

  var root = getOrCreateRootFolder();
  var monthFolder = getOrCreateMonthFolder(root, monthYear);

  var pdfBlob = Utilities.newBlob(Utilities.base64Decode(pdfBase64), "application/pdf", filename);
  monthFolder.createFile(pdfBlob);
}

// ─── העתקה לגליון הזמנות מעודכן ──────────────────────────────────────────────
function copyToRollingOrders(rowData) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("הזמנות מעודכן");
    if (!sheet) {
      sheet = ss.insertSheet("הזמנות מעודכן");
      sheet.appendRow([
        "חותמת זמן קבלה", "תאריך הזמנה", "שם לקוח", "טלפון",
        "סוג אירוע", "מספר אורחים", "פריטים", 'סה"כ לפני הנחה',
        "הנחה", "סכום סופי", "הערות", "אושר בתאריך", "מזהה הזמנה", "שעת איסוף"
      ]);
    }
    sheet.appendRow(rowData);
  } catch (e) {
    logError("copyToRollingOrders", e.toString());
  }
}

// ─── ניקוי הזמנות ישנות מגליון מעודכן ────────────────────────────────────────
function cleanOldOrders() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("הזמנות מעודכן");
    if (!sheet || sheet.getLastRow() < 2) return;

    var now = new Date();
    var currentMonth = now.getMonth();
    var currentYear = now.getFullYear();

    var data = sheet.getDataRange().getValues();
    var rowsToDelete = [];

    for (var r = data.length - 1; r >= 1; r--) {
      var dateStr = String(data[r][1]).trim();
      if (!dateStr) continue;

      var orderDate;
      if (dateStr.includes(".")) {
        var parts = dateStr.split(".");
        orderDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      } else if (dateStr.includes("/")) {
        var parts = dateStr.split("/");
        orderDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      } else if (dateStr.includes("-")) {
        orderDate = new Date(dateStr);
      } else {
        continue;
      }

      if (orderDate.getMonth() !== currentMonth || orderDate.getFullYear() !== currentYear) {
        rowsToDelete.push(r + 1);
      }
    }

    // Delete from bottom to top to preserve row indices
    for (var i = 0; i < rowsToDelete.length; i++) {
      sheet.deleteRow(rowsToDelete[i]);
    }

    Logger.log("cleanOldOrders: deleted " + rowsToDelete.length + " rows");
  } catch (e) {
    logError("cleanOldOrders", e.toString());
  }
}

// ─── מפת מצרכים למוצרים ──────────────────────────────────────────────────────

var INGREDIENT_MAP = {
  "פלטת ירקות טריים": {
    "מלפפון": { qty: 5, unit: "יח'" },
    "גזר": { qty: 5, unit: "יח'" },
    "פלפל אדום": { qty: 4, unit: "יח'" },
    "פלפל צהוב": { qty: 4, unit: "יח'" },
    "פטריות": { qty: 5, unit: "מנות" },
    "שרי": { qty: 1, unit: "קופסא" },
    "זיתים": { qty: 1, unit: "קופסא" },
    "מטבל": { qty: 1, unit: "קופסא" }
  },
  "סלט קינואה": {
    "קינואה": { qty: 0.5, unit: "קופסא" },
    "עדשים": { qty: 0.5, unit: "קופסא" },
    "בטטה": { qty: 4, unit: "יח'" },
    "שרי": { qty: 0.4, unit: "קופסא" },
    "מלפפון": { qty: 6, unit: "יח'" },
    "פטריות": { qty: 8, unit: "יח'" },
    "חמוציות": { qty: 1, unit: "מנה" }
  },
  "סלט שוק": {
    "חסה": { qty: 2, unit: "יח'" },
    "שרי": { qty: 0.5, unit: "קופסא" },
    "מלפפון": { qty: 4, unit: "יח'" },
    "פלפלים": { qty: 3, unit: "יח'" },
    "בצל סגול": { qty: 2, unit: "יח'" },
    "בולגרית": { qty: 1, unit: "מנה" },
    "קלמטה": { qty: 0.5, unit: "קופסא" }
  },
  "סלט קיסר": {
    "חסה": { qty: 3, unit: "יח'" },
    "בצל סגול": { qty: 2, unit: "יח'" },
    "קרוטונים": { qty: 1, unit: "מנה" },
    "פרמזן": { qty: 1, unit: "מנה" },
    "ביצה קשה": { qty: 6, unit: "יח'" },
    "רוטב קיסר": { qty: 1, unit: "מנה" }
  },
  "סלט הבית": {
    "כרוב": { qty: 1, unit: "יח'" },
    "שרי": { qty: 0.5, unit: "קופסא" },
    "מלפפון": { qty: 4, unit: "יח'" },
    "גזר": { qty: 3, unit: "יח'" },
    "פלפלים": { qty: 3, unit: "יח'" },
    "גרעיני גלעג": { qty: 1, unit: "מנה" }
  },
  "סלט פסטה": {
    "פסטה": { qty: 0.5, unit: "ק\"ג" },
    "שרי": { qty: 0.5, unit: "קופסא" },
    "פלפלים": { qty: 3, unit: "יח'" },
    "בצל סגול": { qty: 2, unit: "יח'" },
    "פטריות": { qty: 6, unit: "יח'" },
    "קלמטה": { qty: 0.5, unit: "קופסא" },
    "עגבניות מיובשות": { qty: 1, unit: "מנה" }
  },
  "סלט סביח": {
    "מלפפון": { qty: 4, unit: "יח'" },
    "שרי": { qty: 0.5, unit: "קופסא" },
    "גמבה צהובה": { qty: 3, unit: "יח'" },
    "חצילים": { qty: 4, unit: "יח'" },
    "חומוס": { qty: 1, unit: "קופסא" },
    "ביצה קשה": { qty: 6, unit: "יח'" },
    "פטרוזיליה": { qty: 1, unit: "צרור" },
    "טחינה": { qty: 1, unit: "מנה" }
  },
  "כריכוני ביס": {
    "לחם": { qty: 12, unit: "יח'" },
    "ביצים": { qty: 8, unit: "יח'" },
    "חסה": { qty: 1, unit: "יח'" },
    "מלפפון": { qty: 3, unit: "יח'" }
  },
  "כריכוני קרואסון חמאה": {
    "קרואסון": { qty: 12, unit: "יח'" },
    "גבינה צהובה": { qty: 6, unit: "פרוסות" },
    "מלפפון": { qty: 3, unit: "יח'" },
    "חסה": { qty: 1, unit: "יח'" }
  },
  "רול טורטיה": {
    "טורטיה": { qty: 16, unit: "יח'" },
    "חסה": { qty: 2, unit: "יח'" },
    "מלפפון": { qty: 4, unit: "יח'" }
  },
  "סושי טורטיה": {
    "טורטיה": { qty: 10, unit: "יח'" },
    "חסה": { qty: 2, unit: "יח'" },
    "מלפפון": { qty: 4, unit: "יח'" }
  },
  "בוריקיטס": {
    "בצק": { qty: 20, unit: "יח'" },
    "חסה": { qty: 1, unit: "יח'" },
    "גבינה צהובה": { qty: 10, unit: "פרוסות" },
    "מלפפון": { qty: 3, unit: "יח'" }
  },
  "בוריקיטס סביח": {
    "בצק": { qty: 20, unit: "יח'" },
    "חציל": { qty: 4, unit: "יח'" },
    "מלפפון חמוץ": { qty: 4, unit: "יח'" },
    "ביצה": { qty: 6, unit: "יח'" },
    "פטרוזיליה": { qty: 1, unit: "צרור" }
  },
  "מיני קיש": {
    "בצק": { qty: 24, unit: "יח'" },
    "ביצים": { qty: 8, unit: "יח'" },
    "שמנת": { qty: 1, unit: "מנה" },
    "פטריות": { qty: 6, unit: "יח'" },
    "בצל": { qty: 3, unit: "יח'" }
  },
  "פוקצ'ינות": {
    "בצק פוקצ'ה": { qty: 18, unit: "יח'" },
    "שמן זית": { qty: 1, unit: "מנה" },
    "פסטו": { qty: 1, unit: "מנה" }
  },
  "מיני פיצה מרגריטה": {
    "בצק פיצה": { qty: 18, unit: "יח'" },
    "רוטב עגבניות": { qty: 1, unit: "מנה" },
    "מוצרלה": { qty: 0.5, unit: "ק\"ג" }
  },
  "שקשוקה": {
    "ביצים": { qty: 8, unit: "יח'" },
    "עגבניות": { qty: 6, unit: "יח'" },
    "פלפל": { qty: 3, unit: "יח'" },
    "בצל": { qty: 2, unit: "יח'" }
  },
  "ביצים מקושקשות": {
    "ביצים": { qty: 12, unit: "יח'" },
    "חמאה": { qty: 1, unit: "מנה" },
    "בצל": { qty: 2, unit: "יח'" }
  },
  "פסטה": {
    "פסטה": { qty: 1, unit: "ק\"ג" },
    "שמנת": { qty: 1, unit: "מנה" },
    "פטריות": { qty: 6, unit: "יח'" }
  },
  "פריקסה": {
    "סולת": { qty: 1, unit: "ק\"ג" },
    "טונה": { qty: 2, unit: "קופסא" },
    "ביצים קשות": { qty: 6, unit: "יח'" },
    "זיתים": { qty: 1, unit: "קופסא" },
    "לימון כבוש": { qty: 2, unit: "יח'" }
  },
  "שיפודי מוצרלה": {
    "שרי": { qty: 1.5, unit: "קופסא" },
    "מוצרלה מיני": { qty: 24, unit: "יח'" },
    "בזיליקום": { qty: 1, unit: "צרור" }
  },
  "פלטת גבינות קשות": {
    "גבינות קשות": { qty: 1, unit: "מגש" }
  },
  "מגש מאפים טריים": {
    "מאפים מגוונים": { qty: 20, unit: "יח'" }
  },
  "פלטת פירות העונה": {
    "פירות עונה": { qty: 2.4, unit: "ק\"ג" }
  },
  "אנטיפסטי": {
    "חציל": { qty: 4, unit: "יח'" },
    "בטטה": { qty: 3, unit: "יח'" },
    "בצל סגול": { qty: 3, unit: "יח'" },
    "פלפל": { qty: 4, unit: "יח'" },
    "שרי": { qty: 1, unit: "קופסא" },
    "פטריות": { qty: 8, unit: "יח'" }
  },
  "מיני לחם שום": {
    "לחם": { qty: 24, unit: "יח'" },
    "שום": { qty: 6, unit: "שיני" },
    "חמאה": { qty: 1, unit: "מנה" }
  },
  "מגש פחזניות": {
    "בצק פחזניות": { qty: 24, unit: "יח'" },
    "קרם וניל": { qty: 1, unit: "מנה" }
  },
  "מגש מתוקים": {
    "קינוחים מגוונים": { qty: 50, unit: "יח'" }
  },
  "מגש כדורי שוקולד": {
    "שוקולד": { qty: 0.5, unit: "ק\"ג" },
    "ציפוי": { qty: 1, unit: "מנה" }
  },
  "עוגות בחושות": {
    "קמח": { qty: 0.5, unit: "ק\"ג" },
    "ביצים": { qty: 6, unit: "יח'" },
    "סוכר": { qty: 1, unit: "מנה" }
  },
  "מגש קוקיז חמאה": {
    "חמאה": { qty: 0.5, unit: "ק\"ג" },
    "קמח": { qty: 0.5, unit: "ק\"ג" },
    "שוקולד צ'יפס": { qty: 1, unit: "מנה" }
  },
  "מגש מיני ג'חנון": {
    "בצק ג'חנון": { qty: 30, unit: "יח'" },
    "רסק עגבניות": { qty: 1, unit: "קופסא" },
    "ביצים קשות": { qty: 6, unit: "יח'" }
  }
};

// Product name to INGREDIENT_MAP key mapping
var PRODUCT_NAMES = {
  1: "שיפודי מוצרלה", 2: "פלטת גבינות קשות", 3: "מגש מאפים טריים",
  4: "פוקצ'ינות", 5: "כריכוני ביס", 6: "מגש פחזניות",
  7: "פלטת פירות העונה", 8: "רול טורטיה", 9: "מגש מתוקים",
  10: "מיני פיצה מרגריטה", 11: "בוריקיטס", 12: "מיני קיש",
  13: "כריכוני קרואסון חמאה", 14: "סושי טורטיה", 15: "אנטיפסטי",
  16: "מגש מיני ג'חנון", 17: "בוריקיטס סביח", 18: "פריקסה",
  19: "שקשוקה", 20: "פסטה", 21: "סלטים טריים",
  22: "מגש כדורי שוקולד", 23: "פלטת ירקות טריים", 24: "מיני לחם שום",
  25: "עוגות בחושות", 26: "מגש קוקיז חמאה", 27: "ביצים מקושקשות",
  28: "סלט שוק", 29: "סלט קיסר", 30: "סלט קינואה",
  31: "סלט הבית", 32: "סלט פסטה", 33: "סלט סביח"
};

// ─── עדכון גליון כמויות ──────────────────────────────────────────────────────
function updateQuantitiesSheet(orderData) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("כמויות");
    if (!sheet) {
      sheet = ss.insertSheet("כמויות");
      sheet.appendRow(["מצרך", "כמות נדרשת", "יחידה", "הזמנות", "תאריכים", "סטטוס"]);
    }

    // Parse items from order (format: "מוצר x2, מוצר2 x1")
    var itemsStr = orderData.items || "";
    var orderId = orderData.orderId || "";
    var orderDate = orderData.orderDate || "";

    // Aggregate ingredients
    var ingredients = {};

    // Try to parse items - could be "name x qty" or "name × qty"
    var itemParts = itemsStr.split(/[,،]/);
    for (var i = 0; i < itemParts.length; i++) {
      var part = itemParts[i].trim();
      if (!part) continue;

      var match = part.match(/(.+?)\s*[x×]\s*(\d+)/i);
      var productName = match ? match[1].trim() : part.trim();
      var qty = match ? parseInt(match[2]) : 1;

      // Find product in INGREDIENT_MAP
      var mapKey = null;
      for (var key in INGREDIENT_MAP) {
        if (productName.indexOf(key) !== -1 || key.indexOf(productName) !== -1) {
          mapKey = key;
          break;
        }
      }

      if (mapKey && INGREDIENT_MAP[mapKey]) {
        var recipe = INGREDIENT_MAP[mapKey];
        for (var ing in recipe) {
          if (!ingredients[ing]) {
            ingredients[ing] = { qty: 0, unit: recipe[ing].unit };
          }
          ingredients[ing].qty += recipe[ing].qty * qty;
        }
      }
    }

    // Write to sheet
    var existingData = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues() : [];

    for (var ingName in ingredients) {
      var found = false;
      for (var r = 0; r < existingData.length; r++) {
        if (String(existingData[r][0]).trim() === ingName) {
          // Update existing row
          var rowNum = r + 2;
          var existingQty = Number(existingData[r][1]) || 0;
          var existingOrders = String(existingData[r][3] || "");
          var existingDates = String(existingData[r][4] || "");

          sheet.getRange(rowNum, 2).setValue(existingQty + ingredients[ingName].qty);
          sheet.getRange(rowNum, 4).setValue(existingOrders + (existingOrders ? ", " : "") + orderId);
          sheet.getRange(rowNum, 5).setValue(existingDates + (existingDates ? ", " : "") + orderDate);
          sheet.getRange(rowNum, 6).setValue("פעיל");
          found = true;
          break;
        }
      }
      if (!found) {
        sheet.appendRow([ingName, ingredients[ingName].qty, ingredients[ingName].unit, orderId, orderDate, "פעיל"]);
      }
    }
  } catch (e) {
    logError("updateQuantitiesSheet", e.toString());
  }
}

// ─── ניקוי כמויות שפג תוקפן ─────────────────────────────────────────────────
function cleanExpiredQuantities() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("כמויות");
    if (!sheet || sheet.getLastRow() < 2) return;

    var today = new Date();
    var fmtD = function(d) { return Utilities.formatDate(d, "Asia/Jerusalem", "dd/MM/yyyy"); };
    var todayStr = fmtD(today);

    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
    var rowsToDelete = [];

    for (var r = data.length - 1; r >= 0; r--) {
      var dates = String(data[r][4] || "").split(",");
      var allExpired = true;
      for (var d = 0; d < dates.length; d++) {
        var dateStr = dates[d].trim();
        if (!dateStr) continue;
        // Parse date
        var orderDate;
        if (dateStr.includes(".")) {
          var parts = dateStr.split(".");
          orderDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        } else if (dateStr.includes("/")) {
          var parts = dateStr.split("/");
          orderDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        } else {
          allExpired = false;
          continue;
        }
        if (orderDate >= today) {
          allExpired = false;
          break;
        }
      }
      if (allExpired && dates.some(function(d) { return d.trim().length > 0; })) {
        rowsToDelete.push(r + 2);
      }
    }

    for (var i = 0; i < rowsToDelete.length; i++) {
      sheet.deleteRow(rowsToDelete[i]);
    }
  } catch (e) {
    logError("cleanExpiredQuantities", e.toString());
  }
}

// ─── הקמת כל הגליונות ────────────────────────────────────────────────────────
function setupAllSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // הזמנות
  if (!ss.getSheetByName("הזמנות")) {
    var s = ss.insertSheet("הזמנות");
    s.appendRow(["חותמת זמן קבלה", "תאריך הזמנה", "שם לקוח", "טלפון", "סוג אירוע", "מספר אורחים", "פריטים", 'סה"כ לפני הנחה', "הנחה", "סכום סופי", "הערות", "אושר בתאריך", "מזהה הזמנה", "שעת איסוף", "קוד תשלום", "זמן יצירת קוד", "סטטוס תשלום", "ניסיונות כושלים"]);
  }

  // סיכום
  if (!ss.getSheetByName("סיכום")) {
    var s = ss.insertSheet("סיכום");
    s.appendRow(["שם לקוח", "סכום הזמנה"]);
  }

  // כמויות
  if (!ss.getSheetByName("כמויות")) {
    var s = ss.insertSheet("כמויות");
    s.appendRow(["מצרך", "כמות נדרשת", "יחידה", "הזמנות", "תאריכים", "סטטוס"]);
  }

  // הזמנות מעודכן
  if (!ss.getSheetByName("הזמנות מעודכן")) {
    var s = ss.insertSheet("הזמנות מעודכן");
    s.appendRow(["חותמת זמן קבלה", "תאריך הזמנה", "שם לקוח", "טלפון", "סוג אירוע", "מספר אורחים", "פריטים", 'סה"כ לפני הנחה', "הנחה", "סכום סופי", "הערות", "אושר בתאריך", "מזהה הזמנה", "שעת איסוף"]);
  }

  Logger.log("setupAllSheets: all 4 sheets verified/created");
}

// ─── טריגר חודשי לניקוי הזמנות ישנות ─────────────────────────────────────────
function setupMonthlyCleanup() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "cleanOldOrders") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("cleanOldOrders")
    .timeBased()
    .onMonthDay(1)
    .atHour(3)
    .inTimezone("Asia/Jerusalem")
    .create();
}

// ─── עזר ─────────────────────────────────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
