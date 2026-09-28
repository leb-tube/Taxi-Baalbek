const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  phone:     { type: String, required: true, unique: true },
  password:  { type: String, required: true },
  role:      { type: String, enum: ["customer", "driver"], required: true },
  carModel:  String,
  carPlate:  String,
  isOnline:  { type: Boolean, default: false },
  location:  { lat: Number, lng: Number }
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
