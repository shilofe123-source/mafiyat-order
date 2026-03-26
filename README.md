# מאפיית השומרון — מערכת הזמנות מגשי אירוח

טופס הזמנה אונליין עם צ'אט AI מוטמע, שליחת PDF אוטומטית בוואטסאפ, דף תשלום, וסקר משוב.

## עיצוב ותכונות

- **עיצוב**: פלטת צבעים חמה (חום/זהוב/קרם), רקע משתנה עם תמונות מוצרים (slideshow כל 8 שניות)
- **תהליך הזמנה**: בחירת מוצרים > אישור > שמירה בגיליון > שליחת PDF אוטומטית בוואטסאפ לאורי ובת חן > שמירת PDF בתיקיית החודש בדרייב
- **כשרות**: מהדרין רבנות קרני שומרון
- **צ'אט AI**: ייעוץ אוטומטי ללקוחות — המלצות לפי סוג אירוע, עונה, כמות אורחים. הסוכן יכול למלא פרטי לקוח, להוסיף/להסיר מוצרים, ולקבל תמונות ו-PDF של הזמנות
- **הצעת מחיר (PDF)**: כוללת עמודות תמונה, מוצר, כמות, מחיר וסה"כ — עם תמונת מוצר מוקטנת ליד כל פריט
- **מצב עורך**: הגדרת הנחות, חילוץ הזמנה מתמונה/PDF, יצירת קוד תשלום חד-פעמי (PIN: S199)
- **תשלום**: דף תשלום נפרד עם קוד 6 ספרות (תוקף 2 שעות, הגנת brute-force)
- **משוב**: סקר שביעות רצון אוטומטי נשלח ללקוח יום אחרי ההזמנה
- **תזכורות**: תזכורת אוטומטית לבת חן יום לפני מועד ההזמנה (12:00)

## קבצים

| קובץ / תיקייה | תיאור |
|---|---|
| `index.html` | האפליקציה המלאה — React + HTM, אפס תלויות שרת |
| `Code.gs` | Google Apps Script — שמירת הזמנות בגיליון + חילוץ הזמנות מתמונות/PDF עם Gemini |
| `payment.html` | דף תשלום — הזנת קוד 6 ספרות, הצגת פרטי הזמנה |
| `survey.html` | דף משוב — דירוג כוכבים (חוויה/אוכל/שירות) + הערה חופשית |
| `workers/mafiyat-chat.js` | Cloudflare Worker לצ'אט AI (Claude Sonnet 4.6), תומך בתמונות ו-PDF |
| `workers/mafiyat-webhook.js` | Cloudflare Worker לוואטסאפ Webhook — מקבל הודעות ומעביר ל-mafiyat-chat |
| `images/` | 27 תמונות מוצרים דחוסות (800px, ~60-115KB) לרקע המשתנה |

## אינטגרציות

- **Google Sheets** — שמירת הזמנות אוטומטית + גיליון "סיכום" + גיליון "feedback" + גיליון "errors"
- **Google Drive** — שמירת PDF הזמנות אוטומטית בתיקיות חודשיות (לדוגמה: `מאפית השומרון/4.26/`). הרצת `setupMonthlyFolders()` פעם אחת מהעורך יוצרת 12 תיקיות (4.26–3.27)
- **WhatsApp Business API** — שליחת PDF הזמנה אוטומטית, תזכורות יומיות, סקר משוב. שליחה דרך Meta Cloud API (upload media + send document)
- **Gemini 2.5 Flash** — חילוץ הזמנות מתמונות ו-PDF (דרך Apps Script)
- **Cloudflare Workers** — צ'אט ייעוץ חכם (Claude Sonnet 4.6) + Webhook לוואטסאפ, עם fallback מקומי אם ה-API לא זמין

## עדכון מוצרים ומחירים

ב-`index.html` יש שני מערכי `PRODUCTS`:

1. **מערך ראשי** (שורה ~149) — משמש את טופס ההזמנה:
   ```js
   { id: 1, name: "מגש כריכוני ביס", price: 180, qty_desc: "12 יח'", cat: "מגשי אירוח" }
   ```
   - `id` — מזהה ייחודי
   - `name` — שם המוצר
   - `price` — מחיר בשקלים
   - `qty_desc` — תיאור כמות למגש
   - `cat` — קטגוריה (מגשי אירוח / מאפים חמים / מנות חמות / פלטות / סלטים / פירות וקינוחים)

2. **מערך צ'אט** (שורה ~811) — משמש את ה-AI לייעוץ, כולל שדות `id`, `tags` ו-`category`

בעת עדכון מוצר/מחיר — יש לעדכן **בשני** המערכים. ה-`id` חייב להיות זהה בשניהם.

## ארכיטקטורה — גשר React ↔ Vanilla JS

הצ'אט (vanilla JS) מתקשר עם React דרך פונקציות גלובליות:
- `window.__addItemsFromChat(items)` — מוסיף מוצרים לעגלה (merge)
- `window.__removeItemsFromChat(ids)` — מסיר מוצרים לפי id
- `window.__setItemsFromChat(items)` — מחליף את כל העגלה
- `window.__fillClientFromChat(data)` — מעדכן פרטי לקוח ישירות ב-React state
- `fillForm(data)` — מנתב ל-fill/remove/replace לפי השדות ב-data

### מנגנון מילוי אוטומטי (AI → טופס)
1. כשה-checkbox "אפשר לסוכן למלא" מסומן, ה-system prompt מורה ל-AI להחזיר JSON עם `{"fill": {...}}`
2. פורמטים: `items` (הוספה), `removeItems` (הסרה), `replaceItems` (החלפת כל העגלה)
3. חילוץ ה-JSON מתבצע ב-**bracket-counting parser** (`extractFillJson`) — עמיד בפני pretty-printing, רווחים, וקינון עמוק
4. אם הפרסור נכשל — JSON מוסר מהתצוגה (הלקוח לעולם לא רואה JSON גולמי)
5. שדות לקוח שלא ידועים ל-AI פשוט לא נכללים ב-JSON (לא נדרסים)

### חילוץ הזמנות מתמונות/PDF
- במצב עורך, ניתן להעלות תמונה או PDF → Gemini 2.5 Flash מחלץ מוצרים ופרטי לקוח
- מגבלת גודל קובץ: 4MB
- `Code.gs` מחזיר **debug info** בכל כשל (HTTP error, safety block, parse error) — מוצג בפרונטנד

## הפעלה

1. העלה את הקבצים ל-GitHub
2. Cloudflare Pages מפרסם אוטומטית מה-branch `main`

## הגדרת Cloudflare Workers

### Worker 1: mafiyat-chat
1. Cloudflare Dashboard → Workers & Pages → Create Worker
2. שם: `mafiyat-chat`
3. העתק את `workers/mafiyat-chat.js`
4. Settings → Variables → Add secret: `ANTHROPIC_API_KEY`
5. שמור את ה-URL (`https://mafiyat-chat.SUBDOMAIN.workers.dev`)

### Worker 2: mafiyat-webhook
1. צור Worker נוסף בשם `mafiyat-webhook`
2. העתק את `workers/mafiyat-webhook.js`
3. Settings → Variables → Add secrets:
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID` (ערך: `964695536736534`)
   - `BAKERY_CHAT_URL` (ה-URL של Worker 1)

### עדכון index.html
בשורה ~799 — החלף `mafiyat-chat.SUBDOMAIN.workers.dev` ב-URL האמיתי של Worker 1.

### עדכון Meta Developers
Meta Developers → WhatsApp → Webhooks → ערוך URL → הכנס כתובת Worker 2.
Verify Token: `mafiyat_hashomron_2026`
