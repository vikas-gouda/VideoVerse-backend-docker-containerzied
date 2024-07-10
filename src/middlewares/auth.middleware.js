import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";

export const verifyJWT = asyncHandler(async (req, res, next) => {
  try {
    // taking access token through the cookies which gets generated while login, if access is not present to the cookies than use Authorization in the header, remove the "Bearer " from the Athorization header
    const token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "");

    // if token is not present then return the error
    if (!token) {
      throw new ApiError(401, "Unauthorized request");
    }

    // decode token using the verify function present in the jwt module which takes the token and the token secret
    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    // returning the user object without password and refreshToken
    const user = await User.findById(decodedToken?._id).select(
      "-password -refreshToken"
    );

    if (!user) {
      throw new ApiError(401, "Invalid Access token");
    }

    // injecting a new field in the req named user so that logout controller can use it to find the user in the db and make the refreshToken=undefined and update it
    req.user = user;
    next(); // move to the next
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid access token");
  }
});
