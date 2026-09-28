const mongoose = require("mongoose");

const rideSchema = new mongoose.Schema({
  customer:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  driver:    { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  from:      { lat: Number, lng: Number, address: String },
  to:        { lat: Number, lng: Number, address: String },
  status:    { 
    type: String, 
    enum: ["pending", "accepted", "cancelled", "completed"], 
    default: "pending" 
  },
  // ═══ معلومات إضافية ═══
  driverLocationAtAccept: { lat: Number, lng: Number },  // موقع السائق عند القبول
  estimatedArrivalMin: Number,                            // وقت الوصول بالدقائق
  distanceKm: Number,                                     // المسافة بالكم
  cancelledBy: String,                                    // من ألغى الطلب
  cancelReason: String
}, { timestamps: true });

module.exports = mongoose.model("Ride", rideSchema);
