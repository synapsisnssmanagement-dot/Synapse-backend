// import passport from "passport";
// import { Strategy as GoogleStrategy } from "passport-google-oauth20";
// import Admin from "../models/Admin.js";

// passport.use(
//   new GoogleStrategy(
//     {
//       clientID: process.env.GOOGLE_CLIENT_ID,
//       clientSecret: process.env.GOOGLE_CLIENT_SECRET,
//       callbackURL: "http://localhost:3000/api/auth/google/callback",
//     },
//     async (accessToken, refreshToken, profile, done) => {
//       try {
//         const email = profile.emails[0].value;
//         const name = profile.displayName;

//         let admin = await Admin.findOne({ email });
//         if (!admin) {
//           // User not found — don't create automatically
//           return done(null, false, { message: "User not registered" });
//         }
//         return done(null, admin);
//       } catch (err) {
//         return done(err, null);
//       }
//     }
//   )
// );

// passport.serializeUser((user, done) => {
//   done(null, user.id); // store admin._id
// });

// passport.deserializeUser(async (id, done) => {
//   try {
//     const user = await Admin.findById(id);
//     done(null, user);
//   } catch (err) {
//     done(err, null);
//   }
// });
// import passport from "passport";
// import { Strategy as GoogleStrategy } from "passport-google-oauth20";
// import Admin from "../models/Admin.js";
// import Student from "../models/Student.js";

// passport.use(
//   new GoogleStrategy(
//     {
//       clientID: process.env.GOOGLE_CLIENT_ID,
//       clientSecret: process.env.GOOGLE_CLIENT_SECRET,
//       callbackURL: "http://localhost:3000/api/auth/google/callback",
//     },
//     async (accessToken, refreshToken, profile, done) => {
//       try {
//         const email = profile.emails[0].value;

//         // Check if user is Admin
//         let user = await Admin.findOne({ email });
//         if (user) {
//           return done(null, { id: user._id, role: "admin" });
//         }

//         // Check if user is Student
//         user = await Student.findOne({ email });
//         if (user) {
//           return done(null, { id: user._id, role: "student" });
//         }

//         // Not registered
//         return done(null, false, { message: "User not registered" });
//       } catch (err) {
//         return done(err, null);
//       }
//     }
//   )
// );

// passport.serializeUser((user, done) => {
//   done(null, user);
// });

// passport.deserializeUser((obj, done) => {
//   done(null, obj);
// });



import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import Admin from "../models/Admin.js";
import Student from "../models/Student.js";
import Teacher from "../models/Teacher.js";
import Coordinator from "../models/Coordinator.js";
import Alumni from "../models/Alumni.js";

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/api/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;

        let user =
          (await Admin.findOne({ email })) ||
          (await Coordinator.findOne({ email })) ||
          (await Teacher.findOne({ email })) ||
          (await Student.findOne({ email })) ||
          (await Alumni.findOne({ email }));

        if (!user) {
          return done(null, false, { message: "User not registered" });
        }

        // Identify role
        let role = "unknown";
        if (user instanceof Admin) role = user.role || "admin";
        else if (user instanceof Coordinator) role = "coordinator";
        else if (user instanceof Teacher) role = "teacher";
        else if (user instanceof Student) role = user.role || "student";
        else if (user instanceof Alumni) role = "alumni";

        return done(null, { id: user._id, role });
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));
