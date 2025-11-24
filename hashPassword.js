import bcrypt, { hash } from "bcrypt";

const password = "Pass@123";
const saltRounds = 10;

bcrypt.hash(password, saltRounds, (err, hash) => {
  if (err) {
    console.error(err);
    return;
  }
  console.log("Hashed Password:", hash);
});
