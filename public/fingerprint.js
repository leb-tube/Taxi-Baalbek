// ═══════════════════════════════════════
// 🔍 بصمة الجهاز (Device Fingerprint)
// ═══════════════════════════════════════
async function getDeviceFingerprint() {
  // 1. حاول من localStorage أولاً
  let stored = localStorage.getItem("device_fingerprint");
  if (stored) return stored;
  
  // 2. أنشئ بصمة جديدة
  const components = [
    navigator.userAgent,
    navigator.language,
    screen.width + "x" + screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
    navigator.platform || "unknown",
  ];
  
  // 3. أضف بيانات Canvas (فريدة لكل جهاز)
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillText("TaxiApp-Fingerprint", 2, 2);
    components.push(canvas.toDataURL().slice(-50));
  } catch (e) {}
  
  // 4. أضف WebGL
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    if (debugInfo) {
      components.push(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
    }
  } catch (e) {}
  
  // 5. ادمج كل شيء في hash
  const raw = components.join("|");
  const hash = await hashString(raw);
  
  // 6. احفظ في localStorage
  localStorage.setItem("device_fingerprint", hash);
  
  return hash;
}

// ═══ دالة hash بسيطة (SHA-256) ═══
async function hashString(str) {
  const buffer = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ═══ تصدير للاستخدام العام ═══
window.getDeviceFingerprint = getDeviceFingerprint;