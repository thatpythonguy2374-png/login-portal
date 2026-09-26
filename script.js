const express = require("express");
const { log } = require("node:console");
const mysql = require("mysql2");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
require("dotenv").config();
const z = require("zod");
const { refreshTokens } = require("./drizzle/schema");
const { eq, and, isNull } = require("drizzle-orm");
const db = require("./db");
const multer = require("multer");
const path = require("path");
const XLSX = require("xlsx");
const app = express();
const port = 3000;

// =======================
// MIDDLEWARE
// =======================

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use("/uploads", express.static("uploads"));
app.set("view engine", "ejs");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },

  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() +
      "-" +
      Math.round(Math.random() * 1e9) +
      path.extname(file.originalname);

    cb(null, uniqueName);
  },
});

const upload = multer({
  storage: storage,
});
// =======================
// DATABASE CONNECTION
// =======================

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB,
});

connection.connect((error) => {
  if (error) {
    console.error("Database connection failed:", error);
  } else {
    console.log("MySQL connected successfully");
  }
});

// =======================
// ALERT RESPONSE HELPER
// =======================
// Sends a tiny HTML page that fires a JS alert() with the given message,
// then redirects the browser. Used instead of returning raw JSON so
// form-based (non-AJAX) pages can show feedback to the user.

const sendAlert = (res, message, redirectTo) => {
  return res.send(`
    <script>
      alert(${JSON.stringify(message)});
      window.location.href = ${JSON.stringify(redirectTo)};
    </script>
  `);
};

// =======================
// GET USER HOME ROUTE
// =======================

const getHomeRoute = (req) => {
  if (req.user.role === "Admin") {
    return "/admin/dashboard";
  }

  return "/dashboard";
};

// =======================
// ZOD VALIDATION SCHEMAS
// =======================

const userSchema = z.object({
  name: z.string().min(2),
  username: z.string().min(7).email("this is not valid email"),
  password: z.string().min(6, "password should be less than 6"),
  role: z.enum(["User", "Admin"]),
});

const loginSchema = z.object({
  username: z
    .string()
    .min(7, "username is required")
    .email("this is not a valid email"),
  password: z.string().min(6, "password should be at least 6 characters"),
});

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),

  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

const deleteAccountSchema = z.object({
  password: z.string().min(6, "current password is required"),
});

// =======================
// JWT AUTHENTICATION
// =======================

const verifyCookie = (req, res, next) => {
  const token = req.cookies.token;

  // No token
  if (!token) {
    return res.redirect("/login");
  }

  try {
    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Make JWT data available to the next route/middleware
    req.user = decoded;

    console.log("Token verified:", req.user);

    next();
  } catch (error) {
    // Remove invalid/expired token
    res.clearCookie("token");

    return res.redirect("/login");
  }
};

// =======================
// ADMIN AUTHORIZATION
// =======================

const verifyAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).send("Not logged in");
  }

  // Your database currently uses Admin with capital A
  if (req.user.role !== "Admin") {
    return res.status(403).send("Admin access only");
  }

  if (req.user.role === "User") {
    return res.status(403).send("Admin access only");
  }

  next();
};

// =======================
// HOME PAGE
// =======================

app.get("/", (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.render("index");
  }
  try {
    const decode = jwt.verify(token, process.env.JWT_SECRET);

    if (decode.role === "Admin") {
      return res.redirect("/admin/dashboard");
    }
    return res.redirect("/dashboard");
  } catch (error) {
    return res.render("index");
  }
});

// =======================
// EXCEL PRODUCT IMPORT
// =======================

app.post(
  "/profile",
  verifyCookie,
  verifyAdmin,
  upload.single("excel"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).send("Please select an Excel file");
      }

      // Read Excel file
      const workbook = XLSX.readFile(req.file.path);

      // Get first worksheet
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];

      // Read Excel rows
      const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: "",
      });

      // Remove header row
      const dataRows = rows.slice(1);

      // Allowed categories
      const allowedCategories = [
        "Electronics",
        "Clothing",
        "Fruits",
        "Vegetables",
        "Home & Kitchen",
        "Books",
        "Beauty",
        "Sports",
        "Other",
      ];

      let importedCount = 0;

      for (const row of dataRows) {
        // =======================
        // IGNORE EMPTY ROWS
        // =======================

        const isEmptyRow = row.every((value) => String(value).trim() === "");

        if (isEmptyRow) {
          continue;
        }

        // =======================
        // GET VALUES
        // =======================

        const productName = String(row[0] || "").trim();
        const price = row[1];
        const description = String(row[2] || "").trim();
        const quantity = row[3];
        const category = String(row[4] || "").trim();

        // =======================
        // VALIDATION
        // =======================

        if (!productName) {
          return sendAlert(
            res,
            "Product Name is missing in Excel",
            "/admin/dashboard",
          );
        }

        if (
          price === "" ||
          price === null ||
          price === undefined ||
          isNaN(Number(price))
        ) {
          return sendAlert(
            res,
            `Invalid price for ${productName}`,
            "/admin/dashboard",
          );
        }

        if (
          quantity === "" ||
          quantity === null ||
          quantity === undefined ||
          isNaN(Number(quantity))
        ) {
          return sendAlert(
            res,
            `Invalid quantity for ${productName}`,
            "/admin/dashboard",
          );
        }

        if (!allowedCategories.includes(category)) {
          return sendAlert(
            res,
            `Invalid category for ${productName}`,
            "/admin/dashboard",
          );
        }

        // =======================
        // INSERT INTO MYSQL
        // =======================
        const checkQuery = `
  SELECT ID
  FROM PRODUCTS
  WHERE LOWER(PRODUCT_NAME) = LOWER(?)
`;
        const [existingProduct] = await connection
          .promise()
          .execute(checkQuery, [productName]);

        if (existingProduct.length > 0) {
          const updateQuery = `UPDATE PRODUCTS SET 
          QUANTITY = QUANTITY + ?, 
          PRODUCT_PRICE = ?, 
          DESCRIPTION = ? ,
          CATEGORY = ?
          WHERE LOWER(PRODUCT_NAME) = LOWER(?)`;

          await connection
            .promise()
            .execute(updateQuery, [
              Number(price),
              description,
              Number(quantity),
              category,
              existingProduct[0].ID,
            ]);
        } else {
          const sql = `
          INSERT INTO PRODUCTS
          (
            PRODUCT_NAME,
            PRODUCT_PRICE,
            DESCRIPTION,
            QUANTITY,
            CATEGORY
          )
          VALUES (?, ?, ?, ?, ?)
        `;

          await connection
            .promise()
            .execute(sql, [
              productName,
              Number(price),
              description,
              Number(quantity),
              category,
            ]);

          importedCount++;
        }
      }

      // =======================
      // FINISHED
      // =======================

      console.log(`${importedCount} products imported successfully`);

      return sendAlert(
        res,
        `${importedCount} products imported successfully`,
        "/admin/dashboard",
      );
    } catch (error) {
      console.error("Excel import error:", error);

      return res.status(500).send("Could not import Excel file");
    }
  },
);

// =======================
// REGISTER PAGE
// =======================

app.get("/register", (req, res) => {
  res.render("register");
});

// =======================
// REGISTER USER
// =======================

app.post("/register", (req, res) => {
  const result = userSchema.safeParse(req.body);

  if (!result.success) {
    const errorMessage = result.error.issues
      .map((issue) => issue.message)
      .join("\n");
    return sendAlert(res, errorMessage, "/register");
  } else {
    log("Zod Done");
  }

  const { name, username, password, role } = result.data;

  // All newly registered users are normal users

  const userCheck = `SELECT USERNAME FROM USERS WHERE LOWER(USERNAME) = LOWER(?)`;
  connection.execute(userCheck, [username], (error, result) => {
    if (error) {
      console.error("Username check error:", error);
      return sendAlert(res, "Registration failed", "/register");
    }
    if (result.length > 0) {
      return sendAlert(res, "User already exists", "/register");
    }

    const sqlQuery = `
      INSERT INTO users
      (NAME, USERNAME, PASSWORD, ROLE)
      VALUES (?, ?, ?, ?)
    `;

    connection.execute(
      sqlQuery,
      [name, username, password, role],
      (error, result) => {
        if (error) {
          console.error(error);

          return sendAlert(res, "Registration failed", "/register");
        }
        console.log("User registered with ID:", result.insertId);

        return res.redirect("/login");
      },
    );
  });
});

// =======================
// LOGIN PAGE
// =======================

app.get("/login", (req, res) => {
  res.render("login");
});

// =======================
// LOGIN USER
// =======================

app.post("/login", async (req, res) => {
  const validation = loginSchema.safeParse(req.body);

  if (!validation.success) {
    const errorMessage = validation.error.issues
      .map((issue) => issue.message)
      .join("\n");
    return sendAlert(res, errorMessage, "/login");
  }

  const { username, password } = validation.data;

  const sqlQuery = `
    SELECT *
    FROM users
    WHERE USERNAME = ?
  `;

  try {
    // Convert your mysql2 connection to promise mode
    const [result] = await connection.promise().execute(sqlQuery, [username]);

    // Check user
    if (result.length === 0) {
      return sendAlert(res, "Invalid username or password", "/login");
    }

    const user = result[0];

    // Check password
    if (password !== user.PASSWORD) {
      return sendAlert(res, "Invalid username or password", "/login");
    }

    // =======================
    // CREATE ACCESS TOKEN
    // =======================

    const token = jwt.sign(
      {
        id: user.ID,
        name: user.NAME,
        username: user.USERNAME,
        role: user.ROLE,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1h",
      },
    );

    // =======================
    // CREATE REFRESH TOKEN
    // =======================

    const refreshToken = jwt.sign(
      {
        id: user.ID,
        name: user.NAME,
      },
      process.env.REFRESH_JWT_SECRET,
      {
        expiresIn: "24h",
      },
    );

    // Calculate expiry for database
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // =======================
    // STORE REFRESH TOKEN
    // USING DRIZZLE
    // =======================

    const existingToken = await db
      .select()
      .from(refreshTokens)
      .where(
        and(eq(refreshTokens.userId, user.ID), isNull(refreshTokens.revokedAt)),
      );

    if (existingToken.length > 0) {
      await db
        .update(refreshTokens)
        .set({
          token: refreshToken,
          expiresAt: expiresAt.toISOString().slice(0, 19).replace("T", " "),
          revokedAt: null,
        })
        .where(
          and(
            eq(refreshTokens.userId, user.ID),
            isNull(refreshTokens.revokedAt),
          ),
        );
    } else {
      await db.insert(refreshTokens).values({
        userId: user.ID,
        token: refreshToken,
        expiresAt: expiresAt.toISOString().slice(0, 19).replace("T", " "),
      });
    }

    // =======================
    // STORE COOKIES
    // =======================

    res.cookie("token", token, {
      httpOnly: true,
      maxAge: 60 * 60 * 1000,
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
    });

    console.log("User logged in:", {
      username: user.USERNAME,
      role: user.ROLE,
    });

    // =======================
    // REDIRECT
    // =======================

    if (user.ROLE === "Admin") {
      return res.redirect("/admin/dashboard");
    }

    return res.redirect("/dashboard");
  } catch (error) {
    console.error("Login error:", error);

    return sendAlert(res, "Login failed", "/login");
  }
});

// =======================
// USER DASHBOARD
// =======================

app.get("/dashboard", verifyCookie, (req, res) => {
  const sqlQuery = "SELECT * FROM products";

  connection.execute(sqlQuery, (error, products) => {
    if (error) {
      console.error(error);
      return res.status(500).send("Could not load products");
    }

    res.render("dashboard", {
      user: req.user,
      products: products,
    });
  });
});

// =======================
// ADMIN DASHBOARD
// =======================

app.get("/admin/dashboard", verifyCookie, verifyAdmin, (req, res) => {
  const sqlQuery = "SELECT * FROM PRODUCTS";

  connection.execute(sqlQuery, (error, products) => {
    if (error) {
      console.error(error);
      return res.status(500).send("Could not load products");
    }
    res.render("admin-dashboard", {
      user: req.user,
      products: products,
    });
  });
});

// =======================
// LOGOUT
// =======================

app.post("/logout", (req, res) => {
  res.clearCookie("token");

  return res.redirect("/");
});

// =======================
// UPDATE PASSWORD PAGE
// =======================

app.get("/update-password", verifyCookie, (req, res) => {
  res.render("update-password", { user: req.user });
});

// =======================
// UPDATE PASSWORD
// =======================

app.post("/update-password", verifyCookie, (req, res) => {
  const homeRoute = getHomeRoute(req);

  const validation = updatePasswordSchema.safeParse(req.body);

  if (!validation.success) {
    const errorMessage = validation.error.issues
      .map((issue) => issue.message)
      .join("\n");

    return sendAlert(res, errorMessage, homeRoute);
  }

  const { currentPassword, newPassword } = validation.data;

  const userId = req.user.id;

  const sqlQuery = "SELECT * FROM users WHERE ID = ?";

  connection.execute(sqlQuery, [userId], (error, result) => {
    if (error) {
      console.error(error);

      return sendAlert(
        res,
        "Something went wrong. Please try again.",
        homeRoute,
      );
    }

    if (result.length === 0) {
      return sendAlert(res, "User not found.", "/");
    }

    const user = result[0];

    // Check current password

    if (currentPassword !== user.PASSWORD) {
      return sendAlert(res, "Current password is incorrect.", homeRoute);
    }

    // Check that new password is different

    if (newPassword === currentPassword) {
      return sendAlert(
        res,
        "New password must be different from the current password.",
        homeRoute,
      );
    }

    // Update password

    const updateQuery = "UPDATE users SET PASSWORD = ? WHERE ID = ?";

    connection.execute(updateQuery, [newPassword, userId], (error) => {
      if (error) {
        console.error(error);

        return sendAlert(res, "Could not update password.", homeRoute);
      }

      return sendAlert(res, "Password updated successfully.", homeRoute);
    });
  });
});

// =======================
// DELETE ACCOUNT
// =======================

app.post("/delete-account", verifyCookie, (req, res) => {
  const validation = deleteAccountSchema.safeParse(req.body);

  if (!validation.success) {
    const errorMessage = validation.error.issues
      .map((issue) => issue.message)
      .join("\n");

    return sendAlert(res, errorMessage, getHomeRoute(req));
  }

  const { password } = validation.data;

  const userId = req.user.id;

  const sqlQuery = "SELECT * FROM users WHERE ID = ?";

  connection.execute(sqlQuery, [userId], async (error, result) => {
    if (error) {
      console.error(error);

      return sendAlert(
        res,
        "Something went wrong. Please try again.",
        getHomeRoute(req),
      );
    }

    if (result.length === 0) {
      return sendAlert(res, "User not found.", "/");
    }

    const user = result[0];

    // Check current password

    if (password !== user.PASSWORD) {
      return sendAlert(
        res,
        "Current password is incorrect.",
        getHomeRoute(req),
      );
    }

    try {
      // Delete refresh tokens using Drizzle

      await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));

      // Delete cart items

      await connection
        .promise()
        .execute("DELETE FROM CART WHERE USER_ID = ?", [userId]);

      // Delete user

      await connection
        .promise()
        .execute("DELETE FROM users WHERE ID = ?", [userId]);

      // Clear login cookies

      res.clearCookie("token");

      res.clearCookie("refreshToken");

      return sendAlert(res, "Account deleted successfully.", "/");
    } catch (deleteError) {
      console.error(deleteError);

      return sendAlert(res, "Could not delete account.", getHomeRoute(req));
    }
  });
});

// =======================
// ADD TO CART
// =======================

const addToCart = (req, res) => {
  const userid = req.user.id;
  const productid = req.body.productId;

  // First check product stock
  const productQuery = "SELECT * FROM PRODUCTS WHERE ID = ?";

  connection.execute(productQuery, [productid], (error, products) => {
    if (error) {
      console.error(error);
      return res.status(500).send("Product error");
    }

    if (products.length === 0) {
      return res.status(404).send("Product not found");
    }

    const product = products[0];

    // Check if product is available
    if (product.quantity <= 0) {
      return res.status(400).send("Product is out of stock");
    }

    // Check if product already exists in cart
    const cartQuery = `
        SELECT * FROM CART
        WHERE USER_ID = ? AND PRODUCT_ID = ?
      `;

    connection.execute(cartQuery, [userid, productid], (error, cart) => {
      if (error) {
        console.error(error);
        return res.status(500).send("Cart error");
      }

      // Product already in cart
      if (cart.length > 0) {
        const updateCartQuery = `
              UPDATE CART
              SET QUANTITY = QUANTITY + 1
              WHERE USER_ID = ? AND PRODUCT_ID = ?
            `;

        connection.execute(updateCartQuery, [userid, productid], (error) => {
          if (error) {
            console.error(error);
            return res.status(500).send("Could not update cart");
          }

          // Decrease product stock
          const updateProductQuery = `
                  UPDATE PRODUCTS
                  SET QUANTITY = QUANTITY - 1
                  WHERE ID = ?
                `;

          connection.execute(updateProductQuery, [productid], (error) => {
            if (error) {
              console.error(error);
              return res.status(500).send("Could not update product stock");
            }

            return res.redirect("/dashboard");
          });
        });
      } else {
        // Product not in cart
        const insertCartQuery = `
              INSERT INTO CART
              (USER_ID, PRODUCT_ID, QUANTITY)
              VALUES (?, ?, ?)
            `;

        connection.execute(insertCartQuery, [userid, productid, 1], (error) => {
          if (error) {
            console.error(error);
            return res.status(500).send("Could not add product to cart");
          }

          // Decrease product stock
          const updateProductQuery = `
                  UPDATE PRODUCTS
                  SET QUANTITY = QUANTITY - 1
                  WHERE ID = ?
                `;

          connection.execute(updateProductQuery, [productid], (error) => {
            if (error) {
              console.error(error);
              return res.status(500).send("Could not update product stock");
            }

            return res.redirect("/dashboard");
          });
        });
      }
    });
  });
};

app.post("/cart/add", verifyCookie, addToCart);

// =======================
// ADD PRODUCT
// =======================

const addProduct = (req, res) => {
  // Trim so "Banana" and " Banana " aren't treated as different products
  const productName = req.body.name?.trim();
  const quantity = req.body.quantity;
  const description = req.body.description;
  const price = req.body.price;
  const image = req.file;
  console.log(image);

  // LOWER() on both sides makes the match case-insensitive regardless of
  // the column's collation, so "Banana" and "banana" are treated as the same product
  const sqlQuery =
    "SELECT * FROM PRODUCTS WHERE LOWER(PRODUCT_NAME) = LOWER(?)";

  connection.execute(sqlQuery, [productName], (error, products) => {
    if (error) {
      console.error(error);
      return res.status(500).send("Product error");
    }
    if (products.length > 0) {
      // Restock the existing product: add to quantity AND refresh price/description
      const updateQuery = `
        UPDATE PRODUCTS
        SET QUANTITY = QUANTITY + ?, PRODUCT_PRICE = ?, DESCRIPTION = ?
        WHERE LOWER(PRODUCT_NAME) = LOWER(?)
      `;
      connection.execute(
        updateQuery,
        [quantity, price, description, productName],
        (error) => {
          if (error) {
            log(error);
            return res.status(500).send("Could able to insert product");
          } else {
            res.redirect("/admin/dashboard");
          }
        },
      );
    } else {
      const insertQuery =
        "INSERT INTO PRODUCTS (PRODUCT_NAME, PRODUCT_PRICE, DESCRIPTION, QUANTITY) VALUES(?,?,?,?)";
      connection.execute(
        insertQuery,
        [productName, price, description, quantity],
        (error) => {
          if (error) {
            log(error);
            return res.status(500).send("Could able to add product");
          } else {
            res.redirect("/admin/dashboard");
          }
        },
      );
    }
  });
};
app.post("/add/product", verifyCookie, upload.single("excel"), addProduct);

// =======================
// VIEW CART
// =======================

app.get("/cart", verifyCookie, (req, res) => {
  const userid = req.user.id;

  const sqlQuery = `
    SELECT
      cart.ID,
      cart.product_id,
      cart.quantity,
      products.product_name,
      products.product_price,
      products.description
    FROM cart
    INNER JOIN products
      ON cart.product_id = products.ID
    WHERE cart.user_id = ?
  `;

  connection.execute(sqlQuery, [userid], (error, cartItems) => {
    if (error) {
      console.error(error);
      return res.status(500).send("Could not load cart");
    }

    res.render("cart", {
      user: req.user,
      cartItems: cartItems,
    });
  });
});

// =======================
// DELETE
// =======================

const deleteProduct = (req, res) => {
  const userid = req.user.id;
  const productid = req.body.productId;

  // First check the cart
  const sqlQuery = `
    SELECT * FROM CART
    WHERE USER_ID = ? AND PRODUCT_ID = ?
  `;

  connection.execute(sqlQuery, [userid, productid], (error, cart) => {
    if (error) {
      console.error(error);
      return res.status(500).send("Cart error");
    }

    if (cart.length === 0) {
      return res.status(404).send("Product not found in cart");
    }

    const quantity = cart[0].quantity;

    // ==================================
    // CASE 1: MORE THAN ONE IN CART
    // ==================================

    if (quantity > 1) {
      const updateCartQuery = `
          UPDATE CART
          SET QUANTITY = QUANTITY - 1
          WHERE USER_ID = ? AND PRODUCT_ID = ?
        `;

      connection.execute(updateCartQuery, [userid, productid], (error) => {
        if (error) {
          console.error(error);
          return res.status(500).send("Could not update cart");
        }

        // Return one item to product stock
        const updateProductQuery = `
              UPDATE PRODUCTS
              SET QUANTITY = QUANTITY + 1
              WHERE ID = ?
            `;

        connection.execute(updateProductQuery, [productid], (error) => {
          if (error) {
            console.error(error);
            return res.status(500).send("Could not update product stock");
          }

          return res.redirect("/cart");
        });
      });
    }

    // ==================================
    // CASE 2: ONLY ONE IN CART
    // ==================================
    else {
      const deleteCartQuery = `
          DELETE FROM CART
          WHERE USER_ID = ? AND PRODUCT_ID = ?
        `;

      connection.execute(deleteCartQuery, [userid, productid], (error) => {
        if (error) {
          console.error(error);
          return res.status(500).send("Could not remove product from cart");
        }

        // Return the item to product stock
        const updateProductQuery = `
              UPDATE PRODUCTS
              SET QUANTITY = QUANTITY + 1
              WHERE ID = ?
            `;

        connection.execute(updateProductQuery, [productid], (error) => {
          if (error) {
            console.error(error);
            return res.status(500).send("Could not update product stock");
          }

          return res.redirect("/cart");
        });
      });
    }
  });
};

app.post("/cart/delete", verifyCookie, deleteProduct);

// =======================
// DELETE PRODUCT
// =======================

const deleteAdminProduct = (req, res) => {
  const productid = req.body.productId;
  const sqlQuery = "SELECT * FROM PRODUCTS WHERE ID = ?";

  connection.execute(sqlQuery, [productid], (error, products) => {
    if (error) {
      console.error(error);
      return res.status(500).send("Product Database error");
    }
    if (products.length === 0) {
      return res.status(404).send("Product not found");
    }
    if (products.length > 0) {
      const deleteQuery = "DELETE FROM PRODUCTS WHERE ID = ?";
      connection.execute(deleteQuery, [productid], (error) => {
        if (error) {
          console.error(error);
          return res.status(500).send("Could not delete product");
        }
        return res.redirect("/admin/dashboard");
      });
    }
  });
};
app.post("/delete/product", verifyCookie, deleteAdminProduct);

// =======================
// START SERVER
// =======================

app.listen(port, () => {
  log(`App is running on port ${port}`);
});
