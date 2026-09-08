import { googleAccessToken } from "../integrations/googleWorkspace.js";
import { ArtifactError, hash, type ArtifactJob } from "./model.js";
export interface SheetTarget {
  connectionId: string;
  spreadsheetId: string;
  name: string;
  enabled: boolean;
  revision: number;
  configuredBy: string;
}
export function sheetRows(job: ArtifactJob): Array<Array<string | number>> {
  return [
    ["HyperFlow report", job.id, job.inputHash],
    ["Project", job.inputs.projectName],
    ["Records read", job.inputs.observedAt],
    ["Period starts", job.inputs.periodStart],
    ["Cutoff exclusive", job.inputs.cutoff],
    ["Accepted", job.inputs.totals.accepted],
    ["Open", job.inputs.totals.open],
    ["Fulfilled", job.inputs.totals.fulfilled],
    ["Due within period", job.inputs.totals.dueInPeriod],
    ["Open before cutoff", job.inputs.totals.overdue],
    ["Draft reviewed", job.receipt!.sha256],
    [
      "States reflect observation time. Existing tabs and subsequent manual edits are never overwritten.",
    ],
    [
      "Obligation",
      "Version",
      "Deliverable",
      "Owner",
      "Beneficiary",
      "State",
      "Due",
      "Communication sources",
    ],
    ...job.inputs.rows.map((r) => [
      r.id,
      r.version,
      r.deliverable,
      r.owner,
      r.beneficiary,
      r.state,
      r.dueAt || "",
      r.sourceCommunicationIds.join(", "),
    ]),
  ];
}
export class ReportSheetProvider {
  constructor(
    private orgId: string,
    private target: SheetTarget,
    private deps: {
      token?: typeof googleAccessToken;
      fetch?: typeof fetch;
    } = {},
  ) {}
  private async request(
    path: string,
    init?: RequestInit,
    beforeSend?: () => Promise<void>,
  ) {
    const token = await (this.deps.token || googleAccessToken)(
      this.orgId,
      this.target.connectionId,
    );
    if (beforeSend) await beforeSend();
    const r = await (this.deps.fetch || fetch)(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.target.spreadsheetId)}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(25000),
      },
    );
    if (!r.ok)
      throw new ArtifactError(
        502,
        `Google Sheets request failed (${r.status})`,
      );
    return r.json();
  }
  async apply(
    job: ArtifactJob,
    write: boolean,
    beforeWrite?: () => Promise<void>,
  ) {
    const sheetId = parseInt(hash(job.id + job.inputHash).slice(0, 7), 16),
      title = `HF report ${job.id.slice(0, 12)}`,
      rows = sheetRows(job);
    const verify = async () => {
      const doc = await this.request("?fields=sheets.properties");
      const sheet = doc.sheets?.find(
        (s: any) => s.properties.sheetId === sheetId,
      );
      if (!sheet) return null;
      if (sheet.properties.title !== title)
        throw new ArtifactError(
          409,
          "The export tab was renamed or its identity conflicts; no cells were changed",
        );
      const range = `'${title}'!A1:H${rows.length}`;
      const result = await this.request(
        `/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`,
      );
      const normalize = (r: any[][]) =>
        Array.from({ length: rows.length }, (_, i) =>
          Array.from({ length: 8 }, (_, c) => r[i]?.[c] ?? ""),
        );
      if (
        JSON.stringify(normalize(result.values || [])) !==
        JSON.stringify(normalize(rows))
      )
        throw new ArtifactError(
          409,
          "The export tab differs from this report, possibly due to manual edits. No cells were overwritten.",
        );
      return {
        spreadsheetId: this.target.spreadsheetId,
        sheetId,
        range,
        url: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(this.target.spreadsheetId)}/edit#gid=${sheetId}`,
        verifiedAt: Date.now(),
        contentHash: hash(rows),
        observed: true,
      };
    };
    const prior = await verify();
    if (prior) return prior;
    if (!write)
      throw new ArtifactError(
        409,
        "No matching export is visible yet. Reconciliation never resubmits the write.",
      );
    const requests = [
      {
        addSheet: {
          properties: {
            sheetId,
            title,
            gridProperties: {
              rowCount: Math.max(100, rows.length + 1),
              columnCount: 8,
              frozenRowCount: 13,
            },
          },
        },
      },
      {
        updateCells: {
          start: { sheetId, rowIndex: 0, columnIndex: 0 },
          rows: rows.map((row) => ({
            values: row.map((v) => ({
              userEnteredValue:
                typeof v === "number" ? { numberValue: v } : { stringValue: v },
            })),
          })),
          fields: "userEnteredValue",
        },
      },
      {
        repeatCell: {
          range: { sheetId },
          cell: {
            userEnteredFormat: {
              wrapStrategy: "WRAP",
              verticalAlignment: "TOP",
              textFormat: { fontFamily: job.template.brand.font, fontSize: 11 },
            },
          },
          fields: "userEnteredFormat",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 8 },
          properties: { pixelSize: 230 },
          fields: "pixelSize",
        },
      },
    ];
    await this.request(
      ":batchUpdate",
      {
        method: "POST",
        body: JSON.stringify({ requests }),
      },
      beforeWrite,
    );
    const receipt = await verify();
    if (!receipt)
      throw new ArtifactError(502, "The accepted export is not yet visible");
    return receipt;
  }
}
