import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { deleteOnCloudinary, uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { Video } from "../models/video.model.js";

const generateAccessAndRefreshTokens = async (userId) => {
  try {
    //find the user for which tokens has to be generated
    const user = await User.findById(userId);

    // generate tokens
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    // make the refresh token and save it in the db so that whenever the accesstoken gets expired it can reneview by the refresh token
    user.refreshToken = refreshToken;
    await user.save({ validaBeforeSave: false }); // dont validate any parameters just save

    // return both token so that they can be used in cookies
    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(
      500,
      "Something went wrong while generating refresh and access token"
    );
  }
};

const registerUser = asyncHandler(async (req, res) => {
  // get the user details from frontend
  // validation  - not empty
  // check if user already exists: username, email
  // check for images, check for avatar
  // upload them to cloudinary, avatar
  // create user object - create entry in db
  // remove password and refresh token field from resonse
  // check for user creation
  // return res

  const { fullName, username, email, password } = req.body;
  console.log("fullName:", fullName);

  // if after trminig any field gets the "" value then throw error scence all the fields are required
  if (
    [fullName, username, email, password].some((field) => field?.trim() === "")
  ) {
    throw new ApiError(400, "All the fields are required");
  }

  //find the user in db, if not found then no such user exist
  const existedUser = await User.findOne({
    $or: [{ username }, { email }],
  });
  if (existedUser) {
    throw new ApiError(409, "User with email or username already exist");
  }

  // req.files? --> if the files exist or not, .avatar[0]? --> checks if their is any 0th element exist or not, .path--> gives the path for the file
  const avatarLocalPath = req.files?.avatar[0]?.path;
  const coverImageLocalPath = req.files?.coverImage[0]?.path;

  // if no path found then throw the error mentioned it is needed
  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is required");
  }

  // uploading the files, have to use await it can take time
  const avatar = await uploadOnCloudinary(avatarLocalPath);
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);
  if (!avatar) {
    throw new ApiError(400, "Avatar file is required");
  }

  // create the user object with the UserModel with all the fields
  const user = await User.create({
    fullName,
    avatar: avatar.url,
    coverImage: coverImage?.url || "",
    email,
    password,
    username: username.toLowerCase(),
  });

  // find the createdUser and remove the fields password and refresh token
  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken" // this fields will not come from the database
  );

  if (!createdUser) {
    throw new ApiError(500, "Something went wrong while registering");
  }

  // return the createdUser with the status code 201(success) with the message using ApiResponse
  return res
    .status(201)
    .json(new ApiResponse(200, createdUser, "User Registered successfully"));
});

const loginUser = asyncHandler(async (req, res) => {
  // fetch username, email, password
  //find the user in db
  // if not present res->"No user exist with name/email"
  // if exist take password out of it
  // compare the password and user.password using bcrypt
  // if matched user logined
  // if not incorrect password
  // generate access token and user.accessToken = accessToken
  // generate refreshToken and also assigned it with user
  // send tokens through cookie

  // take the fields from the body
  const { username, email, password } = req.body;
  // check if the any required field is blank or not
  if (!username && !email) {
    throw new ApiError(400, "username or email required");
  }

  // find if user exist with the same username or email
  const existedUser = await User.findOne({
    $or: [{ username }, { email }], // either username or email
  });

  // if the user does not exist with the same username or email  return error with the message
  if (!existedUser) {
    throw new ApiError(400, "No user exist");
  }

  //check if the password provided  is same as the db, compare them using the compare function present in the bcrypt
  const isPasswordValid = await existedUser.isPasswordCorrect(password);

  // check the isPasswordValid
  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid user credentials");
  }

  // generate the tokens using the existedUser._id
  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    existedUser._id
  );

  //extract the exisitedUser without the password and refreshToken field
  const loggedInUser = await User.findById(existedUser._id).select(
    "-password -refreshToken"
  );

  // This options make sure that cookies can be edited only from the server-side(httpOnly : true), and cookies will only be sent over HTTPS (secure: true)
  const options = {
    httpOnly: true,
    secure: true,
  };

  // return thr response with the cookies name accessToken and refreshToken and with the message
  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        { user: loggedInUser, accessToken, refreshToken },
        "User logged In successfully"
      )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  // for logingout any user remove the refreshToken present in the db corresponding to that user --> findByIdAndUpdate
  // ***** Important ***** --> req doesnt have any user but we injected it using a middleware introducing before hand in the routes named verifyJWT
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: { refreshToken: undefined },
    },
    {
      new: true, // ensures that the method returned the modified Object
    }
  );

  // This options make sure that cookies can be edited only from the server-side(httpOnly : true), and cookies will only be sent over HTTPS (secure: true)
  const options = {
    httpOnly: true,
    secure: true,
  };

  // return response and clear the cookies using the clearcookies() present in the cookie-parser and send the json with new response
  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged Out"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  try {
    //take incoming refreshToken from the cookie, if using in mobile app then take it from the body
    const incomingRefreshToken =
      req.cookie.refreshToken || req.body.refreshToken;

    // check the incoming Token
    if (!incomingRefreshToken) {
      throw new ApiError(401, "unauthorized request");
    }

    //decode using the verify with the refresh_token_secret
    const decodedToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );

    //fint the user from the db using the _id from the decoded token
    const user = await User.findById(decodedToken?._id);

    if (!user) {
      throw new ApiError(401, "Invalid RefreshToken");
    }

    //check if the refreshToken provided by client is same as that stored in the db
    if (incomingRefreshToken !== user?.refreshToken) {
      throw new ApiError(401, "Refresh Token is expired or used");
    }

    // options for the transfered cookies
    const options = {
      httpOnly: true,
      secure: true,
    };

    // generate the access token and newRefreshToken witht he generateAccessAndRefreshTokens
    const { accessToken, newRefreshToken } =
      await generateAccessAndRefreshTokens(user._id);

    //return the res with 200 satuss and accessToken and refreshToken with the opitons(http and secure)
    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", newRefreshToken, options)
      .json(
        new ApiResponse(
          200,
          { accessToken, refreshToken: newRefreshToken },
          "Access token refreshed"
        )
      );
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid refresh token");
  }
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
  //take the oldPassword and newPassword from the req.body, --> oldPassword to match with the password saved in the db
  const { oldPassword, newPassword } = req.body;

  // find the user form the user._id for which password has to be changed
  const user = await User.findById(req.user?._id);

  // check if the oldPassword is same as the password saved in the db
  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

  //if not save give error
  if (!isPasswordCorrect) {
    throw new ApiError(400, "Invalid old password");
  }

  // assign the current user object password with the newPassword
  user.password = newPassword;
  //save the current object with any other validation of other fields
  await user.save({ validaBeforeSave: false });

  //return res with status 200, and send the message
  return res.status(200, {}, "Password changed successfully");
});

const getCurrentUser = asyncHandler(async (req, res) => {
  // return the current user which is passed by the verifyJWT middlware using req.user
  return res
    .status(200)
    .json(new ApiResponse(200, req.user, "Current User fetched successfully"));
});

const updateAccountDetails = asyncHandler(async (req, res) => {
  // take the fields that have to be updated
  const { fullName, email } = req.body;

  // check if they not fields
  if (!fullName || !email) {
    throw new ApiError(400, "All field are required");
  }

  //find the user using the _id and set the updated value
  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        fullName: fullName,
        email: email,
      },
    },
    { new: true } // return the updated object
  ).select("-password -refreshToken"); // remove this field while returing

  //return res with the status 200 and user with the message
  return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated"));
});

const updateUserAvatar = asyncHandler(async (req, res) => {
  //take files from the req
  // find the user using the user._id
  // $set: files
  // return res

  //find the user by the _id
  const user = await User.findById(req.user._id);
  // store the oldCloudinaryPath --> after updating the avata remove the previous avatar file from the cloudinary
  const oldCloudindaryPath = user.avatar;

  //take the avatarLocalPath from the file.path
  const avatarLocalPath = req.file?.path;

  //check if the avatarLocalPath it exist or not
  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is Missing");
  }

  //upload the file on the cloudinary and store the return object
  const avatar = await uploadOnCloudinary(avatarLocalPath);

  // check if the received object has url
  if (!avatar.url) {
    throw new ApiError(400, "Error while uploading on avatar");
  }

  //find user by id and update the avatar value with the new public cloudinary url
  const updatedUser = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        avatar: avatar.url,
      },
    },
    {
      new: true,
    }
  ).select("-password -refreshToken");

  // delete the previous file from the cloudinary
  await deleteOnCloudinary(oldCloudindaryPath);

  // return the res with the status 200 with the updateduser and the message
  return res
    .status(200)
    .json(new ApiResponse(200, updatedUser, "avatar is updated"));
});

const updateCoverImage = asyncHandler(async (req, res) => {
  //find the user and store the current cloudinary url which has to be deleted after the updation of the new one
  const user = await User.findById(req.user._id);
  const oldCloudinaryPath = user.coverImage;

  //storet the new coverImage file path
  const coverImageLocalPath = req.file?.path;

  //throw error if the path doesnt exist
  if (!coverImageLocalPath) {
    throw new ApiError(400, "CoverImage file is Missing");
  }

  //upload the new coverImage file on the cloudinary
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  //check if the url exist or not
  if (!coverImage.url) {
    throw new ApiError(400, "Error while uploading");
  }

  //find the user and update with the new value using the $set and return the updated object without the password and refreshToken
  const updatedUser = await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        coverImage: coverImage.url,
      },
    },
    {
      new: true,
    }.select("-password -refreshToken")
  );

  //remove the file from the cloudinary
  await deleteOnCloudinary(oldCloudinaryPath);

  //return the res 200 with the updatedUser and the message
  return res
    .status(200)
    .json(new ApiResponse(200, updatedUser, "CoverImage is Updated"));
});

const getUserChannelProfile = asyncHandler(async (req, res) => {
  // get the username from the params --> from the url
  const { username } = req.params;

  // check the username is not blank
  if (!username?.trim()) {
    throw new ApiError(400, "Username is missing");
  }

  // Aggregation pipeline to get channel information and related data
  const channel = await User.aggregate([
    {
      // Match stage to filter documents based on the username
      $match: {
        username: username?.toLowerCase(), // Convert username to lowercase for case-insensitive matching
      },
    },
    {
      // Lookup stage to perform a left outer join with the Subscription collection
      // This fetches all subscriptions where the current user's _id is the channel
      $lookup: {
        from: "Subscription", // The name of the collection to join with
        localField: "_id", // The field from the User collection
        foreignField: "channel", // The field from the Subscription collection
        as: "subscribers", // The name of the new array field to add to the User documents
      },
    },
    {
      // Lookup stage to perform another left outer join with the Subscription collection
      // This fetches all subscriptions where the current user's _id is the subscriber
      $lookup: {
        from: "Subscription", // The name of the collection to join with
        localField: "_id", // The field from the User collection
        foreignField: "Subscriber", // The field from the Subscription collection
        as: "subscribedTo", // The name of the new array field to add to the User documents
      },
    },
    {
      // Add fields stage to create new fields in the documents
      $addFields: {
        // Count the number of subscribers
        subscribersCount: {
          $size: "$subscribers", // Use the $size operator to get the length of the subscribers array
        },
        // Count the number of channels the user is subscribed to
        channelsSubscribedToCount: {
          $size: "$subscribedTo", // Use the $size operator to get the length of the subscribedTo array
        },
        // Determine if the current user is subscribed to this channel
        isSubscribed: {
          $cond: {
            // Use the $cond operator to conditionally assign a value
            if: { $in: [req.user?._id, "$subscribers.subscriber"] }, // Check if the current user's _id is in the subscribers array
            then: true, // If true, set isSubscribed to true
            else: false, // If false, set isSubscribed to false
          },
        },
      },
    },
    {
      // Project stage to specify which fields to include or exclude in the output documents
      $project: {
        fullName: 1, // Include the fullName field
        username: 1, // Include the username field
        subscribersCount: 1, // Include the subscribersCount field
        channelsSubscribedToCount: 1, // Include the channelsSubscribedToCount field
        isSubscribed: 1, // Include the isSubscribed field
        avatar: 1, // Include the avatar field
        coverImage: 1, // Include the coverImage field
        email: 1, // Include the email field
      },
    },
  ]);

  // Check if the channel exists
  if (!channel?.length) {
    // If the channel does not exist, throw a 404 error
    throw new ApiError(404, "Channel does not exist");
  }

  // Send a successful response with the channel data
  return res
    .status(200) // Set the status code to 200
    .json(
      new ApiResponse(200, channel[0], "User channel fetched successfully") // Create and send
    );
});

const getWatchHistory = asyncHandler(async (req, res) => {
  const user = await User.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(req.user._id),
      },
    },
    {
      $lookup: {
        from: "videos",
        localField: "watchHistory",
        foreignField: "_id",
        as: "watchHistory",
        pipeline: [
          {
            $lookup: {
              from: "users",
              localField: "owner",
              foreignField: "_id",
              as: "owner",
              pipeline: [
                {
                  $project: {
                    fullName: 1,
                    username: 1,
                    avatar: 1,
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ]);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        user[0].watchHistory,
        "Watch history fetched successfully"
      )
    );
});

const uploadVideo = asyncHandler(async (req, res) => {
  const { title, description } = req;
  const { owner } = req.user;
  const videoLocalPath = req.files?.videoFile[0]?.path;
  const thumbnailLocalPath = req.files?.thumbnail[0]?.path;

  if (!videoLocalPath) {
    throw new ApiError(400, "VideoFile path dosent exist");
  }
  if (!thumbnailLocalPath) {
    throw new ApiError(400, "VideoFile path dosent exist");
  }

  const videoFile = await uploadOnCloudinary(videoLocalPath);
  const thumbnail = await uploadOnCloudinary(thumbnailLocalPath);

  if (!videoFile || !thumbnail) {
    throw new ApiError(400, "Error while uploading the file");
  }

  const video = await Video.create({
    videoFile: videoFile.url,
    thumbnail: thumbnail.url,
    title,
    description,
    user,
  });

  if (!video) {
    throw new ApiError(400, "Error while creating the video ");
  }

  return res.status(
    200,
    new ApiResponse(200, video, "Vidoe uploaded successfully")
  );
});

const deleteVideo = asyncHandler(async (req, res) => {
  const Video = await Video.findById(re);
  const deletedVideo = await Video.findByIdAndDelete(req.user._id);
  return res.status(
    200,
    new ApiResponse(200, {}, "Video deleted successfully")
  );
});

export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccountDetails,
  updateUserAvatar,
  updateCoverImage,
  getUserChannelProfile,
  getWatchHistory,
};
