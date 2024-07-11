import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { deleteOnCloudinary, uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";

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
    //
    const incomingRefreshToken =
      req.cookie.refreshToken || req.body.refreshToken;

    if (!incomingRefreshToken) {
      throw new ApiError(401, "unauthorized request");
    }

    const decodedToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );

    const user = await User.findById(decodedToken?._id);

    if (!user) {
      throw new ApiError(401, "Invalid RefreshToken");
    }

    if (incomingRefreshToken !== user?.refreshToken) {
      throw new ApiError(401, "Refresh Token is expired or used");
    }

    const optins = {
      httpOnly: true,
      secure: true,
    };

    const { accessToken, newRefreshToken } =
      await generateAccessAndRefreshTokens(user._id);

    return res
      .status(200)
      .cookie("accessToken", accessToken)
      .cookie("refreshToken", newRefreshToken)
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
  const { oldPassword, newPassword } = req.body;

  const user = await User.findById(req.user?._id);

  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

  if (!isPasswordCorrect) {
    throw new ApiError(400, "Invalid old password");
  }

  user.password = newPassword;
  await user.save({ validaBeforeSave: false });

  return res.status(200, {}, "Password changed successfully");
});

const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(200, req.user, "Current User fetched successfully");
});

const updateAccountDetails = asyncHandler(async (req, res) => {
  const { fullName, email } = req.body;

  if (!fullName || !email) {
    throw new ApiError(400, "All field are required");
  }

  const user = await User.findById(
    req.user?._id,
    {
      $set: {
        fullName: fullName,
        email: email,
      },
    },
    { new: true }
  ).select("-password -refreshToken");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated"));
});

const updateUserAvatar = asyncHandler(async (req, res) => {
  //take files from the req
  // find the user using the user._id
  // $set: files
  // return res

  const user = await User.findById(req.user._id);
  const oldLocalPath = user.avatar;

  const avatarLocalPath = req.file?.path;

  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is Missing");
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath);

  if (!avatar.url) {
    throw new ApiError(400, "Error while uploading on avatar");
  }

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

  await deleteOnCloudinary(oldLocalPath);

  return res
    .status(200)
    .json(new ApiResponse(200, updatedUser, "avatar is updated"));
});

const updateCoverImage = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const oldLocalPath = user.coverImage;

  const coverImageLocalPath = req.file?.path;

  if (!coverImageLocalPath) {
    throw new ApiError(400, "CoverImage file is Missing");
  }

  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  if (!coverImage.url) {
    throw new ApiError(400, "Error while uploading");
  }

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

  await deleteOnCloudinary(oldLocalPath);

  return res
    .status(200)
    .json(new ApiResponse(200, updatedUser, "CoverImage is Updated"));
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
};
