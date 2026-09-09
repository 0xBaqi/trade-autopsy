const EXECUTE_SELECTORS = new Set([
  "0x3593564c", // execute(bytes,bytes[],uint256)
  "0x24856bc3", // execute(bytes,bytes[])
]);

// Shared command IDs used by current Uniswap/Pancake Universal Router designs.
// Keep this bounded: unknown commands stay UNKNOWN rather than being guessed.
const COMMANDS = new Map([
  [0x00, "V3_SWAP_EXACT_IN"],
  [0x01, "V3_SWAP_EXACT_OUT"],
  [0x02, "PERMIT2_TRANSFER_FROM"],
  [0x03, "PERMIT2_PERMIT_BATCH"],
  [0x04, "SWEEP"],
  [0x05, "TRANSFER"],
  [0x06, "PAY_PORTION"],
  [0x08, "V2_SWAP_EXACT_IN"],
  [0x09, "V2_SWAP_EXACT_OUT"],
  [0x0a, "PERMIT2_PERMIT"],
  [0x0b, "WRAP_NATIVE"],
  [0x0c, "UNWRAP_WRAPPED_NATIVE"],
  [0x0d, "PERMIT2_TRANSFER_FROM_BATCH"],
  [0x0e, "BALANCE_CHECK_ERC20"],
  [0x10, "ADVANCED_SWAP"],
  [0x21, "EXECUTE_SUB_PLAN"],
  [0x22, "STABLE_SWAP_EXACT_IN"],
  [0x23, "STABLE_SWAP_EXACT_OUT"],
]);

const SWAP_COMMANDS = new Set([
  "V3_SWAP_EXACT_IN",
  "V3_SWAP_EXACT_OUT",
  "V2_SWAP_EXACT_IN",
  "V2_SWAP_EXACT_OUT",
  "ADVANCED_SWAP",
  "STABLE_SWAP_EXACT_IN",
  "STABLE_SWAP_EXACT_OUT",
]);

function word(hex, offset) {
  const start = offset * 2;
  if (start < 0 || start + 64 > hex.length) return null;
  return hex.slice(start, start + 64);
}

function uintWord(hex, offset) {
  const value = word(hex, offset);
  if (!value) return null;
  try {
    return BigInt(`0x${value}`);
  } catch {
    return null;
  }
}

function safeNumber(value, max) {
  if (typeof value !== "bigint" || value < 0n || value > BigInt(max)) return null;
  return Number(value);
}

/**
 * Decode only the top-level `commands` bytes argument of UniversalRouter.execute.
 * We intentionally do not interpret per-command `inputs` yet. The command stream
 * itself is deterministic evidence and is enough to say which operation families
 * were requested without inventing route/token details.
 */
export function decodeUniversalRouterCommands(input) {
  if (typeof input !== "string" || !input.startsWith("0x") || input.length < 10 + 128) return null;

  const selector = input.slice(0, 10).toLowerCase();
  if (!EXECUTE_SELECTORS.has(selector)) return null;

  const args = input.slice(10);
  const commandsOffset = safeNumber(uintWord(args, 0), args.length / 2);
  if (commandsOffset === null || commandsOffset % 32 !== 0) return null;

  const commandsLength = safeNumber(uintWord(args, commandsOffset), 256);
  if (commandsLength === null) return null;

  const dataStart = commandsOffset + 32;
  const dataHexStart = dataStart * 2;
  const dataHexEnd = dataHexStart + commandsLength * 2;
  if (dataHexEnd > args.length) return null;

  const commandHex = args.slice(dataHexStart, dataHexEnd);
  const commands = [];

  for (let i = 0; i < commandsLength; i += 1) {
    const raw = Number.parseInt(commandHex.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isInteger(raw)) return null;
    const commandId = raw & 0x7f;
    const name = COMMANDS.get(commandId) || "UNKNOWN";
    commands.push({
      index: i,
      raw: `0x${raw.toString(16).padStart(2, "0")}`,
      commandId: `0x${commandId.toString(16).padStart(2, "0")}`,
      name,
      allowRevert: Boolean(raw & 0x80),
      isSwap: SWAP_COMMANDS.has(name),
      isPermit2: name.startsWith("PERMIT2_"),
    });
  }

  return {
    selector,
    commandCount: commands.length,
    commands,
    hasSwapCommand: commands.some((command) => command.isSwap),
    hasPermit2Command: commands.some((command) => command.isPermit2),
    hasUnknownCommand: commands.some((command) => command.name === "UNKNOWN"),
  };
}
