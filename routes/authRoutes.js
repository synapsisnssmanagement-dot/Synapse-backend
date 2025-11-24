// import express from "express";
// import passport from "passport";
// import jwt from "jsonwebtoken";

// const router = express.Router();

// // Step 1: Google login
// router.get(
//   "/google",
//   passport.authenticate("google", { scope: ["profile", "email"] })
// );

// // Step 2: Google callback
// router.get(
//   "/google/callback",
//   passport.authenticate("google", {
//     failureRedirect: "http://localhost:5173/login?error=notregistered",
//   }),
//   (req, res) => {
//     const token = jwt.sign(
//       { id: req.user.id, role: req.user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: "7d" }
//     );

//     // console.log(req.user)
//     if (req.user.role === "admin") {
//       return res.redirect(`http://localhost:5173/adminpanel?token=${token}`);
//     } else if (req.user.role === "student") {
//       return res.redirect("http://localhost:5173/studentdashboard");
//     } else {
//       return res.redirect("http://localhost:5173/");
//     }
//   }
// );

// export default router;
// import express from "express";
// import passport from "passport";
// import jwt from "jsonwebtoken";

// const router = express.Router();

// // Step 1: Google login
// router.get(
//   "/google",
//   passport.authenticate("google", { scope: ["profile", "email"] })
// );

// // Step 2: Google callback
// router.get(
//   "/google/callback",
//   passport.authenticate("google", {
//     failureRedirect: "http://localhost:5173/login?error=notregistered",
//     session: false,
//   }),
//   (req, res) => {
//     const { id, role } = req.user;

//     // ✅ Generate JWT (contains id + role)
//     const token = jwt.sign({ id, role }, process.env.JWT_SECRET, {
//       expiresIn: "7d",
//     });

//     // ✅ Redirect based on role with token in query
//     if (role === "admin" || role === "superadmin") {
//       return res.redirect(
//         `http://localhost:5173/adminpanel?token=${token}&role=${role}`
//       );
//     } else if (role === "coordinator") {
//       return res.redirect(
//         `http://localhost:5173/coordinatorlayout?token=${token}&role=${role}`
//       );
//     } else if (role === "teacher") {
//       return res.redirect(
//         `http://localhost:5173/teacherlayout?token=${token}&role=${role}`
//       );
//     } else if (role === "student") {
//       return res.redirect(
//         `http://localhost:5173/studentlayout?token=${token}&role=${role}`
//       );
//     } else {
//       return res.redirect("http://localhost:5173/login?error=invalidrole");
//     }
//   }
// );

// export default router;
import express from "express";
import passport from "passport";
import jwt from "jsonwebtoken";

const router = express.Router();

// Step 1: Google login
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// Step 2: Google callback
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "http://localhost:5173/login?error=notregistered",
    session: false,
  }),
  (req, res) => {
    const { id, role } = req.user;

    // ✅ Generate JWT token with user id + role
    const token = jwt.sign({ id, role }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    // ✅ Redirect to a single success handler route on the frontend
    return res.redirect(
      `http://localhost:5173/auth/success?token=${token}&role=${role}`
    );
  }
);

export default router;
