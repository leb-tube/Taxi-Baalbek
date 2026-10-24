const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const BlockedDevice = require("../models/BlockedDevice");

// ═══ التسجيل ═══
router.post("/register", async (req, res) => {
  try {
    const { name, phone, password, role, carModel, carPlate, deviceId } = req.body;
    
    if (!name || !phone || !password || !role) {
      return res.status(400).json({ error: "جميع الحقول مطلوبة" });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
    }
    
    // ⚠️ تحقق من الحظر (جهاز أو رقم)
    const blocked = await BlockedDevice.findOne({ 
      $or: [
        { phone: phone }, 
        { deviceId: deviceId || "none" }, 
        { deviceId: "phone_" + phone }
      ] 
    });
    if (blocked) {
      return res.status(403).json({ 
        error: "🚫 هذا الحساب أو الجهاز محظور من التسجيل",
        blocked: true 
      });
    }
    
    const exists = await User.findOne({ phone });
    if (exists) {
      return res.status(400).json({ error: "رقم الهاتف مستخدم بالفعل" });
    }
    
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ 
      name, phone, password: hash, role, 
      carModel: carModel || "", 
      carPlate: carPlate || "",
      deviceId: deviceId || ""
    });
    
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "30d" });
    
    res.json({ 
      token, 
      user: { id: user._id, name: user.name, phone: user.phone, role: user.role, carModel: user.carModel, carPlate: user.carPlate } 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══ تسجيل الدخول ═══
router.post("/login", async (req, res) => {
  try {
    const { phone, password, deviceId } = req.body;
    
    if (!phone || !password) {
      return res.status(400).json({ error: "رقم الهاتف وكلمة المرور مطلوبان" });
    }
    
    // ⚠️ تحقق من الحظر (جهاز أو رقم)
    const blocked = await BlockedDevice.findOne({ 
      $or: [
        { phone: phone }, 
        { deviceId: deviceId || "none" }, 
        { deviceId: "phone_" + phone }
      ] 
    });
    if (blocked) {
      return res.status(403).json({ 
        error: "🚫 هذا الحساب أو الجهاز محظور من الدخول",
        blocked: true 
      });
    }
    
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(400).json({ error: "رقم الهاتف غير مسجل" });
    }
    
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(400).json({ error: "كلمة المرور خاطئة" });
    }
    
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "30d" });
    
    res.json({ 
      token, 
      user: { id: user._id, name: user.name, phone: user.phone, role: user.role, carModel: user.carModel, carPlate: user.carPlate } 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;