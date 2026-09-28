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

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.set("io", io);

app.get("/admin/reset-db", async (req, res) => {
  try {
    const users = await User.countDocuments();
    const rides = await Ride.countDocuments();
    await User.deleteMany({});
    await Ride.deleteMany({});
    console.log(`🗑️ مسح ${users} مستخدم و ${rides} رحلة`);
    res.json({ success: true, message: `✅ تم مسح ${users} مستخدم و ${rides} رحلة` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/rides", rideRoutes);

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err.message));

const SEARCH_RADIUS_KM = parseFloat(process.env.SEARCH_RADIUS_KM) || 10;
const SEND_TO_NEAREST_ONLY = process.env.SEND_TO_NEAREST_ONLY === "true";
const FALLBACK_TO_ALL = process.env.FALLBACK_TO_ALL === "true";
const AVG_SPEED_KMH = 30;

const onlineDrivers = new Map();
const pendingRides = new Map();
const activeRides = new Map();

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function estimateArrivalMin(dist) {
  return Math.max(1, Math.round((dist / AVG_SPEED_KMH) * 60));
}

function findAvailableDrivers(lat, lng) {
  const arr = [];
  for (const [driverId, info] of onlineDrivers.entries()) {
    if (info.busy || !info.lat || !info.lng) continue;
    const dist = distanceKm(lat, lng, info.lat, info.lng);
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
      id: driverId, name: info.name, carModel: info.carModel, carPlate: info.carPlate,
      lat: info.lat, lng: info.lng, busy: info.busy
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
  for (const [driverId, info] of onlineDrivers.entries()) {
    io.to(info.socketId).emit("ride-removed", { rideId });
  }
  console.log(`🧹 إزالة ${rideId} من كل السائقين`);
}

function startSearchLoop(rideId) {
  broadcastRide(rideId);
  
  const interval = setInterval(async () => {
    const pending = pendingRides.get(rideId);
    if (!pending) { clearInterval(interval); return; }
    
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

io.on("connection", (socket) => {
  console.log("🔌 connected:", socket.id);

  socket.on("driver-online", ({ driverId, name, carModel, carPlate, lat, lng }) => {
    onlineDrivers.set(driverId, { 
      socketId: socket.id, name, carModel, carPlate,
      lat, lng, busy: false, lastUpdate: Date.now()
    });
    socket.join("drivers");
    socket.driverId = driverId;
    console.log(`🚗 سائق متصل: ${name}`);
    io.emit("drivers-list-update", getDriversPublicList());
    
    for (const [rideId, pending] of pendingRides.entries()) {
      const dist = distanceKm(pending.ride.from.lat, pending.ride.from.lng, lat, lng);
      if (dist <= SEARCH_RADIUS_KM * 2) {
        socket.emit("ride-request", {
          ...pending.ride,
          distanceToCustomer: dist.toFixed(2),
          etaMin: estimateArrivalMin(dist)
        });
      }
    }
  });

  socket.on("driver-location", ({ driverId, lat, lng }) => {
    const d = onlineDrivers.get(driverId);
    if (d) { 
      d.lat = lat; d.lng = lng; d.lastUpdate = Date.now();
      io.emit("driver-location-update", { driverId, lat, lng });
    }
  });

  socket.on("driver-offline", ({ driverId }) => {
    onlineDrivers.delete(driverId);
    io.emit("drivers-list-update", getDriversPublicList());
  });

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

  socket.on("accept-ride", async ({ rideId, driverId, etaMin }) => {
    console.log(`✅ السائق ${driverId} يقبل ${rideId}`);
    
    const dbRide = await Ride.findById(rideId);
    if (!dbRide || dbRide.status !== "pending") {
      socket.emit("ride-unavailable", { rideId });
      return;
    }
    
    const customerSocketId = pendingRides.get(rideId)?.customerSocketId;
    stopSearching(rideId);
    
    const updatedRide = await Ride.findByIdAndUpdate(
      rideId,
      { 
        driver: driverId, 
        status: "accepted",
        driverLocationAtAccept: { 
          lat: onlineDrivers.get(driverId)?.lat, 
          lng: onlineDrivers.get(driverId)?.lng 
        },
        estimatedArrivalMin: etaMin
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
      startedAt: Date.now()
    });
    
    // أبلغ السائق القابل ببيانات الزبون
    socket.emit("ride-confirmed", {
      rideId,
      ride: updatedRide,
      etaMin
    });
    
    // أبلغ باقي السائقين بإزالة البطاقة
    for (const [otherDriverId, info] of onlineDrivers.entries()) {
      if (otherDriverId !== driverId) {
        io.to(info.socketId).emit("ride-removed", { rideId });
      }
    }
    
    // أبلغ الزبون ببيانات السائق
    if (customerSocketId) {
      io.to(customerSocketId).emit("ride-accepted", { 
        rideId, 
        driver: updatedRide.driver,
        etaMin,
        ride: updatedRide
      });
      console.log(`📤 إبلاغ الزبون بقبول ${driverId}`);
    }
    
    io.emit("drivers-list-update", getDriversPublicList());
  });

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
    
    if (active?.driverId) {
      const d = onlineDrivers.get(active.driverId);
      if (d) d.busy = false;
      console.log(`🔓 السائق ${active.driverId} متاح مجدداً`);
    }
    
    // ══════════════════════════════════════════════════════
    // ⚠️ الإصلاح الرئيسي: إبلاغ صحيح حسب من ألغى
    // ══════════════════════════════════════════════════════
    
    // ✅ إذا ألغى الزبون — أبلغ السائق
    if (cancelledBy === "customer") {
      if (active?.driverSocketId) {
        io.to(active.driverSocketId).emit("customer-cancelled", { rideId });
        console.log(`📤 إبلاغ السائق ${active.driverId} بإلغاء الزبون`);
      }
      if (customerSocketId) {
        io.to(customerSocketId).emit("ride-cancelled", { rideId, cancelledBy });
      }
    }
    
    // ✅ إذا ألغى السائق — أعد البحث للزبون
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
        console.log(`🔄 البحث عاد للرحلة ${rideId}`);
      }
    }
    
    io.emit("drivers-list-update", getDriversPublicList());
  });

  socket.on("ride-completed", async ({ driverId, rideId }) => {
    console.log(`🏁 ${driverId} أنهى ${rideId}`);
    
    const d = onlineDrivers.get(driverId);
    if (d) d.busy = false;
    
    await Ride.findByIdAndUpdate(rideId, { status: "completed" }).catch(() => {});
    activeRides.delete(rideId);
    
    io.emit("drivers-list-update", getDriversPublicList());
  });

  socket.on("disconnect", () => {
    if (socket.driverId) {
      onlineDrivers.delete(socket.driverId);
      io.emit("drivers-list-update", getDriversPublicList());
      console.log(`🔌 سائق خرج: ${socket.driverId}`);
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [driverId, info] of onlineDrivers.entries()) {
    if (now - info.lastUpdate > 60000) {
      onlineDrivers.delete(driverId);
      console.log(`🧹 إزالة سائق غير نشط: ${driverId}`);
    }
  }
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
