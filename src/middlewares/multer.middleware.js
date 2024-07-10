import multer from "multer";

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./public/temp"); // "./public/temp" --> destination whrere the files from the request gets stored
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname);
  },
});

export const upload = multer({ storage: storage });
