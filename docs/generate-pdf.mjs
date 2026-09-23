#!/usr/bin/env node
/**
 * Generates PDF from PREVAIL-Master-Engineering-Plan.md via HTML + Puppeteer.
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mdPath = join(__dirname, "PREVAIL-Master-Engineering-Plan.md");
const htmlPath = join(__dirname, "PREVAIL-Master-Engineering-Plan.html");
const pdfPath = join(__dirname, "PREVAIL-Master-Engineering-Plan.pdf");

const md = readFileSync(mdPath, "utf8");

function mdToHtml(text) {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => {
    return `<pre class="code-block"><code>${code.trim()}</code></pre>`;
  });

  const lines = html.split("\n");
  const out = [];
  let inTable = false;
  let tableRows = [];

  const flushTable = () => {
    if (!tableRows.length) return;
    let t = '<table class="data-table">';
    tableRows.forEach((row, i) => {
      const cells = row.split("|").filter((c) => c.trim() !== "");
      if (cells.length === 0) return;
      if (i === 1 && cells.every((c) => /^[\s\-:]+$/.test(c))) return;
      const tag = i === 0 ? "th" : "td";
      t += "<tr>" + cells.map((c) => `<${tag}>${c.trim()}</${tag}>`).join("") + "</tr>";
    });
    t += "</table>";
    out.push(t);
    tableRows = [];
    inTable = false;
  };

  for (const line of lines) {
    if (line.startsWith("# ")) {
      flushTable();
      out.push(`<h1>${line.slice(2)}</h1>`);
    } else if (line.startsWith("## ")) {
      flushTable();
      out.push(`<h2>${line.slice(3)}</h2>`);
    } else if (line.startsWith("### ")) {
      flushTable();
      out.push(`<h3>${line.slice(4)}</h3>`);
    } else if (line.startsWith("---")) {
      flushTable();
      out.push("<hr/>");
    } else if (line.trim().startsWith("|")) {
      inTable = true;
      tableRows.push(line);
    } else if (line.startsWith("- ")) {
      flushTable();
      out.push(`<li>${line.slice(2)}</li>`);
    } else if (line.trim() === "") {
      flushTable();
      out.push("");
    } else if (line.startsWith("<pre")) {
      flushTable();
      out.push(line);
    } else {
      flushTable();
      let p = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      p = p.replace(/`([^`]+)`/g, "<code>$1</code>");
      out.push(`<p>${p}</p>`);
    }
  }
  flushTable();

  // Wrap consecutive li in ul
  let body = out.join("\n");
  body = body.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>PREVAIL Master Engineering Plan v2.0</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.45;
    color: #1a1a1a;
    max-width: 100%;
  }
  h1 { font-size: 22pt; color: #0d47a1; border-bottom: 2px solid #0d47a1; padding-bottom: 8px; margin-top: 0; page-break-after: avoid; }
  h2 { font-size: 14pt; color: #1565c0; margin-top: 22px; page-break-after: avoid; }
  h3 { font-size: 11pt; color: #1976d2; margin-top: 16px; page-break-after: avoid; }
  p { margin: 6px 0; text-align: justify; }
  ul { margin: 8px 0 8px 20px; }
  li { margin: 3px 0; }
  hr { border: none; border-top: 1px solid #ccc; margin: 16px 0; }
  code { font-family: Menlo, Monaco, monospace; font-size: 9pt; background: #f5f5f5; padding: 1px 4px; border-radius: 3px; }
  pre.code-block {
    background: #f8f9fa;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 10px 12px;
    font-size: 8pt;
    line-height: 1.35;
    overflow-x: auto;
    white-space: pre-wrap;
    page-break-inside: avoid;
  }
  table.data-table {
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0 14px;
    font-size: 9pt;
    page-break-inside: avoid;
  }
  table.data-table th, table.data-table td {
    border: 1px solid #bdbdbd;
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
  }
  table.data-table th { background: #e3f2fd; font-weight: 600; }
  table.data-table tr:nth-child(even) td { background: #fafafa; }
  strong { color: #111; }
  .cover-meta { font-size: 11pt; color: #555; margin-bottom: 24px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

const html = mdToHtml(md);
writeFileSync(htmlPath, html, "utf8");

// Install puppeteer locally in docs if needed and print PDF
const puppeteerDir = join(__dirname, "node_modules", "puppeteer");
try {
  readFileSync(join(puppeteerDir, "package.json"));
} catch {
  execSync("npm install puppeteer@22 --no-save", {
    cwd: __dirname,
    stdio: "inherit",
  });
}

const puppeteer = await import("puppeteer");
const browser = await puppeteer.default.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const page = await browser.newPage();
await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0" });
await page.pdf({
  path: pdfPath,
  format: "A4",
  printBackground: true,
  margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate:
    '<div style="font-size:8px;width:100%;text-align:center;color:#666;padding:0 16mm;"><span>PREVAIL Master Engineering Plan v2.0</span> — <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
});
await browser.close();
console.log(`PDF written to: ${pdfPath}`);
