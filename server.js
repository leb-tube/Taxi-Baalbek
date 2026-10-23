// ═══════════════════════════════════════════════════════════
// 🚕 Taxi Baalbek - Server
// ═══════════════════════════════════════════════════════════
require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const path = require("path");

const authRoutes = require("./routes/auth");
const rideRoutes = require("./routes/rides");
const Ride = require("./models/Ride");
const User = require("./models/User");

// ═══ App Setup ═══
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.set("io", io);

// ═══════════════════════════════════════════════════════════
// 🗺️ POI Cache (in-memory)
// ═══════════════════════════════════════════════════════════
const poiCache = new Map();
const POI_CACHE_TTL = 30 * 60 * 1000; // 30 دقيقة
const POI_CACHE_MAX_SIZE = 500;

// ═══════════════════════════════════════════════════════════
// 🔐 Admin Routes
// ═══════════════════════════════════════════════════════════
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin2026";

function checkAdmin(req, res, next) {
  const password = req.headers["x-admin-password"] || req.query.password;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "غير مصرح" });
  }
  next();
}
// ═══════════════════════════════════════
// 🚫 إدارة الحظر
// ═══════════════════════════════════════
const BlockedDevice = require("./models/BlockedDevice");

// ═══ قائمة المحظورين ═══
app.get("/api/admin/blocked-devices", checkAdmin, async (req, res) => {
  try {
    const blocked = await BlockedDevice.find({}).sort({ blockedAt: -1 });
    res.json(blocked);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══ حظر جهاز ═══
app.post("/api/admin/block-device", checkAdmin, async (req, res) => {
  try {
    const { deviceId, phone, reason, blockedBy } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({ error: "deviceId مطلوب" });
    }
    
    // تحقق إذا محظور سابقاً
    const exists = await BlockedDevice.findOne({ deviceId });
    if (exists) {
      return res.json({ success: true, message: "محظور بالفعل", data: exists });
    }
    
    const blocked = await BlockedDevice.create({
      deviceId,
      phone: phone || "",
      reason: reason || "حظر إداري",
      blockedBy: blockedBy || "admin"
    });
    
    console.log(`🚫 حظر جهاز: ${deviceId.substring(0, 16)}... — ${reason}`);
    
    res.json({ success: true, message: "تم الحظر", data: blocked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══ فك الحظر ═══
app.delete("/api/admin/block-device/:deviceId", checkAdmin, async (req, res) => {
  try {
    await BlockedDevice.deleteOne({ deviceId: req.params.deviceId });
    console.log(`✅ فك حظر جهاز: ${req.params.deviceId.substring(0, 16)}...`);
    res.json({ success: true, message: "تم فك الحظر" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══ التحقق من الحظر (يستخدمه العميل عند التسجيل) ═══
app.post("/api/check-block", async (req, res) => {
  try {
    const { deviceId, phone } = req.body;
    
    if (deviceId) {
      const blocked = await BlockedDevice.findOne({ deviceId });
      if (blocked) {
        return res.json({ 
          blocked: true, 
          reason: blocked.reason || "هذا الجهاز محظور" 
        });
      }
    }
    
    res.json({ blocked: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ═══ إحصائيات ═══
app.get("/api/admin/stats", checkAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const customers = await User.countDocuments({ role: "customer" });
    const drivers = await User.countDocuments({ role: "driver" });
    const totalRides = await Ride.countDocuments();
    const activeRides = await Ride.countDocuments({ status: "accepted" });
    const completedRides = await Ride.countDocuments({ status: "completed" });
    
    // السائقين المتصلين حالياً
    const onlineDriversCount = onlineDrivers.size;
    
    res.json({
      totalUsers: totalUsers,
      customers: customers,
      drivers: drivers,
      totalRides: totalRides,
      activeRides: activeRides,
      completedRides: completedRides,
      onlineDrivers: onlineDriversCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══ قائمة المستخدمين ═══
app.get("/api/admin/users", checkAdmin, async (req, res) => {
  try {
    const users = await User.find({})
      .select("-password")
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══ حذف مستخدم ═══
app.delete("/api/admin/users/:id", checkAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    
    // احذف المستخدم
    await User.findByIdAndDelete(userId);
    
    // احذف رحلاته
    await Ride.deleteMany({ customer: userId });
    await Ride.deleteMany({ driver: userId });
    
    console.log(`🗑️ حذف مستخدم: ${userId}`);
    
    res.json({ success: true, message: "تم حذف المستخدم" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══ قائمة السائقين المتصلين ═══
app.get("/api/admin/online-drivers", checkAdmin, async (req, res) => {
  try {
    const list = [];
    for (const [driverId, info] of onlineDrivers.entries()) {
      list.push({
        id: driverId,
        name: info.name,
        carModel: info.carModel,
        carPlate: info.carPlate,
        lat: info.lat,
        lng: info.lng,
        busy: info.busy,
        lastUpdate: info.lastUpdate
      });
    }
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══ حذف كل البيانات (للاختبار) ═══
app.delete("/api/admin/reset", checkAdmin, async (req, res) => {
  try {
    await User.deleteMany({});
    await Ride.deleteMany({});
    console.log("🗑️ تم مسح كل البيانات");
    res.json({ success: true, message: "تم مسح كل البيانات" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ═══════════════════════════════════════════════════════════
// 🗺️ Geoapify Places API Proxy
// ═══════════════════════════════════════════════════════════
app.get("/api/pois", async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { south, west, north, east, zoom } = req.query;
    
    if (!south || !west || !north || !east) {
      return res.status(400).json({ error: "Missing bounds" });
    }
    
   const GEOAPIFY_KEY = process.env.GEOAPIFY_KEY;
if (!GEOAPIFY_KEY) {
  console.error("❌ GEOAPIFY_KEY not configured in Environment!");
  return res.status(500).json({ error: "GEOAPIFY_KEY not configured" });
}
    
    // ═══ Cache Check ═══
    const cacheKey = `pois_${south}_${west}_${north}_${east}`;
    const cached = poiCache.get(cacheKey);
    
    if (cached && Date.now() - cached.time < POI_CACHE_TTL) {
      console.log("📦 POIs from server cache");
      return res.json(cached.data);
    }
    
    // ═══ عدد النتائج حسب Zoom ═══
    let limit = 50;
    if (zoom >= 16) limit = 100;
    if (zoom >= 17) limit = 200;
    
    // ═══ Geoapify Categories ═══
    const categories = [
      "catering.restaurant",
      "catering.cafe",
      "catering.fast_food",
      "healthcare.hospital",
      "healthcare.pharmacy",
      "service.vehicle.fuel",
      "service.financial.bank",
      "service.financial.atm",
      "service.police",
      "accommodation.hotel",
      "accommodation.hostel",
      "accommodation.guest_house"
    ].join(",");
    
    // ═══ Geoapify URL ═══
    const url = "https://api.geoapify.com/v2/places?" +
      "categories=" + encodeURIComponent(categories) +
      "&filter=rect:" + west + "," + south + "," + east + "," + north +
      "&limit=" + limit +
      "&apiKey=" + GEOAPIFY_KEY;
    
    console.log("📡 Geoapify request...");
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errText = await response.text();
      console.error("❌ Geoapify HTTP", response.status, errText.substring(0, 200));
      return res.status(500).json({ 
        error: "Geoapify returned " + response.status 
      });
    }
    
    const data = await response.json();
    
    if (!data.features) {
      console.log("⚠️ No features");
      return res.json({ elements: [] });
    }
    
    // ═══ تحويل Geoapify → Overpass format (للتوافق مع الكود القديم) ═══
    const elements = data.features.map(f => {
      const props = f.properties;
      const geom = f.geometry;
      
      // فك تشفير category
      let type = "📍";
      const cat = props.categories?.[0] || "";
      
      if (cat.includes("restaurant")) type = "restaurant";
      else if (cat.includes("cafe")) type = "cafe";
      else if (cat.includes("fast_food")) type = "fast_food";
      else if (cat.includes("hospital")) type = "hospital";
      else if (cat.includes("pharmacy")) type = "pharmacy";
      else if (cat.includes("fuel")) type = "fuel";
      else if (cat.includes("bank")) type = "bank";
      else if (cat.includes("police")) type = "police";
      else if (cat.includes("hotel")) type = "hotel";
      else if (cat.includes("hostel")) type = "hostel";
      else if (cat.includes("guest_house")) type = "guest_house";
      
      return {
        lat: geom.coordinates[1],
        lon: geom.coordinates[0],
        tags: {
          amenity: type,
          name: props.name || props.address_line1 || "بدون اسم",
          "addr:street": props.address_line2 || ""
        }
      };
    });
    
    const result = { elements: elements };
    
    // ═══ Cache ═══
    poiCache.set(cacheKey, { 
      data: result, 
      time: Date.now() 
    });
    
    // نظّف cache القديم
    if (poiCache.size > POI_CACHE_MAX_SIZE) {
      const oldestKeys = [...poiCache.keys()].slice(0, 100);
      oldestKeys.forEach(k => poiCache.delete(k));
    }
    
    const duration = Date.now() - startTime;
    console.log(`✅ Geoapify: ${elements.length} POIs in ${duration}ms`);
    
    res.json(result);
    
  } catch (err) {
    console.error("❌ POI error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 🔍 Search Proxy (Nominatim)
// ═══════════════════════════════════════════════════════════
app.get("/api/search", async (req, res) => {
  try {
    const query = req.query.q;
    if (!query || query.length < 3) {
      return res.json([]);
    }
    
    const url = "https://nominatim.openstreetmap.org/search?" +
      "format=json&q=" + encodeURIComponent(query) +
      "&countrycodes=lb&limit=8&addressdetails=1&accept-language=ar";
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "TaxiBaalbek/1.0 (contact@taxi-baalbek.onrender.com)"
      }
    });
    
    const data = await response.json();
    
    const results = data.map(item => ({
      name: item.display_name.split(",")[0],
      fullName: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon)
    }));
    
    res.json(results);
  } catch (err) {
    console.error("Search error:", err.message);
    res.status(500).json({ error: err.message });
  }
});
// ═══ صفحة التثبيت ═══
app.get("/install", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "install.html"));
});
// ═══════════════════════════════════════════════════════════
// 📚 Routes
// ═══════════════════════════════════════════════════════════
app.use("/api/auth", authRoutes);
app.use("/api/rides", rideRoutes);

// ═══════════════════════════════════════════════════════════
// 🗄️ MongoDB Connection
// ═══════════════════════════════════════════════════════════
console.log("🔄 Attempting MongoDB connection...");
console.log("📍 MONGO_URI:", process.env.MONGO_URI 
  ? process.env.MONGO_URI.substring(0, 60) + "..." 
  : "❌ MISSING!");

mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
})
  .then(() => console.log("✅ MongoDB connected successfully"))
  .catch(err => {
    console.error("❌ MongoDB connection FAILED:", err.message);
  });

// ═══════════════════════════════════════════════════════════
// ⚙️ Settings
// ═══════════════════════════════════════════════════════════
const SEARCH_RADIUS_KM = parseFloat(process.env.SEARCH_RADIUS_KM) || 10;
const SEND_TO_NEAREST_ONLY = process.env.SEND_TO_NEAREST_ONLY === "true";
const FALLBACK_TO_ALL = process.env.FALLBACK_TO_ALL === "true";
const AVG_SPEED_KMH = 30;

// ═══════════════════════════════════════════════════════════
// 💾 In-Memory Storage
// ═══════════════════════════════════════════════════════════
const onlineDrivers = new Map();
const pendingRides = new Map();
const activeRides = new Map();

// ═══════════════════════════════════════════════════════════
// 🛠️ Helper Functions
// ═══════════════════════════════════════════════════════════
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateArrivalMin(dist) {
  return Math.max(1, Math.round((dist / AVG_SPEED_KMH) * 60));
}

function findAvailableDrivers(lat, lng) {
  const arr = [];
  for (const [driverId, info] of onlineDrivers.entries()) {
    if (info.busy || !info.lat || !info.lng) continue;
    const dist = calculateDistance(lat, lng, info.lat, info.lng);
    arr.push({ driverId, ...info, distance: dist, eta: estimateArrivalMin(dist) });
  }
  arr.sort((a, b) => a.distance - b.distance);
  return arr;
}

function getDriversPublicList() {
  const list = [];
  for (const [driverId, info] of onlineDrivers.entries()) {
    if (!info.lat || !info.lng) continue;
    list.push({
      id: driverId,
      name: info.name,
      carModel: info.carModel,
      carPlate: info.carPlate,
      lat: info.lat,
      lng: info.lng,
      busy: info.busy
    });
  }
  return list;
}

function stopSearching(rideId) {
  const p = pendingRides.get(rideId);
  if (p) {
    if (p.interval) clearInterval(p.interval);
    pendingRides.delete(rideId);
    console.log(`🛑 إيقاف البحث للرحلة ${rideId}`);
  }
}

function broadcastRide(rideId) {
  const pending = pendingRides.get(rideId);
  if (!pending) return false;

  const ride = pending.ride;
  const allDrivers = findAvailableDrivers(ride.from.lat, ride.from.lng);
  const nearby = allDrivers.filter(d => d.distance <= SEARCH_RADIUS_KM);
  let targets = SEND_TO_NEAREST_ONLY
    ? (nearby.length > 0 ? [nearby[0]] : [])
    : nearby;

  if (targets.length === 0 && FALLBACK_TO_ALL) targets = allDrivers;
  if (targets.length === 0) {
    console.log(`⚠️ لا سائق للرحلة ${rideId}`);
    return false;
  }

  targets.forEach(driver => {
    io.to(driver.socketId).emit("ride-request", {
      ...ride,
      distanceToCustomer: driver.distance.toFixed(2),
      etaMin: driver.eta
    });
  });
  console.log(`📢 بث ${rideId} → ${targets.length} سائق`);
  return true;
}

function removeRideFromAllDrivers(rideId) {
  for (const [, info] of onlineDrivers.entries()) {
    io.to(info.socketId).emit("ride-removed", { rideId });
  }
}

function startSearchLoop(rideId) {
  broadcastRide(rideId);

  const interval = setInterval(async () => {
    const pending = pendingRides.get(rideId);
    if (!pending) {
      clearInterval(interval);
      return;
    }

    const dbRide = await Ride.findById(rideId);
    if (!dbRide || dbRide.status !== "pending") {
      stopSearching(rideId);
      return;
    }

    broadcastRide(rideId);
  }, 15000);

  const p = pendingRides.get(rideId);
  if (p) p.interval = interval;
}

// ═══════════════════════════════════════════════════════════
// 🔌 Socket.IO
// ═══════════════════════════════════════════════════════════
io.on("connection", (socket) => {
  console.log("🔌 connected:", socket.id);

  // ═══ السائق يتصل ═══
  socket.on("driver-online", ({ driverId, name, carModel, carPlate, lat, lng }) => {
    onlineDrivers.set(driverId, {
      socketId: socket.id,
      name,
      carModel,
      carPlate,
      lat,
      lng,
      busy: false,
      lastUpdate: Date.now()
    });
    socket.join("drivers");
    socket.driverId = driverId;
    console.log(`🚗 سائق متصل: ${name}`);
    io.emit("drivers-list-update", getDriversPublicList());

    // أرسل الطلبات المعلقة
    for (const [, pending] of pendingRides.entries()) {
      const dist = calculateDistance(pending.ride.from.lat, pending.ride.from.lng, lat, lng);
      if (dist <= SEARCH_RADIUS_KM * 2) {
        socket.emit("ride-request", {
          ...pending.ride,
          distanceToCustomer: dist.toFixed(2),
          etaMin: estimateArrivalMin(dist)
        });
      }
    }
  });

  // ═══ تحديث موقع السائق ═══
  socket.on("driver-location", ({ driverId, lat, lng }) => {
    const d = onlineDrivers.get(driverId);
    if (!d) return;

    d.lat = lat;
    d.lng = lng;
    d.lastUpdate = Date.now();
    io.emit("driver-location-update", { driverId, lat, lng });

    // حدّث ETA للرحلات النشطة
    for (const [rideId, active] of activeRides.entries()) {
      if (active.driverId !== driverId) continue;

      const dist = calculateDistance(lat, lng, active.fromLat, active.fromLng);
      const eta = Math.max(1, Math.round((dist / AVG_SPEED_KMH) * 60));

      if (active.customerSocketId) {
        io.to(active.customerSocketId).emit("eta-update", {
          rideId,
          etaMin: eta,
          distanceKm: dist.toFixed(2)
        });
      }

      io.to(active.driverSocketId).emit("eta-update", {
        rideId,
        etaMin: eta,
        distanceKm: dist.toFixed(2)
      });
    }
  });

  // ═══ السائق يغلق الاستقبال ═══
  socket.on("driver-offline", ({ driverId }) => {
    onlineDrivers.delete(driverId);
    io.emit("drivers-list-update", getDriversPublicList());
  });

  // ═══ الزبون يطلب رحلة ═══
  socket.on("new-ride", (ride) => {
    console.log(`🆕 رحلة جديدة: ${ride._id}`);
    pendingRides.set(ride._id, {
      ride,
      createdAt: Date.now(),
      customerSocketId: socket.id,
      interval: null
    });

    socket.emit("search-started", {
      rideId: ride._id,
      driversOnline: onlineDrivers.size
    });

    startSearchLoop(ride._id);
  });

  // ═══ السائق يقبل الرحلة ═══
  socket.on("accept-ride", async ({ rideId, driverId }) => {
    console.log(`✅ السائق ${driverId} يقبل ${rideId}`);

    const dbRide = await Ride.findById(rideId);
    if (!dbRide || dbRide.status !== "pending") {
      socket.emit("ride-unavailable", { rideId });
      return;
    }

    const customerSocketId = pendingRides.get(rideId)?.customerSocketId;
    stopSearching(rideId);

    const driverInfo = onlineDrivers.get(driverId);
    let etaMin = 5;
    let distKm = 0;

    if (driverInfo && driverInfo.lat && driverInfo.lng) {
      distKm = calculateDistance(driverInfo.lat, driverInfo.lng, dbRide.from.lat, dbRide.from.lng);
      etaMin = Math.max(1, Math.round((distKm / AVG_SPEED_KMH) * 60));
    }

    console.log(`📏 المسافة: ${distKm.toFixed(2)} كم — ETA: ${etaMin} دقيقة`);

    const updatedRide = await Ride.findByIdAndUpdate(
      rideId,
      {
        driver: driverId,
        status: "accepted",
        driverLocationAtAccept: {
          lat: driverInfo ? driverInfo.lat : null,
          lng: driverInfo ? driverInfo.lng : null
        },
        estimatedArrivalMin: etaMin,
        distanceKm: distKm
      },
      { new: true }
    )
      .populate("driver", "name phone carModel carPlate")
      .populate("customer", "name phone");

    const d = onlineDrivers.get(driverId);
    if (d) d.busy = true;

    activeRides.set(rideId, {
      driverId,
      driverSocketId: socket.id,
      customerSocketId,
      fromLat: dbRide.from.lat,
      fromLng: dbRide.from.lng,
      startedAt: Date.now()
    });

    // أبلغ السائق
    socket.emit("ride-confirmed", {
      rideId,
      ride: updatedRide,
      etaMin,
      distanceKm: distKm.toFixed(2)
    });

    // أبلغ باقي السائقين
    for (const [otherDriverId, info] of onlineDrivers.entries()) {
      if (otherDriverId !== driverId) {
        io.to(info.socketId).emit("ride-removed", { rideId });
      }
    }

    // أبلغ الزبون
    if (customerSocketId) {
      io.to(customerSocketId).emit("ride-accepted", {
        rideId,
        driver: updatedRide.driver,
        etaMin,
        distanceKm: distKm.toFixed(2),
        ride: updatedRide
      });
    }

    io.emit("drivers-list-update", getDriversPublicList());
  });

  // ═══ إلغاء الرحلة ═══
  socket.on("cancel-ride", async ({ rideId, cancelledBy }) => {
    console.log(`❌ إلغاء ${rideId} بواسطة ${cancelledBy}`);

    const active = activeRides.get(rideId);
    const pending = pendingRides.get(rideId);
    const customerSocketId = active?.customerSocketId || pending?.customerSocketId;

    stopSearching(rideId);
    activeRides.delete(rideId);

    await Ride.findByIdAndUpdate(rideId, {
      status: "pending",
      driver: null,
      driverLocationAtAccept: null,
      estimatedArrivalMin: null,
      cancelledBy
    }).catch(() => {});

    removeRideFromAllDrivers(rideId);

    if (active && active.driverId) {
      const d = onlineDrivers.get(active.driverId);
      if (d) d.busy = false;
    }

    // الزبون ألغى — أبلغ السائق
    if (cancelledBy === "customer") {
      if (active && active.driverSocketId) {
        io.to(active.driverSocketId).emit("customer-cancelled", { rideId });
      }
      if (customerSocketId) {
        io.to(customerSocketId).emit("ride-cancelled", { rideId, cancelledBy });
      }
    }

    // السائق ألغى — أعد البحث
    if (cancelledBy === "driver" && customerSocketId) {
      const ride = await Ride.findById(rideId).populate("customer", "name phone");
      if (ride) {
        pendingRides.set(rideId, {
          ride: ride.toObject(),
          createdAt: Date.now(),
          customerSocketId,
          interval: null
        });

        io.to(customerSocketId).emit("search-restarted", {
          rideId,
          message: "🔄 السائق ألغى — جاري البحث عن سائق آخر..."
        });

        startSearchLoop(rideId);
      }
    }

    io.emit("drivers-list-update", getDriversPublicList());
  });
  // ═══ السائق وصل لموقع الزبون ═══
  socket.on("driver-arrived", async ({ rideId, driverId }) => {
    console.log(`📍 السائق ${driverId} وصل للرحلة ${rideId}`);
    
    const active = activeRides.get(rideId);
    if (!active) return;
    
    // ⚠️ أبلغ الزبون
    if (active.customerSocketId) {
      io.to(active.customerSocketId).emit("driver-arrived", {
        rideId,
        driverId
      });
    }
    
    // ⚠️ حدّث حالة الرحلة في قاعدة البيانات
    await Ride.findByIdAndUpdate(rideId, {
      driverArrived: true,
      driverArrivedAt: new Date()
    }).catch(() => {});
  });

  // ═══ إنهاء الرحلة ═══
  socket.on("ride-completed", async ({ driverId, rideId }) => {
    console.log(`🏁 ${driverId} أنهى ${rideId}`);

    const d = onlineDrivers.get(driverId);
    if (d) d.busy = false;

    await Ride.findByIdAndUpdate(rideId, { status: "completed" }).catch(() => {});
    activeRides.delete(rideId);

    io.emit("drivers-list-update", getDriversPublicList());
  });

  // ═══ انقطاع الاتصال ═══
  socket.on("disconnect", () => {
    if (socket.driverId) {
      onlineDrivers.delete(socket.driverId);
      io.emit("drivers-list-update", getDriversPublicList());
      console.log(`🔌 سائق خرج: ${socket.driverId}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// 🧹 Cleanup: إزالة السائقين غير النشطين
// ═══════════════════════════════════════════════════════════
setInterval(() => {
  const now = Date.now();
  for (const [driverId, info] of onlineDrivers.entries()) {
    if (now - info.lastUpdate > 60000) {
      onlineDrivers.delete(driverId);
      console.log(`🧹 إزالة سائق غير نشط: ${driverId}`);
    }
  }
}, 30000);

// ═══════════════════════════════════════════════════════════
// 🚀 Start Server
// ═══════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});