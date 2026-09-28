const router = require("express").Router();
const Ride = require("../models/Ride");

// ═══ إنشاء رحلة جديدة ═══
router.post("/", async (req, res) => {
  try {
    const { customerId, from, to } = req.body;
    const ride = await Ride.create({ customer: customerId, from, to });
    const populated = await ride.populate("customer", "name phone");
    req.app.get("io").emit("ride-request", populated);
    res.json(populated);
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// ═══ السائق يقبل الرحلة ═══
router.put("/:id/accept", async (req, res) => {
  try {
    const { driverId, driverLat, driverLng } = req.body;
    
    const ride = await Ride.findByIdAndUpdate(
      req.params.id,
      { 
        driver: driverId, 
        status: "accepted",
        driverLocationAtAccept: { lat: driverLat, lng: driverLng }
      },
      { new: true }
    )
    .populate("driver", "name phone carModel carPlate")
    .populate("customer", "name phone");

    if (!ride) return res.status(404).json({ error: "الرحلة غير موجودة" });

    req.app.get("io").emit("ride-accepted", ride);
    res.json(ride);
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// ═══ إلغاء الرحلة (زبون أو سائق) ═══
router.put("/:id/cancel", async (req, res) => {
  try {
    const { cancelledBy, reason } = req.body;
    
    const ride = await Ride.findByIdAndUpdate(
      req.params.id,
      { 
        status: "pending",  // ✅ يرجع لحالة pending ليأخذه سائق آخر
        driver: null,
        driverLocationAtAccept: null,
        estimatedArrivalMin: null,
        cancelledBy,
        cancelReason: reason || ""
      },
      { new: true }
    )
    .populate("customer", "name phone");

    if (!ride) return res.status(404).json({ error: "الرحلة غير موجودة" });

    console.log(`❌ إلغاء بواسطة ${cancelledBy} — الرحلة ${ride._id}`);

    // أبلغ السائق إذا كان هناك سائق قد قبلها
    req.app.get("io").emit("ride-cancelled", { 
      rideId: ride._id, 
      cancelledBy, 
      ride  // ⚠️ أعد الطلب للقائمة
    });

    res.json(ride);
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// ═══ إنهاء الرحلة ═══
router.put("/:id/complete", async (req, res) => {
  try {
    const ride = await Ride.findByIdAndUpdate(
      req.params.id,
      { status: "completed" },
      { new: true }
    );
    res.json(ride);
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// ═══ الرحلات المعلقة ═══
router.get("/pending", async (req, res) => {
  try {
    const rides = await Ride.find({ status: "pending" })
      .populate("customer", "name phone");
    res.json(rides);
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

module.exports = router;
