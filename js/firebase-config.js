// بيانات مشروع Firebase المستقل: speedy-driver
// (Firebase Console ← إعدادات المشروع ← Your apps ← Web app ← firebaseConfig)
// هذه البيانات ليست سرية؛ الحماية تتم عبر قواعد Firestore وRealtime Database.

export const firebaseConfig = {
  apiKey: "AIzaSyAlQw2kZP9RJfMcnfKEL0ixJYDEkB1M60k",
  authDomain: "speedy-driver-b622a.firebaseapp.com",
  projectId: "speedy-driver-b622a",
  storageBucket: "speedy-driver-b622a.firebasestorage.app",
  messagingSenderId: "217329748404",
  appId: "1:217329748404:web:04ef904c8dbf52dcb10ae1",
  // رابط Realtime Database (أعلى تبويب Data في Firebase Console)
  databaseURL: "https://speedy-driver-b622a-default-rtdb.europe-west1.firebasedatabase.app"
};

// صاحب المنصة: مدير دائماً ولا يمكن إزالة صلاحيته (يجب أن يطابق البريد في القواعد)
export const ownerEmail = "anasgusbi016@gmail.com";

// نطاق حسابات المندوبين في تطبيق الهاتف (يجب أن يطابق driverDomain في تطبيق المندوب)
export const driverDomain = "drivers.speedy.com.ly";

// رابط تحميل تطبيق المندوب (يُرسل للمندوب مع بيانات الدخول)
export const driverApkUrl = "https://github.com/anasgusbi/speedy-driver/releases/latest/download/speedy-driver.apk";
