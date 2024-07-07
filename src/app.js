import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

const app = express();
app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
  })
);

// to use json and to set the limit of json data
app.use(express.json({ limit: "10kb" }));

// for the url data
app.use(express.urlencoded());

// for the access of the public folder for the static files
app.use(express.static("public"));

//for the access of the cookies in the server and the local
app.use(cookieParser());

export { app };
