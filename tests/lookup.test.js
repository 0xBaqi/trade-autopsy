import { describe, it, expect } from "vitest";
import { extractTxHash, casePath } from "../lib/lookup.js";
import { headlineFor } from "../lib/caseView.js";

// Synthetic hash for parsing tests only (all repeated digits, not a real transaction).
const H = "0x" + "ab12".repeat(16);

describe("extractTxHash", () => {
  it("accepts a bare hash and lowercases it", () => expect(extractTxHash(H.toUpperCase().replace("0X", "0x"))).toBe(H));
  it("pulls the hash out of an explorer link", () => expect(extractTxHash(`https://etherscan.io/tx/${H}#eventlog`)).toBe(H));
  it("rejects short, long and empty input", () => {
    expect(extractTxHash("0x1234")).toBeNull();
    expect(extractTxHash(H + "ff")).toBeNull();
    expect(extractTxHash("")).toBeNull();
    expect(extractTxHash(null)).toBeNull();
  });
});

describe("casePath", () => {
  it("builds the permalink", () => expect(casePath("base", H)).toBe(`/tx/base/${H}`));
});

describe("headlineFor", () => {
  it("comes from classification, not the model", () => expect(headlineFor("SWAP", true)).toBe("Swapped one asset for another"));
  it("failure wins over type", () => expect(headlineFor("SWAP", false)).toBe("Transaction failed"));
  it("falls back honestly", () => expect(headlineFor("SOMETHING_NEW", true)).toBe("Transaction we could not classify"));
});
