import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import { error } from "console";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadOnCloudinary = async (localFilePath) => {
  try {
    if (!localFilePath) {
      // file path not present
      console.error("FilePath not present");
      throw err;
    }

    const uploadResult = await cloudinary.uploader
      .upload(localFilePath, {
        resource_type: "auto",
      })
      .catch((error) => {
        console.log(error);
      });

    // console.log("File uploaded on cloudinary", uploadResult.url);

    fs.unlinkSync(localFilePath);

    return uploadResult;
  } catch (error) {
    // remove the locally saved temp file as the upload operation failed
    fs.unlinkSync(localFilePath);
    return null;
  }
};

const deleteOnCloudinary = async (localFilePath) => {
  try {
    if (!localFilePath) {
      console.log("File is missing");
    }

    const deleteResult = await cloudinary.uploader
      .destroy(localFilePath, {
        resource_type: "auto",
      })
      .catch((error) => {
        console.error(error);
      });
  } catch (error) {
    console.error("Error while deleting the file from the cloudinary");
  }
};

export { uploadOnCloudinary, deleteOnCloudinary };
