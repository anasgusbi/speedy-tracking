# سبيدي — منصة تتبع المندوبين

منصة المدير والمشرف (كمبيوتر وهاتف) لمتابعة مندوبي سبيدي عبر **تطبيق المندوب**:
خريطة مباشرة، مسار كل مندوب في أي يوم، سجل الفترات، وإدارة المندوبين وحساباتهم في التطبيق.
مشروع Firebase مستقل: **speedy-driver** (منفصل عن منصة الحضور).

## الملفات
| الملف | الوظيفة |
|---|---|
| `index.html` | الواجهة |
| `js/app.js` | منطق المنصة |
| `js/firebase-config.js` | بيانات مشروع Firebase ورابط Realtime Database |
| `firestore.rules` | قواعد Firestore (تُلصق في Firebase Console) |
| `database.rules.json` | قواعد Realtime Database (تُلصق في Firebase Console) |
| `manifest.webmanifest`، `sw.js`، `icons/` | التثبيت كتطبيق على الهاتف |

## الإعداد
1. Firebase Console ← **Firestore ← Rules**: الصق `firestore.rules` ← **Publish**.
2. **Realtime Database ← Rules**: الصق `database.rules.json` ← **Publish**.
3. GitHub: مستودع `speedy-tracking` (Public) ← ارفع كل الملفات ← **Settings ← Pages ← main / root**.
4. **Authentication ← Settings ← Authorized domains** ← أضف `anasgusbi.github.io`.
5. افتح المنصة: https://anasgusbi.github.io/speedy-tracking/ وسجّل الدخول.
6. **الإعدادات**: مواعيد الفترات + موقع المكتب. ثم افتح **التتبع المباشر** مرة واحدة كمدير.
7. **المندوبين**: أضف المندوبين (أو استوردهم من نسخة احتياطية لمنصة الحضور) ← **إنشاء حساب** لكل مندوب ← أرسل له البيانات.

## الصلاحيات
- **صاحب المنصة** (`ownerEmail` في `js/firebase-config.js`): مدير دائماً.
- **المدير**: كل شيء، بما فيه حسابات التطبيق والإعدادات والمستخدمين.
- **المشرف**: الخريطة والمسارات وسجل الفترات وإضافة المندوبين.
يُضاف المستخدمون من **الإعدادات ← المستخدمون والصلاحيات**.

## البيانات
- Firestore: `drivers` (المندوبون)، `days/{التاريخ}` (الفترات)، `driverAccounts` (ربط حساب التطبيق بالمندوب)، `config/settings` و`config/roles`.
- Realtime Database: `live` (آخر موقع)، `tracks/{مندوب}/{يوم}` (المسار)، تُحذف المسارات الأقدم من 60 يوماً تلقائياً.
