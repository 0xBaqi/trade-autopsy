import { describe, it, expect } from "vitest";
import { classifyTransaction } from "../lib/transactionClassification";

// SYNTHETIC inputs shaped like RPC output. They prove the classifier's rules.
// Golden tests against recorded real transactions are tracked in SPEC.md section 7.
const word = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
const approveInput = (amountHex) => "0x095ea7b3" + word("0x" + "b".repeat(40)) + word(amountHex);
const ok = { status: "0x1" };
const transfer = [{ tokenAddress: "0x" + "c".repeat(40), from: "0x1", to: "0x2", rawAmount: "1" }];

describe("classifyTransaction (deterministic rules)", () => {
  it("failed receipt is FAILED_TRANSACTION regardless of calldata", () => {
    expect(classifyTransaction({ tx: { to: "0x1", input: "0xa9059cbb" }, receipt: { status: "0x0" } }).type).toBe("FAILED_TRANSACTION");
  });
  it("no recipient is CONTRACT_CREATION", () => {
    expect(classifyTransaction({ tx: { to: null, input: "0x6080" }, receipt: ok }).type).toBe("CONTRACT_CREATION");
  });
  it("ERC-20 approve: limited, unlimited and revoked", () => {
    const run = (amt) => classifyTransaction({ tx: { to: "0x1", input: approveInput(amt) }, receipt: ok });
    expect(run("0x64")).toMatchObject({ type: "TOKEN_APPROVAL", approval: { approvalKind: "LIMITED" } });
    expect(run("0x" + "f".repeat(64))).toMatchObject({ type: "TOKEN_APPROVAL", approval: { approvalKind: "UNLIMITED" } });
    expect(run("0x0")).toMatchObject({ type: "TOKEN_APPROVAL", approval: { approvalKind: "REVOKED" } });
  });
  it("malformed approve calldata is not labelled an approval", () => {
    const t = classifyTransaction({ tx: { to: "0x1", input: "0x095ea7b3" + "00" }, receipt: ok });
    expect(t.type).not.toBe("TOKEN_APPROVAL");
  });
  it("plain value send with no calldata is NATIVE_TRANSFER", () => {
    expect(classifyTransaction({ tx: { to: "0x1", input: "0x", value: "0xde0b6b3a7640000" }, receipt: ok }).type).toBe("NATIVE_TRANSFER");
  });
  it("transfer selector needs matching Transfer evidence to be ERC20_TRANSFER", () => {
    const tx = { to: "0x1", input: "0xa9059cbb" + "0".repeat(128) };
    expect(classifyTransaction({ tx, receipt: ok, tokenTransfers: transfer }).type).toBe("ERC20_TRANSFER");
    expect(classifyTransaction({ tx, receipt: ok, tokenTransfers: [] }).type).toBe("CONTRACT_INTERACTION");
  });
  it("NFT transfer selector needs positive NFT transfer evidence", () => {
    const tx = { to: "0x1", input: "0x42842e0e" + "0".repeat(192) };
    expect(classifyTransaction({ tx, receipt: ok, nftTransfers: [{ standard: "ERC721" }] }).type).toBe("NFT_TRANSFER");
    expect(classifyTransaction({ tx, receipt: ok, nftTransfers: [{ standard: "ERC1155", quantity: "0" }] }).type).toBe("CONTRACT_INTERACTION");
  });
  it("unrecognised calldata is CONTRACT_INTERACTION, never a guess", () => {
    expect(classifyTransaction({ tx: { to: "0x1", input: "0xdeadbeef" }, receipt: ok }).type).toBe("CONTRACT_INTERACTION");
  });
  it("no calldata and no value is UNKNOWN", () => {
    expect(classifyTransaction({ tx: { to: "0x1", input: "0x", value: "0x0" }, receipt: ok }).type).toBe("UNKNOWN");
  });
});
