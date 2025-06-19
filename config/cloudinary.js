const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const config = require("./env"); // <-- IMPORT the new config

cloudinary.config({
  cloud_name: config.CLOUDINARY_CLOUD_NAME, // <-- USE config
  api_key: config.CLOUDINARY_API_KEY, // <-- USE config
  api_secret: config.CLOUDINARY_API_SECRET, // <-- USE config
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "betwise_profiles",
    allowed_formats: ["jpg", "png", "jpeg"],
    transformation: [{ width: 200, height: 200, crop: "fill" }],
  },
});

module.exports = { cloudinary, storage };
