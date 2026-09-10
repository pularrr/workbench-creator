const { createCanvas } = require("@napi-rs/canvas");
const fs = require("fs");

const canvas = createCanvas(900, 400);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#ffffff";
ctx.fillRect(0, 0, 900, 400);
ctx.fillStyle = "#000000";
ctx.font = "42px sans-serif";
ctx.fillText("FMCW Radar Test", 60, 90);
ctx.font = "32px sans-serif";
ctx.fillText("The range resolution is: delta R = c / (2B)", 60, 170);
ctx.fillText("MIMO radar uses virtual array for angle estimation", 60, 240);
ctx.fillText("CFAR detection for target extraction", 60, 310);
const png = canvas.toBuffer("image/png");
fs.writeFileSync("test-image.png", png);
console.log("image created, bytes:", png.length);
