const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("node:path");

const APP = express();

APP.set("trust proxy", 1);

APP.use(cookieParser());

APP.use(express.json());

APP.use(
    express.urlencoded({
        extended: true
    })
);
APP.use(
    express.static(
        path.join(__dirname, "public")
    )
);

APP.use(
    "/static",
    express.static(
        path.join(__dirname, "static")
    )
);
APP.set(
    "view engine",
    "ejs"
);

APP.set(
    "views",
    path.join(__dirname, "views")
);

APP.get("/", (_req, res) => {
    res.status(200).render("client");
});
APP.get("/end-to-end", (_req, res) => {
    res.render("end-to-end-info.ejs");
})

APP.listen(3737, "localhost", () => {
    console.log("app en http://localhost:3737")
})