import {
  Document,
  Paragraph,
  TextRun,
  Packer,
  HeadingLevel,
  ImageRun,
} from "docx";
import pptxgen from "pptxgenjs";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  ArtifactError,
  hash,
  normalizeJob,
  type ArtifactJob,
} from "./model.js";
export const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export function reportSections(
  job: ArtifactJob,
): Array<{ title: string; paragraphs: string[] }> {
  const i = job.inputs;
  return [
    {
      title: "Overview",
      paragraphs: [
        `${i.projectName}. Report period ${i.periodStart} to ${i.cutoff} (end exclusive). Records read ${i.observedAt}.`,
        `${i.totals.accepted} accepted records, ${i.totals.open} currently open and ${i.totals.fulfilled} currently fulfilled. ${i.totals.dueInPeriod} due within the period. ${i.totals.overdue} currently open records have deadlines before the cutoff.`,
      ],
    },
    {
      title: "Accepted work",
      paragraphs: i.rows.length
        ? i.rows.map(
            (r) =>
              `${r.deliverable}\nOwner ${r.owner}. Beneficiary ${r.beneficiary}. State ${r.state}. Due ${r.dueAt || "Unspecified"} (${r.timezone || "timezone unspecified"}). Source ${r.id} version ${r.version}${r.sourceCommunicationIds.length ? `; communications ${r.sourceCommunicationIds.join(", ")}` : ""}.${r.sourceChanged ? " Source changed after review." : ""}`,
          )
        : ["No accepted records returned."],
    },
    {
      title: "Communication evidence",
      paragraphs: i.evidence.length
        ? i.evidence.map(
            (e) =>
              `${e.label}: ${e.text}\nSources ${e.sources.join(", ")}${e.dateNote ? `. ${e.dateNote}` : ""}`,
          )
        : ["No permitted excerpts returned."],
    },
    {
      title: "Source notes",
      paragraphs: [
        ...i.notices,
        `Template ${job.template.id} version ${job.template.version}. Input fingerprint ${job.inputHash}.`,
        "Draft for review. Generating or downloading this file does not deliver it or fulfill a promise.",
      ],
    },
  ];
}
const wrap = (text: string, max: number) => {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const parts = word.match(new RegExp(`.{1,${max}}`, "g")) || [""];
      for (const part of parts) {
        if (line.length + part.length + 1 > max) {
          lines.push(line);
          line = part;
        } else line += (line ? " " : "") + part;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
};
function wrapSlideText(text: string): string[] {
  const width = (s: string) =>
    [...s].reduce(
      (n, c) =>
        n +
        (/[ il.,:;'!|]/.test(c)
          ? 0.3
          : /[WM@]/.test(c)
            ? 1
            : /[A-Z0-9]/.test(c)
              ? 0.75
              : /[a-z]/.test(c)
                ? 0.6
                : 1.15),
      0,
    );
  const result: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const c of paragraph) {
      if (width(line + c) > 43) {
        const space = line.lastIndexOf(" ");
        if (space > 0) {
          result.push(line.slice(0, space));
          line = line.slice(space + 1);
        } else {
          result.push(line);
          line = "";
        }
      }
      line += c;
    }
    if (line) result.push(line);
  }
  return result;
}
export async function renderArtifact(rawJob: ArtifactJob) {
  const job = normalizeJob(rawJob);
  const sections = reportSections(job),
    brand = job.template.brand;
  let bytes: Buffer;
  if (job.template.format === "docx") {
    const children: Paragraph[] = [
      new Paragraph({
        text: "Weekly operating report",
        heading: HeadingLevel.TITLE,
      }),
      new Paragraph({
        text:
          brand.name === "Unbranded"
            ? "Prepared for project review"
            : brand.name,
      }),
    ];
    if (brand.logo)
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              type: "png",
              data: Buffer.from(brand.logo.base64, "base64"),
              transformation: {
                width: 120 * Math.min(1, brand.logo.width / brand.logo.height),
                height: 120 * Math.min(1, brand.logo.height / brand.logo.width),
              },
            }),
          ],
        }),
      );
    for (const section of sections) {
      children.push(
        new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }),
      );
      for (const text of section.paragraphs.flatMap((text) =>
        wrap(text, 100).reduce<string[]>((chunks, line) => {
          if (
            !chunks.length ||
            chunks[chunks.length - 1].length + line.length > 1000
          )
            chunks.push(line);
          else chunks[chunks.length - 1] += "\n" + line;
          return chunks;
        }, []),
      ))
        children.push(
          new Paragraph({
            children: text
              .split("\n")
              .map(
                (line, index) =>
                  new TextRun({ text: line, ...(index ? { break: 1 } : {}) }),
              ),
            spacing: { after: 160 },
            keepLines: true,
          }),
        );
    }
    bytes = await Packer.toBuffer(
      new Document({
        creator: "HyperFlow",
        title: "Weekly operating report",
        styles: {
          default: {
            document: {
              run: { font: brand.font, size: 22 },
              paragraph: { spacing: { line: 280 } },
            },
            title: { run: { color: "000000", size: 40, bold: true } },
            heading1: { run: { color: brand.accent, size: 28, bold: true } },
          },
        },
        sections: [
          {
            properties: {
              page: {
                size: { width: 11906, height: 16838 },
                margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
              },
            },
            children,
          },
        ],
      }),
    );
  } else if (job.template.format === "pptx") {
    const Pptx =
      typeof pptxgen === "function"
        ? pptxgen
        : ((pptxgen as any).default as typeof pptxgen);
    const deck = new Pptx();
    deck.layout = "LAYOUT_WIDE";
    deck.author = "HyperFlow";
    deck.subject = "Project operating report";
    deck.title = "Weekly operating report";
    let slideCount = 0;
    deck.theme = {
      headFontFace: brand.font,
      bodyFontFace: brand.font,
    };
    const add = (title: string, lines: string[]) => {
      const slide = deck.addSlide();
      slideCount++;
      slide.background = { color: "FFFFFF" };
      slide.addText(title, {
        x: 0.65,
        y: 0.5,
        w: 11.2,
        h: 0.65,
        fontSize: 32,
        bold: true,
        color: brand.accent,
        margin: 0,
      });
      slide.addText(lines.join("\n"), {
        x: 0.65,
        y: 1.5,
        w: 12,
        h: 4.9,
        fontSize: 18,
        breakLine: false,
        margin: 0,
        paraSpaceAfter: 0,
        valign: "top",
        color: "202B36",
      });
      slide.addText(`Draft for review   ${brand.name}   ${slideCount}`, {
        x: 0.65,
        y: 6.95,
        w: 12,
        h: 0.22,
        fontSize: 10,
        color: "475569",
        margin: 0,
      });
      slide.addNotes(
        `Inputs ${job.inputHash}. Template ${job.template.id}@${job.template.version}. Records read ${job.inputs.observedAt}.`,
      );
      if (brand.logo) {
        const h = Math.min(0.6, (0.6 * brand.logo.height) / brand.logo.width),
          w = (h * brand.logo.width) / brand.logo.height;
        slide.addImage({
          data: `image/png;base64,${brand.logo.base64}`,
          x: 12.1 - w,
          y: 0.45,
          w,
          h,
        });
      }
    };
    const cover = [
      job.inputs.projectName,
      `Period ending ${job.inputs.cutoff}`,
      `Records read ${job.inputs.observedAt}`,
    ].flatMap(wrapSlideText);
    for (let p = 0; p < cover.length; p += 13)
      add(
        "Weekly operating report" + (p ? " continued" : ""),
        cover.slice(p, p + 13),
      );
    for (const section of sections) {
      const lines = section.paragraphs.flatMap((t) => [
        ...wrapSlideText(t),
        "",
      ]);
      for (let p = 0; p < lines.length; p += 13)
        add(section.title + (p ? " continued" : ""), lines.slice(p, p + 13));
    }
    if (slideCount > 100)
      throw new ArtifactError(
        422,
        "Report exceeds 100 slides; narrow the source scope",
      );
    bytes = Buffer.from(
      (await deck.write({ outputType: "nodebuffer" })) as Buffer,
    );
  } else {
    const book = new ExcelJS.Workbook();
    book.creator = "HyperFlow";
    book.created = new Date(job.createdAt);
    book.calcProperties.fullCalcOnLoad = true;
    const summary = book.addWorksheet("Weekly report"),
      work = book.addWorksheet("Accepted work"),
      sources = book.addWorksheet("Evidence");
    summary.columns = [{ width: 43 }, { width: 26 }, { width: 80 }];
    summary.addRow(["Weekly operating report"]);
    summary.addRow(["Project", job.inputs.projectName]);
    summary.addRow(["Period start", new Date(job.inputs.periodStart)]);
    summary.addRow(["Cutoff exclusive", new Date(job.inputs.cutoff)]);
    summary.addRow(["Records read", new Date(job.inputs.observedAt)]);
    [3, 4, 5].forEach(
      (n) => (summary.getCell(n, 2).numFmt = 'yyyy-mm-dd hh:mm "UTC"'),
    );
    summary.addRow(["Metric", "Value"]);
    const end = Math.max(2, job.inputs.rows.length + 1),
      range = `'Accepted work'!`;
    const metrics = [
      [
        "Accepted records",
        `COUNTA(${range}A2:A${end})`,
        job.inputs.totals.accepted,
      ],
      [
        "Currently open",
        `COUNTIF(${range}K2:K${end},1)`,
        job.inputs.totals.open,
      ],
      [
        "Currently fulfilled",
        `COUNTIF(${range}F2:F${end},"fulfilled")`,
        job.inputs.totals.fulfilled,
      ],
      [
        "Due in period",
        `COUNTIF(${range}L2:L${end},1)`,
        job.inputs.totals.dueInPeriod,
      ],
      [
        "Open before cutoff",
        `COUNTIF(${range}M2:M${end},1)`,
        job.inputs.totals.overdue,
      ],
    ];
    metrics.forEach(([label, formula, result]) =>
      summary.addRow([
        label,
        { formula: String(formula), result: Number(result) },
      ]),
    );
    summary.addRow([]);
    job.inputs.notices.forEach((n) => summary.addRow([n]));
    summary.addRow([`Input fingerprint ${job.inputHash}`]);
    summary.addRow([
      `Template ${job.template.id} version ${job.template.version}`,
    ]);
    summary.addRow(["Draft for review. No delivery has occurred."]);
    work.columns = [
      { width: 40 },
      { width: 12 },
      { width: 65 },
      { width: 28 },
      { width: 28 },
      { width: 20 },
      { width: 25 },
      { width: 25 },
      { width: 50 },
      { width: 22 },
      { width: 12 },
      { width: 15 },
      { width: 18 },
    ];
    work.addRow([
      "Obligation ID",
      "Version",
      "Deliverable",
      "Owner",
      "Beneficiary",
      "State",
      "Due UTC",
      "Timezone",
      "Communication references",
      "Source changed",
      "Open",
      "Due in period",
      "Open before cutoff",
    ]);
    for (const [index, r] of job.inputs.rows.entries()) {
      const n = index + 2,
        d = Date.parse(r.dueAt),
        open = !["fulfilled", "cancelled"].includes(r.state);
      work.addRow([
        r.id,
        r.version,
        r.deliverable,
        r.owner,
        r.beneficiary,
        r.state,
        Number.isFinite(d) ? new Date(d) : null,
        r.timezone,
        r.sourceCommunicationIds.join(", "),
        r.sourceChanged ? "Yes" : "No",
        {
          formula: `IF(OR(F${n}="fulfilled",F${n}="cancelled"),0,1)`,
          result: open ? 1 : 0,
        },
        {
          formula: `IF(ISNUMBER(G${n}),IF(AND(G${n}>='Weekly report'!$B$3,G${n}<'Weekly report'!$B$4),1,0),0)`,
          result:
            d >= Date.parse(job.inputs.periodStart) &&
            d < Date.parse(job.inputs.cutoff)
              ? 1
              : 0,
        },
        {
          formula: `IF(ISNUMBER(G${n}),IF(AND(K${n}=1,G${n}<'Weekly report'!$B$4),1,0),0)`,
          result: open && d < Date.parse(job.inputs.cutoff) ? 1 : 0,
        },
      ]);
      work.getCell(n, 7).numFmt = "yyyy-mm-dd hh:mm";
    }
    work.views = [{ state: "frozen", ySplit: 1 }];
    work.autoFilter = `A1:M${end}`;
    sources.columns = [
      { width: 25 },
      { width: 100 },
      { width: 70 },
      { width: 45 },
    ];
    sources.addRow([
      "Evidence type",
      "Excerpt",
      "Communication references",
      "Date qualification",
    ]);
    job.inputs.evidence.forEach((e) => {
      const chunks = e.text.match(/[\s\S]{1,800}/g) || [""];
      chunks.forEach((text, index) =>
        sources.addRow([
          e.label + (index ? " continued" : ""),
          text,
          e.sources.join(", "),
          e.dateNote || null,
        ]),
      );
    });
    for (const sheet of book.worksheets) {
      sheet.eachRow((row, n) => {
        row.font = { name: brand.font, size: 11, color: { argb: "FF202B36" } };
        row.alignment = { vertical: "top", wrapText: true };
        if (n === 1) {
          row.font = {
            name: brand.font,
            size: 12,
            bold: true,
            color: { argb: "FFFFFFFF" },
          };
          row.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF" + brand.accent },
          };
        }
        let lines = 1;
        row.eachCell((cell, col) => {
          if (typeof cell.value === "string")
            lines = Math.max(
              lines,
              Math.ceil(
                cell.value.length /
                  Math.max(8, (sheet.getColumn(col).width || 20) - 5),
              ),
            );
        });
        row.height = n === 1 ? 30 : Math.min(409, Math.max(30, lines * 16 + 8));
      });
    }
    if (brand.logo) {
      const image = book.addImage({
        base64: `data:image/png;base64,${brand.logo.base64}`,
        extension: "png",
      });
      summary.addImage(image, {
        tl: { col: 2, row: 0 },
        ext: {
          width: 100 * Math.min(1, brand.logo.width / brand.logo.height),
          height: Math.min(100, (100 * brand.logo.height) / brand.logo.width),
        },
      });
    }
    bytes = Buffer.from(await book.xlsx.writeBuffer());
  }
  if (bytes.length > 2500000)
    throw new ArtifactError(422, "Artifact exceeds the 2.5 MB storage limit");
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const main = {
    docx: "word/document.xml",
    pptx: "ppt/presentation.xml",
    xlsx: "xl/workbook.xml",
  }[job.template.format];
  if (!zip.file("[Content_Types].xml") || !zip.file(main))
    throw new ArtifactError(500, "Generated Office package is incomplete");
  return {
    bytes,
    receipt: {
      sha256: hash(bytes),
      bytes: bytes.length,
      filename: `weekly-report-${job.id.slice(0, 12)}.${job.template.format}`,
      mime: MIME[job.template.format],
      generatedAt: Date.now(),
      format: job.template.format,
      structure: "passed" as const,
      visual: "pending" as const,
      delivered: false as const,
    },
  };
}
