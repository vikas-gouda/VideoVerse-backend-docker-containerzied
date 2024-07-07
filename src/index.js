import "dotenv/config.js";
import { connectDB } from "./db/dbConnect.js";
import { app } from "./app.js";

connectDB()
  .then(() => {
    app.listen(process.env.PORT || 8000, () => {
      console.log(`Serving is listening at port : ${process.env.PORT || 8000}`);
    });
  })
  .catch((err) => {
    console.log("MongoDB connection failed");
  });

/*
import e from "express";

const app = e();

(async () => {
  try {
    await mongoose.connect(`${process.env.MONGODB_URI}/${DB_NAME}`);

    app.on("error", (error) => {
      console.log("Application was not able to talk", error);
      throw error; 
    });

    app.listen(process.env.PORT, () => {
      console.log(`App is listening on Port `, process.env.PORT);
    });
  } catch (error) {
    console.error("Error: ", error);
    throw error;
  }
})();
*/
