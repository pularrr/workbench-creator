const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fs = require("fs");

(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText("FMCW Radar Test Document", { x: 50, y: 780, size: 18, font, color: rgb(0, 0, 0) });
  page.drawText("The range resolution is Delta R = c / (2B).", { x: 50, y: 740, size: 12, font });
  page.drawText("MIMO radar uses virtual array for angle estimation.", { x: 50, y: 720, size: 12, font });
  const bytes = await doc.save();
  fs.writeFileSync("test-sample.pdf", Buffer.from(bytes));
  console.log("PDF created, bytes:", bytes.length);
})();
