const mongoose = require("mongoose");

const blockedDeviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true, index: true },
  phone: String,
  reason: { type: String, default: "حظر إداري" },
  blockedAt: { type: Date, default: Date.now },
  blockedBy: String
}, { timestamps: true });

module.exports = mongoose.model("BlockedDevice", blockedDeviceSchema);